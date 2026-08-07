import * as THREE from 'three';
import { BLOOM, FLOWERS, TERRAIN } from '../config/tuning';
import { paletteColor, type Palette } from '../config/palettes';
import type { LevelBounds } from '../player/WindController';
import flowerVertSource from '../render/shaders/flower.vert.glsl?raw';
import flowerFragSource from '../render/shaders/flower.frag.glsl?raw';

export interface FlowerPlacement {
  x: number;
  z: number;
  species: string;
}

/** Fired when the player blooms a flower — main.ts uses it to spawn the
 *  trail petal, splat the vitality field, and (in Phase 4) play the chime. */
export type BloomHandler = (worldPosition: THREE.Vector3, petalColor: THREE.Color) => void;

/**
 * Instanced flowers with a shader-driven bloom animation (PRD §5.3, §6.3).
 * Each instance carries a bloom timestamp attribute (-1 = unbloomed);
 * blooming writes one float and lets the vertex shader unfurl the petals,
 * so the CPU cost of a bloom is an attribute upload, not a mesh change.
 *
 * Placement is authored, not random (PRD §6.3) — the authoring tool is
 * Phase 3a. Until then callers pass placements in; main.ts builds an
 * OBVIOUSLY TEMPORARY line, clearly labelled, per the working agreement.
 */
export class FlowerField {
  readonly mesh: THREE.InstancedMesh;
  onBloom: BloomHandler | undefined;

  private readonly material: THREE.ShaderMaterial;
  private readonly bloomTimes: THREE.InstancedBufferAttribute;
  private readonly positions: Float32Array; // world xyz per flower (bloom checks + callbacks)
  private readonly petalColors: Float32Array;
  /** Indices of not-yet-bloomed flowers; swap-removed as they bloom so
   *  the per-step proximity scan only ever touches live candidates. */
  private readonly unbloomed: number[] = [];
  private lastRenderTime = 0;

  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchUp = new THREE.Vector3(0, 1, 0);

