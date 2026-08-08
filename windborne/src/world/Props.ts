import * as THREE from 'three';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { PROPS, TERRAIN } from '../config/tuning';
import { paletteColor, type Palette } from '../config/palettes';
import { mulberry32 } from '../core/Random';
import type { LevelBounds } from '../player/WindController';
import type { LevelProp } from '../level/LevelLoader';
import propVertSource from '../render/shaders/prop.vert.glsl?raw';
import propFragSource from '../render/shaders/prop.frag.glsl?raw';

/**
 * Trees and rocks — the landscape's landmarks (PRD §6.1, `Props.ts` in
 * the §10.2 module layout).
 *
 * Two sources, one renderer:
 * - **Ambient scatter**: seeded from the level seed and gathered into
 *   groves by a low-frequency noise field, so the meadow has recognisable
 *   features to navigate by without any of it being authored content.
 * - **Authored props**: whatever the ?edit=1 tool wrote into the level's
 *   `props` array. Placed exactly where they were put.
 *
 * **Avoiding the clone-army look.** Variety comes from three layers,
 * because scale alone is not enough — a hillside of one blob at assorted
 * sizes still reads as one blob:
 *   1. Several distinct base silhouettes per type (PROPS.*_VARIANTS),
 *      each its own geometry so the low-poly facets keep correct flat
 *      normals. The geometry is non-indexed, so displacing it in a
 *      vertex shader instead would leave the shading stale.
 *   2. Per-instance non-uniform stretch — width and height jittered
 *      independently, which changes proportion rather than just size.
 *   3. Per-instance orientation: trees get a small lean off vertical,
 *      rocks get fully arbitrary rotation.
 *
 * Cost is one draw call per (type × variant) plus one for all trunks —
 * a handful, against a scene budget measured in tens.
 *
 * Trees read the vitality field: on dead land the canopy is a bare,
 * squat, grey silhouette, and blooming the ground beneath fills it back
 * out to green. That is the PRD's `revive-props` event arriving for free
 * out of §5.4 rather than needing its own scripting.
 */

interface PropInstance {
  x: number;
  z: number;
  y: number;
  yaw: number;
  scale: number;
  /** Index into the type's variant table. */
  variant: number;
  /** Independent per-axis stretch, so proportion varies, not just size. */
  stretchX: number;
  stretchY: number;
  stretchZ: number;
  /** Trees: tilt off vertical and the compass direction of that tilt.
   *  Rocks: reused as two of their three free rotation angles. */
  lean: number;
  leanDir: number;
  isRock: boolean;
}

export interface PropsConfig {
  seed: number;
  bounds: LevelBounds;
  getHeightAt: (x: number, z: number) => number;
  authored: LevelProp[];
}

export class Props {
  readonly group = new THREE.Group();

  /** Reads the vitality field on the CPU — wired by main.ts, same source
   *  the grass uses for its per-blade heights. */
  sampleVitality: ((x: number, z: number) => number) | undefined;

  /** Trees and rocks, each grouped so all instances sharing a variant sit
   *  in one contiguous run (see buildVariantMeshes). */
  private readonly trees: PropInstance[] = [];
  private readonly rocks: PropInstance[] = [];

