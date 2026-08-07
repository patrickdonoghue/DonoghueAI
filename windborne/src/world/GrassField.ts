import * as THREE from 'three';
import { GRASS, PLAYER_LIGHT, VITALITY, WIND } from '../config/tuning';
import { paletteColor, type Palette } from '../config/palettes';
import { chunkRandom } from '../core/Random';
import type { LevelBounds } from '../player/WindController';
import noiseSource from '../render/shaders/noise.glsl?raw';
import grassVertSource from '../render/shaders/grass.vert.glsl?raw';
import grassFragSource from '../render/shaders/grass.frag.glsl?raw';

const TRAIL_MAX = 24; // must match #define TRAIL_MAX in grass.vert.glsl
const TRAIL_SAMPLE_INTERVAL = 1 / 15; // record a wake sample at 15Hz
const TRAIL_MAX_AGE_FACTOR = 4; // drop a sample once its decay weight is negligible
const RING_CAPACITY_SAFETY_MARGIN = 1.3;

export interface GrassFieldConfig {
  seed: number;
  bounds: LevelBounds;
  getHeightAt: (x: number, z: number) => number;
}

interface ChunkData {
  /** One Float32Array of instance matrices per LOD ring, nested subsets of
   *  the same blue-noise point set (see buildChunk) so a blade doesn't pop
   *  to an unrelated position when its chunk changes ring. */
  tierMatrices: Float32Array[];
  /** Matching xz pairs per tier — rebuild() samples the vitality field at
   *  these to fill the per-blade aVitality attribute. */
  tierPositions: Float32Array[];
  tierCounts: number[];
}

/**
 * The grass system: per PRD §6.2, chunk-scattered blades merged into one
 * InstancedMesh per LOD ring (not per chunk — see the ring-capacity note
 * below), a custom wind/deflection vertex shader, and a player-position
 * trail that gives the deflection wake its recovery lag.
 *
 * "One draw call per grass chunk per LOD ring" in the PRD, read literally,
 * would mean hundreds of draw calls once more than a couple of chunks are
 * in range — which the same document calls out elsewhere as a sign the
 * chunking is wrong. The design that satisfies both statements is: one
 * InstancedMesh *per ring* (three draw calls, full stop), with chunks as
 * the bookkeeping unit that decides which precomputed blade instances are
 * currently copied into that ring's buffer, rebuilt only when the player
 * crosses a chunk boundary.
 */
export class GrassField {
  readonly group = new THREE.Group();

  /** Reads the vitality field on the CPU (VitalityField.sampleAt), wired
   *  by main.ts. Drives per-blade height via the aVitality attribute —
   *  see grass.vert.glsl for why this is an attribute, not a sampler. */
  sampleVitality: ((x: number, z: number) => number) | undefined;

  private readonly config: GrassFieldConfig;
  private readonly material: THREE.ShaderMaterial;
  private readonly ringMeshes: THREE.InstancedMesh[] = [];
  private readonly ringVitalityAttributes: THREE.InstancedBufferAttribute[] = [];
  private readonly ringCapacities: number[] = [];
  private readonly chunkCache = new Map<string, ChunkData>();
  private hasWarnedRingOverflow = false;

  private lastRebuildChunkX = Number.NaN;
  private lastRebuildChunkZ = Number.NaN;

  // rebuild() runs inside the fixed step (every ~8m of travel), so its
  // working objects are pre-allocated here per the zero-allocation frame
  // loop rule (PRD §10.3) rather than constructed fresh each rebuild.
  private readonly rebuildRingCounts: number[] = [];
  private readonly ringBoundingSpheres: THREE.Sphere[] = [];
  private readonly ringBoundingBoxes: THREE.Box3[] = [];

  private readonly trailPositions: THREE.Vector3[] = Array.from({ length: TRAIL_MAX }, () => new THREE.Vector3());
  private readonly trailAges = new Float32Array(TRAIL_MAX);
  private readonly trailWeights = new Float32Array(TRAIL_MAX);
  private trailCount = 0;
  private trailSampleTimer = 0;

