import * as THREE from 'three';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { PERF, PETALS } from '../config/tuning';
import { paletteColor, type Palette } from '../config/palettes';
import { mulberry32 } from '../core/Random';

/**
 * The petal trail (PRD §5.2): the player is one lead petal, and every
 * bloomed flower adds a petal that flies to join a ribbon behind it.
 *
 * The trail follows a ring buffer of the lead petal's recent positions,
 * recorded once per fixed step. Petal i samples that path at
 * `now − (i + 1) × PETAL_SPACING`, then offsets by a per-petal noise swirl
 * so the ribbon is loose rather than a rigid snake. Petals are one
 * InstancedMesh (slot 0 is the lead petal itself — the pink cone that
 * stood in for it during Phases 0–1 is gone), coloured per instance from
 * the flower each petal came from.
 *
 * Zero-allocation frame loop: the ring buffer, per-petal state, and all
 * scratch objects are allocated once here. fixedUpdate and render only
 * read/write them in place.
 */
export class PetalTrail {
  readonly mesh: THREE.InstancedMesh;

  /** Number of trail petals (excludes the lead). WindController's speed
   *  bonus reads this via main.ts after each spawn. */
  count = 0;

  private readonly ringCapacity: number;
  private readonly ringPositions: Float32Array; // xyz per fixed step
  private ringHead = -1; // index of the most recent sample
  private ringFilled = 0;

  // Per-petal static state, indexed by trail slot (0..MAX_PETALS-1).
  private readonly swirlSeeds: Float32Array;
  private readonly tumbleRates: Float32Array;
  private readonly tumblePhases: Float32Array;
  private readonly tumbleAxes: Float32Array; // xyz per petal, normalised
  private readonly sizes: Float32Array;
  // Join animation: where the petal spawned and when. joinStart < 0 means
  // the petal is either inactive or fully joined.
  private readonly joinOrigins: Float32Array; // xyz per petal
  private readonly joinStarts: Float32Array;

  private readonly noise: NoiseFunction2D;
  private elapsed = 0;

  private readonly scratchSlot = new THREE.Vector3();
  private readonly scratchAxis = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchMatrix = new THREE.Matrix4();

  constructor(palette: Palette, seed: number) {
    this.ringCapacity = Math.ceil(PETALS.PATH_BUFFER_SECONDS / PERF.FIXED_TIMESTEP);
    this.ringPositions = new Float32Array(this.ringCapacity * 3);
    this.noise = createNoise2D(mulberry32(seed));

    const max = PETALS.MAX_PETALS;
    this.swirlSeeds = new Float32Array(max);
    this.tumbleRates = new Float32Array(max);
    this.tumblePhases = new Float32Array(max);
    this.tumbleAxes = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.joinOrigins = new Float32Array(max * 3);
    this.joinStarts = new Float32Array(max).fill(-1);

    const rng = mulberry32(seed ^ 0x9e3779b9);
    for (let i = 0; i < max; i++) {
      this.swirlSeeds[i] = rng() * 100;
      this.tumbleRates[i] = PETALS.TUMBLE_RATE_MIN + rng() * (PETALS.TUMBLE_RATE_MAX - PETALS.TUMBLE_RATE_MIN);
      this.tumblePhases[i] = rng() * Math.PI * 2;
      // Random unit axis: normalising a cube-distributed vector is biased
      // toward corners, but for a slow decorative tumble that bias is
      // invisible and this avoids trig.
      const ax = rng() * 2 - 1;
      const ay = rng() * 2 - 1;
      const az = rng() * 2 - 1;
      const len = Math.hypot(ax, ay, az) || 1;
      this.tumbleAxes[i * 3] = ax / len;
      this.tumbleAxes[i * 3 + 1] = ay / len;
      this.tumbleAxes[i * 3 + 2] = az / len;
      this.sizes[i] = PETALS.SIZE * (1 + (rng() * 2 - 1) * PETALS.SIZE_JITTER);
    }

    // A petal is a small curved quad: 2×2 segments so the static curl
    // across its width reads in silhouette — same reasoning as grass
    // blades being geometry, not textured quads.
    const geometry = new THREE.PlaneGeometry(1, 1, 2, 2);
    const positions = geometry.getAttribute('position');
    for (let v = 0; v < positions.count; v++) {
      const x = positions.getX(v);
      positions.setZ(v, x * x * 0.6); // gentle curl up at the side edges
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0,
    });

    // Slot 0 is the lead petal, so capacity is MAX_PETALS + 1.
    this.mesh = new THREE.InstancedMesh(geometry, material, max + 1);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 121 small quads: not worth per-frame bounds maintenance for culling
    // (and InstancedMesh bounds must be set on the MESH, not the geometry —
    // see GrassField.rebuild for the bug that lesson came from).
    this.mesh.frustumCulled = false;
    this.mesh.count = 1;