  private trunkMesh!: THREE.InstancedMesh;
  private trunkVitality!: THREE.InstancedBufferAttribute;
  private readonly canopyMeshes: THREE.InstancedMesh[] = [];
  private readonly canopyVitality: THREE.InstancedBufferAttribute[] = [];
  private readonly rockMeshes: THREE.InstancedMesh[] = [];
  private readonly rockVitality: THREE.InstancedBufferAttribute[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(config: PropsConfig, palette: Palette) {
    const noise = createNoise2D(mulberry32(config.seed ^ 0x5eed7 /* distinct stream from terrain */));
    this.collectAmbient(config, noise);
    this.collectAuthored(config);
    // Group by variant so each variant's instances are contiguous, which
    // lets one mesh per variant index its slice directly.
    this.trees.sort((a, b) => a.variant - b.variant);
    this.rocks.sort((a, b) => a.variant - b.variant);

    // Colours are derived from the existing palette rather than added to
    // it — palettes.ts is a reviewed, locked file, and bark/foliage sit
    // comfortably within colours it already defines.
    const bark = paletteColor(palette.terrain.dirt).multiplyScalar(0.62);
    const barkDead = paletteColor(palette.terrain.deadGrass).multiplyScalar(0.5);
    const foliageAlive = paletteColor(palette.grass.aliveBase).multiplyScalar(0.85);
    const foliageDead = paletteColor(palette.terrain.deadGrass).multiplyScalar(0.72);
    const rockAlive = paletteColor(palette.terrain.rock).lerp(paletteColor(palette.grass.aliveBase), 0.18);
    const rockDead = paletteColor(palette.terrain.rock);

    // Trunks are cylinders — proportion jitter alone varies them enough,
    // so they all share one mesh.
    this.trunkMesh = this.buildMesh(this.buildTrunkGeometry(), palette, 0, barkDead, bark, Math.max(this.trees.length, 1));
    this.trunkVitality = this.attachVitality(this.trunkMesh, Math.max(this.trees.length, 1));

    this.buildVariantMeshes(
      PROPS.CANOPY_VARIANTS,
      this.trees,
      this.canopyMeshes,
      this.canopyVitality,
      palette,
      1,
      foliageDead,
      foliageAlive,
      PROPS.CANOPY_LUMPINESS,
      PROPS.CANOPY_SQUASH,
      config.seed ^ 0xa1,
    );
    this.buildVariantMeshes(
      PROPS.ROCK_VARIANTS,
      this.rocks,
      this.rockMeshes,
      this.rockVitality,
      palette,
      2,
      rockDead,
      rockAlive,
      PROPS.ROCK_LUMPINESS,
      PROPS.ROCK_FLATTEN,
      config.seed ^ 0xb2,
    );

    this.placeInstances();
    this.group.add(this.trunkMesh, ...this.canopyMeshes, ...this.rockMeshes);
  }

  /** Refresh per-instance vitality. Called on every bloom — props are a
   *  hundred instances, so this is far cheaper than it is clever. */
  refreshVitality(): void {
    const sample = this.sampleVitality;
    if (!sample) return;

    const trunkArray = this.trunkVitality.array as Float32Array;
    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i]!;
      trunkArray[i] = sample(tree.x, tree.z);
    }
    this.trunkVitality.needsUpdate = true;