  constructor(config: GrassFieldConfig, palette: Palette) {
    this.config = config;
    // One shared material — the edge fade uses the same ring boundaries
    // and band for every ring now (see grass.vert.glsl), so there's no
    // longer a need for a distinct material per ring.
    this.material = this.buildMaterial(palette);

    for (let ringIndex = 0; ringIndex < GRASS.LOD_RINGS.length; ringIndex++) {
      const capacity = this.computeRingCapacity(ringIndex);
      this.ringCapacities.push(capacity);

      const geometry = this.buildBladeGeometry();
      const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      const vitalityAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      vitalityAttribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aVitality', vitalityAttribute);
      this.ringVitalityAttributes.push(vitalityAttribute);
      this.ringMeshes.push(mesh);
      this.group.add(mesh);

      // Persistent bounds objects, assigned once — rebuild() only mutates
      // them in place. See the culling note in rebuild() for why these are
      // the mesh-level bounds, not geometry-level.
      this.rebuildRingCounts.push(0);
      const sphere = new THREE.Sphere(new THREE.Vector3(), 0);
      const box = new THREE.Box3();
      this.ringBoundingSpheres.push(sphere);
      this.ringBoundingBoxes.push(box);
      mesh.boundingSphere = sphere;
      mesh.boundingBox = box;
    }
  }

  /** Called once per fixed step: ages and records the player-trail wake
   *  samples, and rebuilds the ring buffers if the player crossed into a
   *  new grass chunk since the last rebuild. */
  fixedUpdate(dt: number, playerPosition: THREE.Vector3): void {
    this.ageTrail(dt);
    this.trailSampleTimer += dt;
    if (this.trailSampleTimer >= TRAIL_SAMPLE_INTERVAL) {
      this.trailSampleTimer -= TRAIL_SAMPLE_INTERVAL;
      this.recordTrailSample(playerPosition);
    }

    const chunkX = Math.floor(playerPosition.x / GRASS.CHUNK_SIZE);
    const chunkZ = Math.floor(playerPosition.z / GRASS.CHUNK_SIZE);
    if (chunkX !== this.lastRebuildChunkX || chunkZ !== this.lastRebuildChunkZ) {
      this.lastRebuildChunkX = chunkX;
      this.lastRebuildChunkZ = chunkZ;
      this.rebuild(playerPosition);
    }
  }

  /** Called once per rendered frame: updates the shader's continuous-time,
   *  camera-relative, and player-position (for the LOD edge fade)
   *  uniforms. Trail position/weight arrays need no extra work here —
   *  they're direct references into the same arrays fixedUpdate wrote. */
  render(elapsedTime: number, cameraForward: THREE.Vector3, playerPosition: THREE.Vector3): void {
    this.material.uniforms.uTime!.value = elapsedTime;
    (this.material.uniforms.uCameraForward!.value as THREE.Vector3).copy(cameraForward);
    (this.material.uniforms.uPlayerPosition!.value as THREE.Vector3).copy(playerPosition);
    this.material.uniforms.uTrailCount!.value = this.trailCount;
  }

  getVisibleInstanceCount(): number {
    let total = 0;
    for (const mesh of this.ringMeshes) total += mesh.count;
    return total;
  }

  private ageTrail(dt: number): void {
    const maxAge = WIND.DEFLECT_RECOVERY_TAU * TRAIL_MAX_AGE_FACTOR;
    for (let i = 0; i < this.trailCount; i++) {
      this.trailAges[i] = (this.trailAges[i] ?? 0) + dt;
    }
    while (this.trailCount > 0 && (this.trailAges[this.trailCount - 1] ?? 0) > maxAge) {
      this.trailCount--;
    }
    for (let i = 0; i < this.trailCount; i++) {
      this.trailWeights[i] = Math.exp(-(this.trailAges[i] ?? 0) / WIND.DEFLECT_RECOVERY_TAU);
    }
  }