    // instanceColor is lazily created by three on first setColorAt.
    // Palette.flowers is keyed by species id (Record, so possibly absent
    // under strict indexing) — the lead petal just wants a pleasant
    // default until it inherits meaning in later phases.
    const lead = paletteColor(palette.flowers['pink']?.color ?? 0xf2a0c4);
    this.mesh.setColorAt(0, lead);
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i + 1, lead);
  }

  /** Record the lead petal's position once per fixed step. */
  fixedUpdate(leadPosition: THREE.Vector3): void {
    this.ringHead = (this.ringHead + 1) % this.ringCapacity;
    const base = this.ringHead * 3;
    this.ringPositions[base] = leadPosition.x;
    this.ringPositions[base + 1] = leadPosition.y;
    this.ringPositions[base + 2] = leadPosition.z;
    if (this.ringFilled < this.ringCapacity) this.ringFilled++;
  }

  /** A bloomed flower sends a petal of its colour flying to the trail.
   *  Past MAX_PETALS the oldest slot is recycled (count stays capped) —
   *  the chime/progression side of that rule lives with the caller. */
  spawnPetal(fromPosition: THREE.Vector3, color: THREE.Color): void {
    const slot = this.count < PETALS.MAX_PETALS ? this.count : PETALS.MAX_PETALS - 1;
    if (this.count < PETALS.MAX_PETALS) this.count++;

    this.joinOrigins[slot * 3] = fromPosition.x;
    this.joinOrigins[slot * 3 + 1] = fromPosition.y;
    this.joinOrigins[slot * 3 + 2] = fromPosition.z;
    this.joinStarts[slot] = this.elapsed;
    this.mesh.setColorAt(slot + 1, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Position every petal for this frame. `leadPosition` is the already
   *  render-interpolated player position from main.ts; `alpha` is the
   *  fixed-step interpolation fraction, used to slide the path sampling
   *  so trail motion is as smooth as the lead's. */
  render(elapsedTime: number, leadPosition: THREE.Vector3, alpha: number): void {
    this.elapsed = elapsedTime;

    this.placePetal(0, leadPosition, elapsedTime);

    for (let i = 0; i < this.count; i++) {
      // How far back along the recorded path this petal's slot sits.
      const delaySeconds = (i + 1) * PETALS.PETAL_SPACING;
      const samplesBack = delaySeconds / PERF.FIXED_TIMESTEP - alpha;
      this.samplePath(samplesBack, this.scratchSlot);

      // Noise swirl, per axis, slowly evolving — the loose-ribbon part.
      const seed = this.swirlSeeds[i] ?? 0;
      const t = elapsedTime * PETALS.SWIRL_FREQUENCY;
      this.scratchSlot.x += this.noise(seed, t) * PETALS.SWIRL_AMPLITUDE;
      this.scratchSlot.y += this.noise(seed + 31.7, t) * PETALS.SWIRL_AMPLITUDE * 0.6;
      this.scratchSlot.z += this.noise(seed + 63.1, t) * PETALS.SWIRL_AMPLITUDE;

      // Join flight: ease from the flower to the slot over JOIN_DURATION.
      const joinStart = this.joinStarts[i] ?? -1;
      if (joinStart >= 0) {
        const j = (elapsedTime - joinStart) / PETALS.JOIN_DURATION;
        if (j >= 1) {
          this.joinStarts[i] = -1;
        } else {
          const ease = j * j * (3 - 2 * j); // smoothstep
          this.scratchSlot.x += (this.joinOrigins[i * 3]! - this.scratchSlot.x) * (1 - ease);
          this.scratchSlot.y += (this.joinOrigins[i * 3 + 1]! - this.scratchSlot.y) * (1 - ease);
          this.scratchSlot.z += (this.joinOrigins[i * 3 + 2]! - this.scratchSlot.z) * (1 - ease);
        }
      }

      this.placePetal(i + 1, this.scratchSlot, elapsedTime);
    }

    this.mesh.count = this.count + 1;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Compose one petal's instance matrix: tumble rotation + jittered size. */
  private placePetal(instanceIndex: number, position: THREE.Vector3, elapsedTime: number): void {
    // The lead petal (instance 0) reuses trail slot 0's tumble parameters;
    // it just never gets a swirl or join offset.
    const slot = instanceIndex === 0 ? 0 : instanceIndex - 1;
    const rate = this.tumbleRates[slot] ?? 1;
    const phase = this.tumblePhases[slot] ?? 0;
    this.scratchAxis.set(
      this.tumbleAxes[slot * 3] ?? 0,
      this.tumbleAxes[slot * 3 + 1] ?? 1,
      this.tumbleAxes[slot * 3 + 2] ?? 0,
    );
    this.scratchQuat.setFromAxisAngle(this.scratchAxis, phase + elapsedTime * rate);
    const size = instanceIndex === 0 ? PETALS.SIZE * 1.6 : this.sizes[slot] ?? PETALS.SIZE;
    this.scratchScale.setScalar(size);
    this.scratchMatrix.compose(position, this.scratchQuat, this.scratchScale);
    this.mesh.setMatrixAt(instanceIndex, this.scratchMatrix);
  }

  /** Interpolated read of the path `samplesBack` fixed steps behind the
   *  most recent sample, clamped to what's been recorded so far. */
  private samplePath(samplesBack: number, out: THREE.Vector3): void {
    if (this.ringFilled === 0) return; // render before first fixedUpdate: keep previous value
    const clamped = Math.min(Math.max(samplesBack, 0), this.ringFilled - 1);
    const whole = Math.floor(clamped);
    const frac = clamped - whole;
    const i0 = (this.ringHead - whole + this.ringCapacity * 2) % this.ringCapacity;
    const i1 = (i0 - 1 + this.ringCapacity) % this.ringCapacity;
    const useNext = frac > 0 && whole + 1 <= this.ringFilled - 1;
    const a = i0 * 3;
    const b = (useNext ? i1 : i0) * 3;
    out.x = this.ringPositions[a]! + (this.ringPositions[b]! - this.ringPositions[a]!) * frac;
    out.y = this.ringPositions[a + 1]! + (this.ringPositions[b + 1]! - this.ringPositions[a + 1]!) * frac;
    out.z = this.ringPositions[a + 2]! + (this.ringPositions[b + 2]! - this.ringPositions[a + 2]!) * frac;
  }
}
