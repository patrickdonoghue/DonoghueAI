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
 *   Regenerating from the seed means it is reproducible and costs the
 *   level file nothing.
 * - **Authored props**: whatever the ?edit=1 tool wrote into the level's
 *   `props` array (the Section B dead-tree stand and friends). These are
 *   placed exactly where they were put.
 *
 * Three InstancedMeshes total — trunk, canopy, rock — so the whole system
 * is three draw calls regardless of prop count.
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

  private readonly trunkMesh: THREE.InstancedMesh;
  private readonly canopyMesh: THREE.InstancedMesh;
  private readonly rockMesh: THREE.InstancedMesh;
  private readonly materials: THREE.ShaderMaterial[] = [];

  private readonly trees: PropInstance[] = [];
  private readonly rocks: PropInstance[] = [];
  private readonly treeVitality: THREE.InstancedBufferAttribute;
  private readonly canopyVitality: THREE.InstancedBufferAttribute;
  private readonly rockVitality: THREE.InstancedBufferAttribute;

  constructor(config: PropsConfig, palette: Palette) {
    const noise = createNoise2D(mulberry32(config.seed ^ 0x5eed7 /* distinct stream from terrain */));
    this.collectAmbient(config, noise);
    this.collectAuthored(config);

    // Colours are derived from the existing palette rather than added to
    // it — palettes.ts is a reviewed, locked file, and bark/foliage sit
    // comfortably within colours it already defines.
    const bark = paletteColor(palette.terrain.dirt).multiplyScalar(0.62);
    const barkDead = paletteColor(palette.terrain.deadGrass).multiplyScalar(0.5);
    const foliageAlive = paletteColor(palette.grass.aliveBase).multiplyScalar(0.85);
    const foliageDead = paletteColor(palette.terrain.deadGrass).multiplyScalar(0.72);
    const rockAlive = paletteColor(palette.terrain.rock).lerp(paletteColor(palette.grass.aliveBase), 0.18);
    const rockDead = paletteColor(palette.terrain.rock);

    const trunkGeometry = this.buildTrunkGeometry();
    const canopyGeometry = this.buildBlobGeometry(PROPS.CANOPY_LUMPINESS, PROPS.CANOPY_SQUASH, config.seed ^ 0xa1);
    const rockGeometry = this.buildBlobGeometry(PROPS.ROCK_LUMPINESS, PROPS.ROCK_FLATTEN, config.seed ^ 0xb2);

    this.trunkMesh = this.buildMesh(trunkGeometry, palette, 0, barkDead, bark, Math.max(this.trees.length, 1));
    this.canopyMesh = this.buildMesh(canopyGeometry, palette, 1, foliageDead, foliageAlive, Math.max(this.trees.length, 1));
    this.rockMesh = this.buildMesh(rockGeometry, palette, 2, rockDead, rockAlive, Math.max(this.rocks.length, 1));

    this.treeVitality = this.attachVitality(this.trunkMesh, Math.max(this.trees.length, 1));
    this.canopyVitality = this.attachVitality(this.canopyMesh, Math.max(this.trees.length, 1));
    this.rockVitality = this.attachVitality(this.rockMesh, Math.max(this.rocks.length, 1));

    this.placeInstances();
    this.group.add(this.trunkMesh, this.canopyMesh, this.rockMesh);
  }

  /** Refresh per-instance vitality. Called on every bloom — props are a
   *  hundred instances, so this is far cheaper than it is clever. */
  refreshVitality(): void {
    const sample = this.sampleVitality;
    if (!sample) return;
    const trunkArray = this.treeVitality.array as Float32Array;
    const canopyArray = this.canopyVitality.array as Float32Array;
    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i]!;
      const v = sample(tree.x, tree.z);
      trunkArray[i] = v;
      canopyArray[i] = v;
    }
    const rockArray = this.rockVitality.array as Float32Array;
    for (let i = 0; i < this.rocks.length; i++) {
      const rock = this.rocks[i]!;
      rockArray[i] = sample(rock.x, rock.z);
    }
    this.treeVitality.needsUpdate = true;
    this.canopyVitality.needsUpdate = true;
    this.rockVitality.needsUpdate = true;
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
   *  steep ground, rocks avoid billiard-flat ground — each looks wrong
   *  where the other belongs. */
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
    const jitter = isRock ? PROPS.ROCK_RADIUS_JITTER : PROPS.TREE_HEIGHT_JITTER;
    return {
      x,
      z,
      y: config.getHeightAt(x, z),
      yaw: rng() * Math.PI * 2,
      scale: 1 + (rng() * 2 - 1) * jitter,
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
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();

    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i]!;
      const height = PROPS.TREE_HEIGHT * tree.scale;
      euler.set(0, tree.yaw, 0);
      quaternion.setFromEuler(euler);

      // Trunk: unit-height geometry stretched to this tree's height.
      position.set(tree.x, tree.y, tree.z);
      scale.set(tree.scale, height, tree.scale);
      matrix.compose(position, quaternion, scale);
      this.trunkMesh.setMatrixAt(i, matrix);

      // Canopy: a blob sitting at the top of the trunk. Its geometry has
      // y = 0 at its underside so the shader can scale it about that
      // point when the land is dead (see prop.vert.glsl).
      const canopyRadius = height * PROPS.CANOPY_RADIUS;
      position.set(tree.x, tree.y + height * PROPS.CANOPY_BASE, tree.z);
      scale.setScalar(canopyRadius);
      matrix.compose(position, quaternion, scale);
      this.canopyMesh.setMatrixAt(i, matrix);
    }
    this.trunkMesh.count = this.trees.length;
    this.canopyMesh.count = this.trees.length;
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    this.canopyMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.rocks.length; i++) {
      const rock = this.rocks[i]!;
      const radius = PROPS.ROCK_RADIUS * rock.scale;
      euler.set(tiltFrom(rock.yaw) * 0.3, rock.yaw, tiltFrom(rock.yaw + 1) * 0.3);
      quaternion.setFromEuler(euler);
      // Sunk slightly so boulders sit IN the ground, not on it.
      position.set(rock.x, rock.y - radius * 0.25, rock.z);
      scale.setScalar(radius);
      matrix.compose(position, quaternion, scale);
      this.rockMesh.setMatrixAt(i, matrix);
    }
    this.rockMesh.count = this.rocks.length;
    this.rockMesh.instanceMatrix.needsUpdate = true;

    this.computeStaticBounds();
  }

  /** Props never move, so their bounds are computed once. This is the
   *  MESH-level boundingSphere, not the geometry's — an InstancedMesh
   *  frustum-culls against its own, and leaving it unset is what made
   *  the entire grass field vanish earlier in this project. */
  private computeStaticBounds(): void {
    const all = [...this.trees, ...this.rocks];
    if (all.length === 0) {
      for (const mesh of [this.trunkMesh, this.canopyMesh, this.rockMesh]) mesh.frustumCulled = false;
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
    for (const mesh of [this.trunkMesh, this.canopyMesh, this.rockMesh]) {
      mesh.boundingBox = box.clone();
      mesh.boundingSphere = sphere.clone();
    }
  }

  // -------------------------------------------------------------------
  // Geometry and material
  // -------------------------------------------------------------------

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
    // Displace by a per-DIRECTION amount so shared vertices stay welded
    // (displacing per-vertex-index would split the surface open).
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

/** Cheap deterministic −1..1 from a float — used for per-rock tilt so
 *  boulders don't all sit perfectly level. */
function tiltFrom(value: number): number {
  const hashed = Math.sin(value * 127.1) * 43758.5453;
  return (hashed - Math.floor(hashed)) * 2 - 1;
}