  constructor(
    placements: FlowerPlacement[],
    palette: Palette,
    getHeightAt: (x: number, z: number) => number,
    bounds: LevelBounds,
  ) {
    const count = placements.length;
    this.positions = new Float32Array(count * 3);
    this.petalColors = new Float32Array(count * 3);

    const geometry = this.buildFlowerGeometry();
    this.material = this.buildMaterial(palette);
    this.mesh = new THREE.InstancedMesh(geometry, this.material, count);
    // A few hundred small flowers: culling would need per-frame mesh-level
    // bounds upkeep (the GrassField lesson) for no measurable win.
    this.mesh.frustumCulled = false;

    const bloomTimeArray = new Float32Array(count).fill(-1);
    this.bloomTimes = new THREE.InstancedBufferAttribute(bloomTimeArray, 1);
    this.bloomTimes.setUsage(THREE.DynamicDrawUsage);
    const petalColorAttr = new THREE.InstancedBufferAttribute(this.petalColors, 3);
    const centerColors = new Float32Array(count * 3);
    const centerColorAttr = new THREE.InstancedBufferAttribute(centerColors, 3);
    geometry.setAttribute('aBloomTime', this.bloomTimes);
    geometry.setAttribute('aPetalColor', petalColorAttr);
    geometry.setAttribute('aCenterColor', centerColorAttr);

    for (let i = 0; i < count; i++) {
      const placement = placements[i]!;
      const x = THREE.MathUtils.clamp(placement.x, bounds.min[0], bounds.max[0]);
      const z = THREE.MathUtils.clamp(placement.z, bounds.min[1], bounds.max[1]);
      const y = getHeightAt(x, z);
      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;

      const species = palette.flowers[placement.species] ?? palette.flowers['pink'];
      const petal = paletteColor(species?.color ?? 0xf2a0c4);
      const center = paletteColor(species?.center ?? 0xfff2dc);
      this.petalColors[i * 3] = petal.r;
      this.petalColors[i * 3 + 1] = petal.g;
      this.petalColors[i * 3 + 2] = petal.b;
      centerColors[i * 3] = center.r;
      centerColors[i * 3 + 1] = center.g;
      centerColors[i * 3 + 2] = center.b;

      // Per-flower yaw + slight size variety so a line doesn't read as
      // stamped copies. Deterministic from index — no RNG state to carry.
      const yaw = (i * 2.399963) % (Math.PI * 2); // golden-angle steps
      const scale = 0.9 + ((i * 7919) % 100) / 100 * 0.35;
      this.scratchPosition.set(x, y, z);
      this.scratchQuat.setFromAxisAngle(this.scratchUp, yaw);
      this.scratchScale.setScalar(scale);
      this.scratchMatrix.compose(this.scratchPosition, this.scratchQuat, this.scratchScale);
      this.mesh.setMatrixAt(i, this.scratchMatrix);

      this.unbloomed.push(i);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Proximity bloom check, once per fixed step. The bloom radius is
   *  measured from the flower's head (stem top), not its root — the
   *  generous-on-purpose rule in tuning.ts, applied to the part of the
   *  flower the player actually aims at. */
  fixedUpdate(playerPosition: THREE.Vector3): void {
    const radiusSq = BLOOM.RADIUS * BLOOM.RADIUS;
    for (let u = this.unbloomed.length - 1; u >= 0; u--) {
      const i = this.unbloomed[u]!;
      const dx = this.positions[i * 3]! - playerPosition.x;
      const dy = this.positions[i * 3 + 1]! + FLOWERS.STEM_HEIGHT - playerPosition.y;
      const dz = this.positions[i * 3 + 2]! - playerPosition.z;
      if (dx * dx + dy * dy + dz * dz > radiusSq) continue;

      this.bloomTimes.setX(i, this.lastRenderTime);
      this.bloomTimes.needsUpdate = true;
      const last = this.unbloomed.length - 1;
      this.unbloomed[u] = this.unbloomed[last]!;
      this.unbloomed.pop();

      if (this.onBloom) {
        this.scratchPosition.set(
          this.positions[i * 3]!,
          this.positions[i * 3 + 1]! + FLOWERS.STEM_HEIGHT,
          this.positions[i * 3 + 2]!,
        );
        this.scratchColor.setRGB(
          this.petalColors[i * 3]!,
          this.petalColors[i * 3 + 1]!,
          this.petalColors[i * 3 + 2]!,
        );
        this.onBloom(this.scratchPosition, this.scratchColor);
      }
    }
  }

  /** Advance the shared clock the bloom animation runs on. Bloom stamps
   *  use this same clock (captured at the last rendered frame) so the
   *  unfurl always starts from state 0 regardless of sim/render skew. */
  render(elapsedTime: number): void {
    this.lastRenderTime = elapsedTime;
    this.material.uniforms.uTime!.value = elapsedTime;
  }

  setLighting(sunDirection: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number, ambientColor: THREE.Color, ambientIntensity: number): void {
    (this.material.uniforms.uSunDirection!.value as THREE.Vector3).copy(sunDirection);
    (this.material.uniforms.uSunColor!.value as THREE.Color).copy(sunColor);
    this.material.uniforms.uSunIntensity!.value = sunIntensity;
    (this.material.uniforms.uAmbientColor!.value as THREE.Color).copy(ambientColor);
    this.material.uniforms.uAmbientIntensity!.value = ambientIntensity;
  }

  /** One flower: a two-quad stem cross, PETAL_COUNT tapered petals, and a
   *  centre-disc fan. Petal vertices are parametric (see flower.vert.glsl);
   *  their raw positions are zeros and never read. */
  private buildFlowerGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const parts: number[] = []; // aPart: radial, width, yaw, partId
    const indices: number[] = [];

    const pushVertex = (x: number, y: number, z: number, radial: number, width: number, yaw: number, part: number): number => {
      positions.push(x, y, z);
      parts.push(radial, width, yaw, part);
      return positions.length / 3 - 1;
    };

    // Stem: two crossed vertical quads, part id 0.
    const stemW = 0.012;
    for (const [px, pz] of [
      [stemW, 0],
      [0, stemW],
    ] as const) {
      const a = pushVertex(-px, 0, -pz, 0, 0, 0, 0);
      const b = pushVertex(px, 0, pz, 0, 0, 0, 0);
      const c = pushVertex(-px, FLOWERS.STEM_HEIGHT, -pz, 0, 0, 0, 0);
      const d = pushVertex(px, FLOWERS.STEM_HEIGHT, pz, 0, 0, 0, 0);
      indices.push(a, b, c, b, d, c);
    }

    // Petals: base pair → widest pair at 55% length → tip point. Tapered
    // like the grass blades, for the same silhouette reason.
    const halfW = FLOWERS.PETAL_WIDTH / 2;
    for (let p = 0; p < FLOWERS.PETAL_COUNT; p++) {
      const yaw = (p / FLOWERS.PETAL_COUNT) * Math.PI * 2;
      const b0 = pushVertex(0, 0, 0, 0.05, -halfW * 0.35, yaw, 1);
      const b1 = pushVertex(0, 0, 0, 0.05, halfW * 0.35, yaw, 1);
      const m0 = pushVertex(0, 0, 0, 0.55, -halfW, yaw, 1);
      const m1 = pushVertex(0, 0, 0, 0.55, halfW, yaw, 1);
      const tip = pushVertex(0, 0, 0, 1, 0, yaw, 1);
      indices.push(b0, b1, m0, b1, m1, m0, m0, m1, tip);
    }

    // Centre disc: a fan at the stem top, part id 2.
    const discCenter = pushVertex(0, FLOWERS.STEM_HEIGHT, 0, 0, 0, 0, 2);
    const discSegments = 6;
    const firstRim = positions.length / 3;
    for (let s = 0; s < discSegments; s++) {
      const a = (s / discSegments) * Math.PI * 2;
      pushVertex(Math.cos(a) * FLOWERS.CENTER_RADIUS, FLOWERS.STEM_HEIGHT, Math.sin(a) * FLOWERS.CENTER_RADIUS, 0, 0, 0, 2);
    }
    for (let s = 0; s < discSegments; s++) {
      indices.push(discCenter, firstRim + s, firstRim + ((s + 1) % discSegments));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 4));
    geometry.setIndex(indices);
    return geometry;
  }