  private recordTrailSample(playerPosition: THREE.Vector3): void {
    const count = Math.min(this.trailCount + 1, TRAIL_MAX);
    for (let i = count - 1; i > 0; i--) {
      const prev = this.trailPositions[i - 1];
      if (prev) this.trailPositions[i]?.copy(prev);
      this.trailAges[i] = this.trailAges[i - 1] ?? 0;
    }
    this.trailPositions[0]?.copy(playerPosition);
    this.trailAges[0] = 0;
    this.trailCount = count;
  }

  private rebuild(playerPosition: THREE.Vector3): void {
    const ringCounts = this.rebuildRingCounts;
    ringCounts.fill(0);
    const rings = GRASS.LOD_RINGS;
    const maxRadius = rings[rings.length - 1]?.radius ?? 0;
    const chunkSize = GRASS.CHUNK_SIZE;

    const minChunkX = Math.floor((playerPosition.x - maxRadius) / chunkSize);
    const maxChunkX = Math.floor((playerPosition.x + maxRadius) / chunkSize);
    const minChunkZ = Math.floor((playerPosition.z - maxRadius) / chunkSize);
    const maxChunkZ = Math.floor((playerPosition.z + maxRadius) / chunkSize);

    for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
      for (let cx = minChunkX; cx <= maxChunkX; cx++) {
        const originX = cx * chunkSize;
        const originZ = cz * chunkSize;
        if (
          originX < this.config.bounds.min[0] ||
          originZ < this.config.bounds.min[1] ||
          originX + chunkSize > this.config.bounds.max[0] ||
          originZ + chunkSize > this.config.bounds.max[1]
        ) {
          continue; // skip chunks that fall outside the level bounds
        }

        // Nearest point IN the chunk, not its center — a chunk is 8x8m, so
        // using the center under/over-estimates any given blade's true
        // distance by up to half the diagonal (~5.7m). Combined with the
        // up-to-8m lag before a rebuild catches up to the player crossing
        // a chunk boundary, that pushed the worst case past the 12m fade
        // band built to hide exactly this, which is what kept the LOD
        // transition visible as a pop despite two rounds of fade fixes.
        const nearestX = THREE.MathUtils.clamp(playerPosition.x, originX, originX + chunkSize);
        const nearestZ = THREE.MathUtils.clamp(playerPosition.z, originZ, originZ + chunkSize);
        const distance = Math.hypot(nearestX - playerPosition.x, nearestZ - playerPosition.z);

        let ringIndex = -1;
        for (let i = 0; i < rings.length; i++) {
          const ring = rings[i];
          if (ring && distance <= ring.radius) {
            ringIndex = i;
            break;
          }
        }
        if (ringIndex === -1) continue; // beyond the last ring — not rendered yet (Phase 5 horizon fake)

        const chunk = this.getOrBuildChunk(cx, cz, originX, originZ);
        const matrices = chunk.tierMatrices[ringIndex];
        const positionsXZ = chunk.tierPositions[ringIndex];
        const count = chunk.tierCounts[ringIndex];
        if (!matrices || !positionsXZ || count === undefined) continue;

        const capacity = this.ringCapacities[ringIndex] ?? 0;
        const used = ringCounts[ringIndex] ?? 0;
        if (used + count > capacity) {
          if (!this.hasWarnedRingOverflow) {
            console.warn(`GrassField: ring ${ringIndex} capacity exceeded, dropping some chunks`);
            this.hasWarnedRingOverflow = true;
          }
          continue;
        }

        const mesh = this.ringMeshes[ringIndex];
        const vitalityAttribute = this.ringVitalityAttributes[ringIndex];
        if (!mesh || !vitalityAttribute) continue;
        (mesh.instanceMatrix.array as Float32Array).set(matrices.subarray(0, count * 16), used * 16);
        const vitalityArray = vitalityAttribute.array as Float32Array;
        const sample = this.sampleVitality;
        if (sample) {
          for (let k = 0; k < count; k++) {
            vitalityArray[used + k] = sample(positionsXZ[k * 2]!, positionsXZ[k * 2 + 1]!);
          }
        } else {
          vitalityArray.fill(0, used, used + count);
        }
        ringCounts[ringIndex] = used + count;
      }
    }

