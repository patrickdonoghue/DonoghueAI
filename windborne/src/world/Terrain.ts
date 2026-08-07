import * as THREE from 'three';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { GRASS, PLAYER_LIGHT, TERRAIN } from '../config/tuning';
import { paletteColor, type Palette } from '../config/palettes';
import { mulberry32 } from '../core/Random';
import type { LevelBounds } from '../player/WindController';
import noiseSource from '../render/shaders/noise.glsl?raw';
import terrainVertSource from '../render/shaders/terrain.vert.glsl?raw';
import terrainFragSource from '../render/shaders/terrain.frag.glsl?raw';

export interface TerrainOctave {
  frequency: number;
  amplitude: number;
}

export interface TerrainConfig {
  seed: number;
  bounds: LevelBounds;
  octaves: TerrainOctave[];
}

/**
 * Heightfield terrain: layered simplex noise, chunked into meshes with a
 * static per-chunk LOD tier. `getHeightAt` is analytic (re-samples the same
 * noise the mesh was built from) so it stays correct regardless of mesh
 * resolution — this is what WindController's altitude assist and slope
 * assist read from.
 *
 * No level JSON yet (that's Phase 3) — shaping splines from PRD §6.1 aren't
 * implemented, just the noise octaves. `TerrainConfig` is deliberately the
 * subset of the eventual level JSON's `terrain` block that Phase 1 needs.
 */
export class Terrain {
  readonly group = new THREE.Group();

  private readonly config: TerrainConfig;
  private readonly noise: NoiseFunction2D;
  private readonly material: THREE.ShaderMaterial;

  constructor(config: TerrainConfig, palette: Palette) {
    this.config = config;
    this.noise = createNoise2D(mulberry32(config.seed));
    this.material = this.buildMaterial(palette);
    this.buildChunks(palette);
  }

  /** Called once per rendered frame: updates the fake-grass distance
   *  uniform. Everything else on this material is set once at construction
   *  (lighting via setLighting, ring boundaries at build time) since
   *  terrain chunks themselves never change. */
  render(playerPosition: THREE.Vector3): void {
    (this.material.uniforms.uPlayerPosition!.value as THREE.Vector3).copy(playerPosition);
  }

  /** Main.ts calls this once, after computing the palette-derived sun
   *  direction and colours it also uses for the grass shader, so both
   *  systems are lit consistently. */
  setLighting(sunDirection: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number, ambientColor: THREE.Color, ambientIntensity: number): void {
    (this.material.uniforms.uSunDirection!.value as THREE.Vector3).copy(sunDirection);
    (this.material.uniforms.uSunColor!.value as THREE.Color).copy(sunColor);
    this.material.uniforms.uSunIntensity!.value = sunIntensity;
    (this.material.uniforms.uAmbientColor!.value as THREE.Color).copy(ambientColor);
    this.material.uniforms.uAmbientIntensity!.value = ambientIntensity;
  }

  getHeightAt(x: number, z: number): number {
    let height = 0;
    for (const octave of this.config.octaves) {
      height += this.noise(x * octave.frequency, z * octave.frequency) * octave.amplitude;
    }
    return height;
  }