    this.refreshVariantVitality(this.trees, this.canopyVitality, sample);
    this.refreshVariantVitality(this.rocks, this.rockVitality, sample);
  }

  private refreshVariantVitality(
    instances: PropInstance[],
    attributes: THREE.InstancedBufferAttribute[],
    sample: (x: number, z: number) => number,
  ): void {
    const nextIndex = new Array<number>(attributes.length).fill(0);
    for (const instance of instances) {
      const attribute = attributes[instance.variant];
      if (!attribute) continue;
      const local = nextIndex[instance.variant]!;
      (attribute.array as Float32Array)[local] = sample(instance.x, instance.z);
      nextIndex[instance.variant] = local + 1;
    }
    for (const attribute of attributes) attribute.needsUpdate = true;
  }

  setLighting(sunDirection: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number, ambientColor: THREE.Color, ambientIntensity: number): void {
    for (const material of this.materials) {
      (material.uniforms.uSunDirection!.value as THREE.Vector3).copy(sunDirection);
      (material.uniforms.uSunColor!.value as THREE.Color).copy(sunColor);
      material.uniforms.uSunIntensity!.value = sunIntensity;
      (material.uniforms.uAmbientColor!.value as THREE.Color).copy(ambientColor);
      material.uniforms.uAmbientIntensity!.value = ambientIntensity;
    }
  }

  getInstanceCount(): number {
    return this.trees.length + this.rocks.length;
  }

  // -------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------

  /** Jittered grid, thinned into groves by a noise field. Trees avoid
   *  steep ground, rocks tolerate it — each looks wrong where the other
   *  belongs. */
  private collectAmbient(config: PropsConfig, noise: NoiseFunction2D): void {
    const rng = mulberry32(config.seed ^ 0x9e37);
    const cell = PROPS.SCATTER_CELL;
    const { min, max } = config.bounds;

    for (let z = min[1]; z < max[1]; z += cell) {
      for (let x = min[0]; x < max[0]; x += cell) {
        if (rng() > PROPS.CELL_FILL_CHANCE) continue;

        const px = x + rng() * cell;
        const pz = z + rng() * cell;
        // Grove field: props only appear where this noise is high, which
        // clumps them instead of dotting them evenly.
        if (noise(px * PROPS.GROVE_FREQUENCY, pz * PROPS.GROVE_FREQUENCY) < PROPS.GROVE_THRESHOLD) continue;

        const flatness = this.flatnessAt(config.getHeightAt, px, pz);
        const wantsRock = rng() < PROPS.ROCK_FRACTION;
        if (wantsRock) {
          if (flatness < PROPS.ROCK_MIN_FLATNESS) continue;
          this.rocks.push(this.makeInstance(config, px, pz, rng, true));
        } else {
          if (flatness < PROPS.TREE_MIN_FLATNESS) continue;
          this.trees.push(this.makeInstance(config, px, pz, rng, false));
        }
      }
    }
  }

  /** Props the placement tool wrote into the level. `dead-tree` is the
   *  PRD's named type; anything else is treated as a rock for now, and
   *  new types land here as they're designed. */
  private collectAuthored(config: PropsConfig): void {
    const rng = mulberry32(config.seed ^ 0xaf7);
    for (const prop of config.authored) {
      const [x, z] = prop.pos;
      const isRock = prop.type !== 'dead-tree' && prop.type !== 'tree';
      const instance = this.makeInstance(config, x, z, rng, isRock);
      (isRock ? this.rocks : this.trees).push(instance);
    }
  }

  private makeInstance(
    config: PropsConfig,
    x: number,
    z: number,
    rng: () => number,
    isRock: boolean,
  ): PropInstance {
    const sizeJitter = isRock ? PROPS.ROCK_RADIUS_JITTER : PROPS.TREE_HEIGHT_JITTER;
    const stretchJitter = isRock ? PROPS.ROCK_STRETCH_JITTER : PROPS.TREE_STRETCH_JITTER;
    const variantCount = isRock ? PROPS.ROCK_VARIANTS.length : PROPS.CANOPY_VARIANTS.length;
    const jitter = (): number => 1 + (rng() * 2 - 1) * stretchJitter;
    return {
      x,
      z,
      y: config.getHeightAt(x, z),
      yaw: rng() * Math.PI * 2,
      scale: 1 + (rng() * 2 - 1) * sizeJitter,
      variant: Math.min(variantCount - 1, Math.floor(rng() * variantCount)),
      stretchX: jitter(),
      stretchY: jitter(),
      stretchZ: jitter(),
      lean: rng() * (isRock ? Math.PI * 2 : PROPS.TREE_LEAN),
      leanDir: rng() * Math.PI * 2,
      isRock,
    };
  }

  /** dot(normal, up) from the height field's gradient — 1.0 is level, 0.0
   *  is vertical. The same measure TERRAIN.SLOPE_* uses, so "flat" means
   *  the same thing here as it does for the terrain's grass/rock blend. */
  private flatnessAt(getHeightAt: (x: number, z: number) => number, x: number, z: number): number {
    const eps = 0.75;
    const dhdx = (getHeightAt(x + eps, z) - getHeightAt(x - eps, z)) / (2 * eps);
    const dhdz = (getHeightAt(x, z + eps) - getHeightAt(x, z - eps)) / (2 * eps);
    return 1 / Math.sqrt(dhdx * dhdx + dhdz * dhdz + 1);
  }

  private placeInstances(): void {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const leanQuat = new THREE.Quaternion();
    const yawQuat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const canopyOffset = new THREE.Vector3();

    const canopyNext = new Array<number>(this.canopyMeshes.length).fill(0);
    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i]!;
      const height = PROPS.TREE_HEIGHT * tree.scale;

      // Lean: tilt off vertical about a random horizontal axis, applied
      // after the trunk's own yaw so both trunk and canopy share it.
      axis.set(Math.cos(tree.leanDir), 0, Math.sin(tree.leanDir));
      leanQuat.setFromAxisAngle(axis, tree.lean);
      yawQuat.setFromAxisAngle(up, tree.yaw);
      quaternion.copy(leanQuat).multiply(yawQuat);

      position.set(tree.x, tree.y, tree.z);
      scale.set(tree.scale, height, tree.scale);
      matrix.compose(position, quaternion, scale);
      this.trunkMesh.setMatrixAt(i, matrix);

      // Canopy rides the leaned trunk's top, so it sits on the trunk
      // rather than beside it.
      const canopyMesh = this.canopyMeshes[tree.variant];
      const canopyIndex = canopyNext[tree.variant];
      if (canopyMesh && canopyIndex !== undefined) {
        const canopyRadius = height * PROPS.CANOPY_RADIUS;
        canopyOffset.set(0, height * PROPS.CANOPY_BASE, 0).applyQuaternion(leanQuat);
        position.set(tree.x + canopyOffset.x, tree.y + canopyOffset.y, tree.z + canopyOffset.z);
        scale.set(
          canopyRadius * tree.stretchX,
          canopyRadius * tree.stretchY,
          canopyRadius * tree.stretchZ,
        );
        matrix.compose(position, quaternion, scale);
        canopyMesh.setMatrixAt(canopyIndex, matrix);
        canopyNext[tree.variant] = canopyIndex + 1;
      }
    }
    this.trunkMesh.count = this.trees.length;
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    for (let v = 0; v < this.canopyMeshes.length; v++) {
      const mesh = this.canopyMeshes[v]!;
      mesh.count = canopyNext[v] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }

    const rockNext = new Array<number>(this.rockMeshes.length).fill(0);
    for (const rock of this.rocks) {
      const mesh = this.rockMeshes[rock.variant];
      const index = rockNext[rock.variant];
      if (!mesh || index === undefined) continue;
      const radius = PROPS.ROCK_RADIUS * rock.scale;
      // Rocks have no up — tumble them freely so no two sit alike.
      euler.set(rock.lean, rock.yaw, rock.leanDir);
      quaternion.setFromEuler(euler);
      // Sunk slightly so boulders sit IN the ground, not on it.
      position.set(rock.x, rock.y - radius * 0.25, rock.z);
      scale.set(radius * rock.stretchX, radius * rock.stretchY, radius * rock.stretchZ);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      rockNext[rock.variant] = index + 1;
    }
    for (let v = 0; v < this.rockMeshes.length; v++) {
      const mesh = this.rockMeshes[v]!;
      mesh.count = rockNext[v] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.computeStaticBounds();
  }

  /** Props never move, so their bounds are computed once. This is the
   *  MESH-level boundingSphere, not the geometry's — an InstancedMesh
   *  frustum-culls against its own, and leaving it unset is what made
   *  the entire grass field vanish earlier in this project. */
  private computeStaticBounds(): void {
    const all = [...this.trees, ...this.rocks];
    const meshes = [this.trunkMesh, ...this.canopyMeshes, ...this.rockMeshes];
    if (all.length === 0) {
      for (const mesh of meshes) mesh.frustumCulled = false;
      return;
    }
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const instance of all) {
      const reach = instance.isRock
        ? PROPS.ROCK_RADIUS * instance.scale * 2
        : PROPS.TREE_HEIGHT * instance.scale;
      point.set(instance.x - reach, instance.y - reach, instance.z - reach);
      box.expandByPoint(point);
      point.set(instance.x + reach, instance.y + reach * 1.5, instance.z + reach);
      box.expandByPoint(point);
    }
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    for (const mesh of meshes) {
      mesh.boundingBox = box.clone();
      mesh.boundingSphere = sphere.clone();
    }
  }

  // -------------------------------------------------------------------
  // Geometry and material
  // -------------------------------------------------------------------

  /** One mesh per shape variant, sized to how many instances chose it. */
  private buildVariantMeshes(
    variants: readonly (readonly [number, number])[],
    instances: PropInstance[],
    meshes: THREE.InstancedMesh[],
    attributes: THREE.InstancedBufferAttribute[],
    palette: Palette,
    partKind: number,
    colorDead: THREE.Color,
    colorAlive: THREE.Color,
    baseLumpiness: number,
    baseSquash: number,
    seed: number,
  ): void {
    for (let v = 0; v < variants.length; v++) {
      const [lumpMul, squashMul] = variants[v]!;
      const capacity = Math.max(instances.filter((i) => i.variant === v).length, 1);
      const geometry = this.buildBlobGeometry(baseLumpiness * lumpMul, baseSquash * squashMul, seed + v * 977);
      const mesh = this.buildMesh(geometry, palette, partKind, colorDead, colorAlive, capacity);
      meshes.push(mesh);
      attributes.push(this.attachVitality(mesh, capacity));
    }
  }

  /** Tapered five-sided trunk, unit height, origin at the base. Five
   *  sides rather than a smooth cylinder: the whole game is faceted and
   *  a round trunk reads as imported from a different project. */
  private buildTrunkGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.CylinderGeometry(
      PROPS.TRUNK_RADIUS * 0.55,
      PROPS.TRUNK_RADIUS,
      1,
      5,
      1,
      true,
    );
    geometry.translate(0, 0.5, 0); // origin to the base
    return geometry;
  }

  /** Lumpy low-poly blob, unit radius, origin at its underside. Used for
   *  both canopies and rocks with different lumpiness and squash. */
  private buildBlobGeometry(lumpiness: number, flatten: number, seed: number): THREE.BufferGeometry {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const positions = geometry.getAttribute('position');
    const rng = mulberry32(seed);
    // Displace by a per-DIRECTION amount so coincident vertices move
    // together (the geometry is non-indexed, so each face carries its own
    // copies — displacing per index would tear the surface open).
    const offsets = new Map<string, number>();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      let offset = offsets.get(key);
      if (offset === undefined) {
        offset = 1 + (rng() * 2 - 1) * lumpiness;
        offsets.set(key, offset);
      }
      positions.setXYZ(i, x * offset, y * offset * flatten, z * offset);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const minY = geometry.boundingBox?.min.y ?? -1;
    geometry.translate(0, -minY, 0); // origin to the underside
    return geometry;
  }

  private buildMesh(
    geometry: THREE.BufferGeometry,
    palette: Palette,
    partKind: number,
    colorDead: THREE.Color,
    colorAlive: THREE.Color,
    capacity: number,
  ): THREE.InstancedMesh {
    const material = new THREE.ShaderMaterial({
      vertexShader: propVertSource,
      fragmentShader: propFragSource,
      uniforms: {
        uPartKind: { value: partKind },
        uCanopyDeadScale: { value: PROPS.CANOPY_DEAD_SCALE },
        uColorDead: { value: colorDead },
        uColorAlive: { value: colorAlive },

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
    this.materials.push(material);
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    return mesh;
  }

  private attachVitality(mesh: THREE.InstancedMesh, capacity: number): THREE.InstancedBufferAttribute {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    attribute.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aVitality', attribute);
    return attribute;
  }
}