    for (let ringIndex = 0; ringIndex < this.ringMeshes.length; ringIndex++) {
      const mesh = this.ringMeshes[ringIndex];
      if (!mesh) continue;
      mesh.count = ringCounts[ringIndex] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      const vitalityAttribute = this.ringVitalityAttributes[ringIndex];
      if (vitalityAttribute) vitalityAttribute.needsUpdate = true;
      const ring = rings[ringIndex];
      // InstancedMesh has its OWN boundingSphere/boundingBox — separate from
      // (and not derived from) geometry.boundingSphere, which only bounds
      // the single un-instanced blade shape. Frustum culling for an
      // InstancedMesh reads THIS property, defaulting to an uninitialized
      // {center: (0,0,0), radius: -1} that never gets computed on its own.
      // This was the actual root cause behind the whole "grass popping"
      // saga this session — every fix before this one was real, but each
      // was only ever visible in the rare frames where this invalid sphere
      // happened to let the mesh slip through culling at all; the rest of
      // the time the entire ring was being skipped before the GPU ever saw
      // it, independent of ring radii, capacity, or chunk precision.
      // The Sphere/Box3 objects themselves are pre-allocated in the
      // constructor and assigned to the mesh once; here they're only
      // mutated in place (zero-allocation frame loop, PRD §10.3).
      const radius = ring?.radius ?? 0;
      const sphere = this.ringBoundingSpheres[ringIndex];
      const box = this.ringBoundingBoxes[ringIndex];
      if (sphere && box) {
        sphere.center.copy(playerPosition);
        sphere.radius = radius;
        box.min.set(playerPosition.x - radius, playerPosition.y - radius, playerPosition.z - radius);
        box.max.set(playerPosition.x + radius, playerPosition.y + radius, playerPosition.z + radius);
      }
    }
  }

  private getOrBuildChunk(chunkX: number, chunkZ: number, originX: number, originZ: number): ChunkData {
    const key = `${chunkX},${chunkZ}`;
    const cached = this.chunkCache.get(key);
    if (cached) return cached;

    const built = this.buildChunk(chunkX, chunkZ, originX, originZ);
    this.chunkCache.set(key, built);
    return built;
  }

  /** Jittered-grid blue-noise scatter at the finest (ring 0) density, each
   *  point tagged with a random "keep rank." Coarser rings keep the subset
   *  of points whose rank falls under that ring's density ratio, so a
   *  point never disappears and reappears somewhere unrelated as the
   *  player moves between rings — the same blades just thin out. */
  private buildChunk(chunkX: number, chunkZ: number, originX: number, originZ: number): ChunkData {
    const rng = chunkRandom(this.config.seed, chunkX, chunkZ);
    const finestDensity = GRASS.LOD_RINGS[0]?.density ?? 0;
    const chunkArea = GRASS.CHUNK_SIZE * GRASS.CHUNK_SIZE;
    const targetCount = Math.round(chunkArea * finestDensity);
    const cellsPerSide = Math.max(1, Math.ceil(Math.sqrt(targetCount)));
    const cellSize = GRASS.CHUNK_SIZE / cellsPerSide;

    const xs: number[] = [];
    const zs: number[] = [];
    const ranks: number[] = [];
    const yaws: number[] = [];
    const heightScales: number[] = [];

    for (let j = 0; j < cellsPerSide; j++) {
      for (let i = 0; i < cellsPerSide; i++) {
        xs.push(originX + (i + rng()) * cellSize);
        zs.push(originZ + (j + rng()) * cellSize);
        ranks.push(rng());
        yaws.push(rng() * Math.PI * 2);
        heightScales.push(1 + (rng() * 2 - 1) * GRASS.HEIGHT_JITTER);
      }
    }

    const scratchMatrix = new THREE.Matrix4();
    const scratchQuat = new THREE.Quaternion();
    const scratchEuler = new THREE.Euler();
    const scratchPos = new THREE.Vector3();
    const scratchScale = new THREE.Vector3();

    const tierMatrices: Float32Array[] = [];
    const tierPositions: Float32Array[] = [];
    const tierCounts: number[] = [];

    for (const ring of GRASS.LOD_RINGS) {
      const ratio = ring.density / finestDensity;
      const kept: number[] = [];
      for (let p = 0; p < ranks.length; p++) {
        if ((ranks[p] ?? 1) < ratio) kept.push(p);
      }

      const buffer = new Float32Array(kept.length * 16);
      const positionsXZ = new Float32Array(kept.length * 2);
      for (let k = 0; k < kept.length; k++) {
        const p = kept[k];
        if (p === undefined) continue;
        const x = xs[p] ?? 0;
        const z = zs[p] ?? 0;
        const y = this.config.getHeightAt(x, z);
        // Baked at the ALIVE height; the shader shrinks dead blades via
        // the per-instance aVitality attribute (see rebuild()).
        const height = GRASS.HEIGHT_ALIVE * (heightScales[p] ?? 1);

        scratchPos.set(x, y, z);
        scratchEuler.set(0, yaws[p] ?? 0, 0);
        scratchQuat.setFromEuler(scratchEuler);
        scratchScale.set(1, height, height); // scale.z too, so the local-Z static curve scales with height
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        scratchMatrix.toArray(buffer, k * 16);
        positionsXZ[k * 2] = x;
        positionsXZ[k * 2 + 1] = z;
      }

      tierMatrices.push(buffer);
      tierPositions.push(positionsXZ);
      tierCounts.push(kept.length);
    }

    return { tierMatrices, tierPositions, tierCounts };
  }

  /** Found via the fresh review's video evidence: grass was silently
   *  dropping chunks (hence "popping") ANYWHERE on the map, not just near
   *  the LOD fade boundaries or the level edge. Root cause was this
   *  function treating a ring's search radius as a smooth circle — but
   *  rebuild() admits a chunk whenever its NEAREST point is within radius,
   *  so a chunk only needs one corner inside the true radius to qualify.
   *  A smooth-circle area estimate silently undercounts how many chunks
   *  that can actually be, and the undercount gets worse the smaller a
   *  ring's radius is relative to CHUNK_SIZE — exactly what happened when
   *  ring 0's radius was raised from 20 to 32 to fix the fade-band issue:
   *  the true worst case is 68-69 qualifying chunks (confirmed by
   *  exhaustively scanning the player's sub-chunk offset, not sampling),
   *  but the old formula only budgeted for ~63. Whenever the player's
   *  sub-chunk position pushed the real count above that, rebuild() would
   *  silently `continue` past the rest of ring 0's chunks for that frame —
   *  no fade, no warning after the first, just missing grass until the
   *  player's position shifted the count back down. That's what was
   *  actually behind "grass popping in the middle of the map."
   *
   *  Fix: expand the radius by a full chunk diagonal before treating it as
   *  a disk. Any chunk whose nearest point is within `ring.radius` must
   *  have its CENTER within `ring.radius + CHUNK_SIZE*sqrt(2)/2` of the
   *  player (the farthest any point in a chunk can sit from that chunk's
   *  own center) — padding by a full diagonal instead of half is extra
   *  slack for the lattice-counting itself, so this is a provable upper
   *  bound rather than a heuristic that happens to fit today's numbers. */
  private computeRingCapacity(ringIndex: number): number {
    const rings = GRASS.LOD_RINGS;
    const ring = rings[ringIndex];
    if (!ring) return 0;

    const finestDensity = rings[0]?.density ?? 0;
    const chunkSize = GRASS.CHUNK_SIZE;
    const chunkArea = chunkSize * chunkSize;
    const targetCount = Math.round(chunkArea * finestDensity);
    const cellsPerSide = Math.max(1, Math.ceil(Math.sqrt(targetCount)));
    const ratio = ring.density / finestDensity;
    // At ratio 1 (the finest ring), buildChunk's `ranks[p] < ratio` filter
    // keeps every point deterministically — exact, not an estimate.
    const perChunkMax = ratio >= 1 ? cellsPerSide * cellsPerSide : targetCount * ratio;

    const chunkDiagonal = chunkSize * Math.SQRT2;
    const effectiveRadius = ring.radius + chunkDiagonal;
    const maxChunks = Math.ceil((Math.PI * effectiveRadius * effectiveRadius) / chunkArea);

    return Math.ceil(maxChunks * perChunkMax * RING_CAPACITY_SAFETY_MARGIN);
  }

  /** 5 segments → 5 paired cross-section levels (t = 0, 0.2, 0.4, 0.6, 0.8)
   *  plus a single tip vertex at t = 1.0: 11 vertices, 9 triangles, per
   *  PRD §6.2. Local Y is a 0..1 HEIGHT FRACTION, not metres — the shader
   *  scales it by this instance's actual height via instanceMatrix.
   *  Local X is the half-width offset in real metres, tapering per level. */
  private buildBladeGeometry(): THREE.BufferGeometry {
    const levels = GRASS.SEGMENTS;
    const positions: number[] = [];
    const normals: number[] = [];

    for (let level = 0; level < levels; level++) {
      const t = level * (0.8 / (levels - 1));
      const halfWidth = (GRASS.WIDTH / 2) * (1 - 0.875 * t);
      positions.push(-halfWidth, t, 0, halfWidth, t, 0);
      normals.push(0, 0, 1, 0, 0, 1);
    }
    positions.push(0, 1.0, 0); // tip
    normals.push(0, 0, 1);

    const tipIndex = levels * 2;
    const indices: number[] = [];
    for (let level = 0; level < levels - 1; level++) {
      const a = level * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    const lastPairBase = (levels - 1) * 2;
    indices.push(lastPairBase, lastPairBase + 1, tipIndex);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  private buildMaterial(palette: Palette): THREE.ShaderMaterial {
    const windDirection = new THREE.Vector2(WIND.DIRECTION[0], WIND.DIRECTION[1]).normalize();
    const rings = GRASS.LOD_RINGS;
    const ringBoundaries = new THREE.Vector3(rings[0]?.radius ?? 0, rings[1]?.radius ?? 0, rings[2]?.radius ?? 0);

    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader: `${noiseSource}\n${grassVertSource}`,
      fragmentShader: `${noiseSource}\n${grassFragSource}`,
      uniforms: {
        uTime: { value: 0 },
        uCameraForward: { value: new THREE.Vector3(0, 0, -1) },

        uPlayerPosition: { value: new THREE.Vector3() },
        uRingBoundaries: { value: ringBoundaries },
        uFadeBand: { value: GRASS.EDGE_FADE_BAND },

        uWindDirection: { value: windDirection },
        uWindBaseStrength: { value: WIND.BASE_STRENGTH },
        uWindLayer1: { value: new THREE.Vector3(WIND.LAYER_1.frequency, WIND.LAYER_1.amplitude, WIND.LAYER_1.speed) },
        uWindLayer2: { value: new THREE.Vector3(WIND.LAYER_2.frequency, WIND.LAYER_2.amplitude, WIND.LAYER_2.speed) },
        uWindGust: { value: new THREE.Vector3(WIND.GUST.frequency, WIND.GUST.amplitude, WIND.GUST.speed) },

        uTrailPositions: { value: this.trailPositions },
        uTrailWeights: { value: this.trailWeights },
        uTrailCount: { value: 0 },
        uDeflectRadius: { value: WIND.DEFLECT_RADIUS },
        uDeflectStrength: { value: WIND.DEFLECT_STRENGTH },

        uCurveAmount: { value: GRASS.CURVE_AMOUNT },
        uViewWiden: { value: GRASS.VIEW_WIDEN },

        uAliveBase: { value: paletteColor(palette.grass.aliveBase) },
        uAliveTip: { value: paletteColor(palette.grass.aliveTip) },
        uDeadBase: { value: paletteColor(palette.grass.deadBase) },
        uDeadTip: { value: paletteColor(palette.grass.deadTip) },

        // The vitality field (PRD §5.4) — texture wired by setVitality()
        // once main.ts has built the VitalityField.
        uVitalityMap: { value: null },
        uVitalityBoundsMin: { value: new THREE.Vector2() },
        uVitalityBoundsSize: { value: new THREE.Vector2(1, 1) },
        // Blade heights were baked at HEIGHT_ALIVE, so the dead scale is
        // the ratio the shader shrinks a fully dead blade down to.
        uDeadHeightScale: { value: GRASS.HEIGHT_DEAD / GRASS.HEIGHT_ALIVE },
        uVitalityHeightInfluence: { value: VITALITY.HEIGHT_INFLUENCE },

        uRootDarken: { value: GRASS.ROOT_DARKEN },
        uPatchScale: { value: GRASS.PATCH_SCALE },
        uPatchStrength: { value: GRASS.PATCH_STRENGTH },
        uBacklightStrength: { value: GRASS.BACKLIGHT_STRENGTH },
        uBacklightPower: { value: GRASS.BACKLIGHT_POWER },

        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uSunIntensity: { value: 1.0 },
        uAmbientColor: { value: new THREE.Color(0xffffff) },
        uAmbientIntensity: { value: 0.5 },
        uLightWrap: { value: GRASS.LIGHT_WRAP },
        uPlayerGlowRadius: { value: PLAYER_LIGHT.RADIUS },
        uPlayerGlowIntensity: { value: PLAYER_LIGHT.INTENSITY },

        uFogColor: { value: paletteColor(palette.fog.color) },
        uFogNear: { value: palette.fog.near },
        uFogFar: { value: palette.fog.far },
      },
    });
  }

  /** Force a ring-buffer rebuild on the next fixed step. Called on every
   *  bloom so per-blade vitality heights update immediately instead of
   *  waiting for the player's next chunk crossing. */
  requestRebuild(): void {
    this.lastRebuildChunkX = Number.NaN;
    this.lastRebuildChunkZ = Number.NaN;
  }

  /** Wire the shared vitality field in — called once by main.ts. */
  setVitality(texture: THREE.Texture, boundsMin: THREE.Vector2, boundsSize: THREE.Vector2): void {
    this.material.uniforms.uVitalityMap!.value = texture;
    (this.material.uniforms.uVitalityBoundsMin!.value as THREE.Vector2).copy(boundsMin);
    (this.material.uniforms.uVitalityBoundsSize!.value as THREE.Vector2).copy(boundsSize);
  }

  /** Main.ts calls this once, after computing the palette-derived sun
   *  direction and colours it also uses for the terrain and scene lights,
   *  so both systems are lit consistently. */
  setLighting(sunDirection: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number, ambientColor: THREE.Color, ambientIntensity: number): void {
    (this.material.uniforms.uSunDirection!.value as THREE.Vector3).copy(sunDirection);
    (this.material.uniforms.uSunColor!.value as THREE.Color).copy(sunColor);
    this.material.uniforms.uSunIntensity!.value = sunIntensity;
    (this.material.uniforms.uAmbientColor!.value as THREE.Color).copy(ambientColor);
    this.material.uniforms.uAmbientIntensity!.value = ambientIntensity;
  }
}