  private buildMaterial(palette: Palette): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide, // petals and stem quads are thin surfaces
      vertexShader: flowerVertSource,
      fragmentShader: flowerFragSource,
      uniforms: {
        uTime: { value: 0 },
        uAnimDuration: { value: BLOOM.ANIM_DURATION },
        uStemHeight: { value: FLOWERS.STEM_HEIGHT },
        uPetalLength: { value: FLOWERS.PETAL_LENGTH },
        uFoldClosed: { value: FLOWERS.FOLD_CLOSED },
        uFoldOpen: { value: FLOWERS.FOLD_OPEN },
        uStemScaleClosed: { value: FLOWERS.STEM_SCALE_CLOSED },
        uBudDimming: { value: FLOWERS.BUD_DIMMING },
        uFlashIntensity: { value: BLOOM.FLASH_INTENSITY },
        uFlashDuration: { value: BLOOM.FLASH_DURATION },

        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uSunIntensity: { value: 1.0 },
        uAmbientColor: { value: new THREE.Color(0xffffff) },
        uAmbientIntensity: { value: 0.5 },
        uLightWrap: { value: TERRAIN.LIGHT_WRAP },

        uFogColor: { value: paletteColor(palette.fog.color) },
        uFogNear: { value: palette.fog.near },
        uFogFar: { value: palette.fog.far },
      },
    });
  }
}