  /** Surface normal from the height field's own gradient (central finite
   *  differences), not from mesh topology. Adjacent chunks near a LOD
   *  boundary can differ a lot in resolution (65 vs 33 vs 17 verts/side —
   *  see TERRAIN.RESOLUTION_*), so `computeVertexNormals()` produces a
   *  different normal on either side of that boundary for the exact same
   *  physical point, purely from how densely each chunk happens to be
   *  triangulated there. Under directional lighting that reads as a thin
   *  bright seam tracing the boundary — worse the more the terrain
   *  undulates there, since that's exactly where the two chunks'
   *  triangulations diverge most. An analytic normal is a pure function of
   *  (x, z), so both chunks compute the identical value at a shared edge
   *  regardless of local triangle density, and the seam disappears. */
  private getNormalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const eps = 0.1;
    const dhdx = (this.getHeightAt(x + eps, z) - this.getHeightAt(x - eps, z)) / (2 * eps);
    const dhdz = (this.getHeightAt(x, z + eps) - this.getHeightAt(x, z - eps)) / (2 * eps);
    return out.set(-dhdx, 1, -dhdz).normalize();
  }

  private buildChunks(palette: Palette): void {
    const { min, max } = this.config.bounds;
    const chunkSize = TERRAIN.CHUNK_SIZE;
    const centerX = (min[0] + max[0]) / 2;
    const centerZ = (min[1] + max[1]) / 2;

    for (let originZ = min[1]; originZ < max[1] - 1e-6; originZ += chunkSize) {
      for (let originX = min[0]; originX < max[0] - 1e-6; originX += chunkSize) {
        const chunkCenterX = originX + chunkSize / 2;
        const chunkCenterZ = originZ + chunkSize / 2;
        const distanceFromCenter = Math.hypot(chunkCenterX - centerX, chunkCenterZ - centerZ);
        const resolution =
          distanceFromCenter < TERRAIN.LOD_NEAR_DISTANCE
            ? TERRAIN.RESOLUTION_NEAR
            : distanceFromCenter < TERRAIN.LOD_MID_DISTANCE
              ? TERRAIN.RESOLUTION_MID
              : TERRAIN.RESOLUTION_FAR;
        this.group.add(this.buildChunkMesh(originX, originZ, chunkSize, resolution, palette));
      }
    }
  }

  private buildChunkMesh(
    originX: number,
    originZ: number,
    size: number,
    resolution: number,
    palette: Palette,
  ): THREE.Mesh {
    const vertsPerSide = resolution;
    // Grid vertices plus one skirt duplicate per perimeter vertex — see the
    // skirt note below for why those exist.
    const gridCount = vertsPerSide * vertsPerSide;
    const skirtCount = vertsPerSide * 4;
    const positions = new Float32Array((gridCount + skirtCount) * 3);
    const normals = new Float32Array((gridCount + skirtCount) * 3);
    const scratchNormal = new THREE.Vector3();

    for (let j = 0; j < vertsPerSide; j++) {
      for (let i = 0; i < vertsPerSide; i++) {
        const x = originX + (i / (vertsPerSide - 1)) * size;
        const z = originZ + (j / (vertsPerSide - 1)) * size;
        const y = this.getHeightAt(x, z);
        const index = (j * vertsPerSide + i) * 3;
        positions[index] = x;
        positions[index + 1] = y;
        positions[index + 2] = z;

        this.getNormalAt(x, z, scratchNormal);
        normals[index] = scratchNormal.x;
        normals[index + 1] = scratchNormal.y;
        normals[index + 2] = scratchNormal.z;
      }
    }

    const indices: number[] = [];
    for (let j = 0; j < vertsPerSide - 1; j++) {
      for (let i = 0; i < vertsPerSide - 1; i++) {
        const a = j * vertsPerSide + i;
        const b = a + 1;
        const c = a + vertsPerSide;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    // Skirts: a strip of geometry hanging straight down from every chunk
    // edge. Adjacent chunks at different LOD resolutions sample their
    // shared edge at different intervals, so between the coarse chunk's
    // vertices the two edges disagree by a few centimetres — a T-junction
    // crack, visible at grazing angles as a bright hairline of sky tracing
    // the terrain's contour (this was the "fine white lines following the
    // landscape" report; the analytic-normal fix removed the lighting seam
    // at these borders but not the geometric gap). Rather than stitching
    // edge topologies together, each chunk drops a skirt so anything seen
    // through the crack is skirt, not sky — and because each skirt vertex
    // copies its parent edge vertex's normal (which also drives the baked
    // colour in computeSlopeAttributes), the skirt is lit and coloured
    // identically to the ground it hangs from, making the fill invisible.
    // Depth: worst-case edge disagreement is the coarse edge's linear
    // interpolation error, bounded by the highest-frequency octave's
    // curvature at well under 0.5m for current content — 1.5m is generous
    // margin, and an implementation constant rather than a feel constant.
    const SKIRT_DEPTH = 1.5;
    const gridIndexOf = (i: number, j: number): number => j * vertsPerSide + i;
    // Perimeter as (i, j) pairs per edge: north (j=0), south (j=max),
    // west (i=0), east (i=max). Corners are duplicated across edges,
    // which is harmless — coincident verts, degenerate-free quads.
    const edges: Array<Array<[number, number]>> = [
      Array.from({ length: vertsPerSide }, (_, i) => [i, 0]),
      Array.from({ length: vertsPerSide }, (_, i) => [i, vertsPerSide - 1]),
      Array.from({ length: vertsPerSide }, (_, j) => [0, j]),
      Array.from({ length: vertsPerSide }, (_, j) => [vertsPerSide - 1, j]),
    ];
    let skirtVertex = gridCount;
    for (const edge of edges) {
      const firstSkirtOfEdge = skirtVertex;
      for (const [i, j] of edge) {
        const top = gridIndexOf(i, j) * 3;
        const bottom = skirtVertex * 3;
        positions[bottom] = positions[top]!;
        positions[bottom + 1] = positions[top + 1]! - SKIRT_DEPTH;
        positions[bottom + 2] = positions[top + 2]!;
        normals[bottom] = normals[top]!;
        normals[bottom + 1] = normals[top + 1]!;
        normals[bottom + 2] = normals[top + 2]!;
        skirtVertex++;
      }
      for (let k = 0; k < edge.length - 1; k++) {
        const [i0, j0] = edge[k]!;
        const [i1, j1] = edge[k + 1]!;
        const topA = gridIndexOf(i0, j0);
        const topB = gridIndexOf(i1, j1);
        const bottomA = firstSkirtOfEdge + k;
        const bottomB = firstSkirtOfEdge + k + 1;
        // The material renders double-sided (see buildMaterial), so quad
        // winding doesn't need to differ per edge orientation.
        indices.push(topA, bottomA, topB, topB, bottomA, bottomB);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    this.computeSlopeAttributes(geometry, palette);

    const mesh = new THREE.Mesh(geometry, this.material);
    // Terrain chunks never move — skip the per-frame matrix recompute.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  /** Slope-based grass/dirt/rock blend from PRD §6.1, baked as vertex
   *  colours at build time, plus a `grassiness` scalar (1 = flat/grass,
   *  0 = steep rock/dirt) the fragment shader uses to keep the fake-grass
   *  horizon tint off cliffs and dirt patches. Vitality-driven colour
   *  (dead ↔ alive) isn't wired in — that's Phase 2's VitalityField; this
   *  always renders the "alive" terrain colour. */
  private computeSlopeAttributes(geometry: THREE.BufferGeometry, palette: Palette): void {
    const normal = geometry.getAttribute('normal');
    const vertexCount = normal.count;
    const colors = new Float32Array(vertexCount * 3);
    const grassiness = new Float32Array(vertexCount);

    const grass = paletteColor(palette.terrain.aliveGrass);
    const dirt = paletteColor(palette.terrain.dirt);
    const rock = paletteColor(palette.terrain.rock);
    const blended = new THREE.Color();

    const grassMax = TERRAIN.SLOPE_GRASS_MAX;
    const rockMin = TERRAIN.SLOPE_ROCK_MIN;
    const midpoint = (grassMax + rockMin) / 2;

    for (let i = 0; i < vertexCount; i++) {
      const slope = normal.getY(i); // dot(normal, worldUp) since worldUp = (0, 1, 0)

      if (slope >= grassMax) {
        blended.copy(grass);
      } else if (slope <= rockMin) {
        blended.copy(rock);
      } else if (slope > midpoint) {
        const t = (slope - midpoint) / (grassMax - midpoint);
        blended.copy(dirt).lerp(grass, t);
      } else {
        const t = (slope - rockMin) / (midpoint - rockMin);
        blended.copy(rock).lerp(dirt, t);
      }

      colors[i * 3] = blended.r;
      colors[i * 3 + 1] = blended.g;
      colors[i * 3 + 2] = blended.b;
      grassiness[i] = THREE.MathUtils.clamp((slope - rockMin) / (grassMax - rockMin), 0, 1);
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('grassiness', new THREE.BufferAttribute(grassiness, 1));
  }

  private buildMaterial(palette: Palette): THREE.ShaderMaterial {
    const lastRing = GRASS.LOD_RINGS[GRASS.LOD_RINGS.length - 1];
    const ringRadius = lastRing?.radius ?? 0;
    const fadeBand = GRASS.EDGE_FADE_BAND;

    return new THREE.ShaderMaterial({
      // Double-sided so the chunk-edge skirts (see buildChunkMesh) render
      // from any viewing angle without per-edge winding bookkeeping. The
      // heightfield itself almost never presents a backface, so the
      // culling this gives up costs effectively nothing.
      side: THREE.DoubleSide,
      vertexShader: `${noiseSource}\n${terrainVertSource}`,
      fragmentShader: `${noiseSource}\n${terrainFragSource}`,
      uniforms: {
        uPlayerPosition: { value: new THREE.Vector3() },
        // Fake grass starts exactly where GrassField's real grass begins
        // fading (ring 2's outer radius minus its own fade band) and
        // reaches full strength the same distance beyond it, so the
        // handoff is symmetric with the real grass fading out.
        uFakeGrassStart: { value: ringRadius - fadeBand },
        uFakeGrassFull: { value: ringRadius + fadeBand },
        uHorizonPatchScale: { value: GRASS.HORIZON_PATCH_SCALE },
        uFakeGrassBase: { value: paletteColor(palette.grass.aliveBase) },
        uFakeGrassBright: { value: paletteColor(palette.grass.aliveTip) },

        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uSunIntensity: { value: 1.0 },
        uAmbientColor: { value: new THREE.Color(0xffffff) },
        uAmbientIntensity: { value: 0.5 },
        uLightWrap: { value: TERRAIN.LIGHT_WRAP },
        uPlayerGlowRadius: { value: PLAYER_LIGHT.RADIUS },
        uPlayerGlowIntensity: { value: PLAYER_LIGHT.INTENSITY },

        uFogColor: { value: paletteColor(palette.fog.color) },
        uFogNear: { value: palette.fog.near },
        uFogFar: { value: palette.fog.far },

        // Vitality field (PRD §5.4) — texture wired by setVitality().
        uVitalityMap: { value: null },
        uVitalityBoundsMin: { value: new THREE.Vector2() },
        uVitalityBoundsSize: { value: new THREE.Vector2(1, 1) },
        uDeadColor: { value: paletteColor(palette.terrain.deadGrass) },
      },
    });
  }

  /** Wire the shared vitality field in — called once by main.ts. */
  setVitality(texture: THREE.Texture, boundsMin: THREE.Vector2, boundsSize: THREE.Vector2): void {
    this.material.uniforms.uVitalityMap!.value = texture;
    (this.material.uniforms.uVitalityBoundsMin!.value as THREE.Vector2).copy(boundsMin);
    (this.material.uniforms.uVitalityBoundsSize!.value as THREE.Vector2).copy(boundsSize);
  }
}
