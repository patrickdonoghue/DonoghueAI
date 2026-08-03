import * as THREE from 'three';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { TERRAIN } from '../config/tuning';
import { paletteColor, type Palette } from '../config/palettes';
import { mulberry32 } from '../core/Random';
import type { LevelBounds } from '../player/WindController';

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
  private readonly material: THREE.MeshStandardMaterial;

  constructor(config: TerrainConfig, palette: Palette) {
    this.config = config;
    this.noise = createNoise2D(mulberry32(config.seed));
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.buildChunks(palette);
  }

  getHeightAt(x: number, z: number): number {
    let height = 0;
    for (const octave of this.config.octaves) {
      height += this.noise(x * octave.frequency, z * octave.frequency) * octave.amplitude;
    }
    return height;
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
    const positions = new Float32Array(vertsPerSide * vertsPerSide * 3);

    for (let j = 0; j < vertsPerSide; j++) {
      for (let i = 0; i < vertsPerSide; i++) {
        const x = originX + (i / (vertsPerSide - 1)) * size;
        const z = originZ + (j / (vertsPerSide - 1)) * size;
        const y = this.getHeightAt(x, z);
        const index = (j * vertsPerSide + i) * 3;
        positions[index] = x;
        positions[index + 1] = y;
        positions[index + 2] = z;
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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.setAttribute('color', this.computeSlopeColors(geometry, palette));

    const mesh = new THREE.Mesh(geometry, this.material);
    // Terrain chunks never move — skip the per-frame matrix recompute.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  /** Slope-based grass/dirt/rock blend from PRD §6.1, baked as vertex
   *  colours at build time. Vitality-driven colour (dead ↔ alive) isn't
   *  wired in — that's Phase 2's VitalityField; this always renders the
   *  "alive" terrain colour. */
  private computeSlopeColors(geometry: THREE.BufferGeometry, palette: Palette): THREE.BufferAttribute {
    const normal = geometry.getAttribute('normal');
    const vertexCount = normal.count;
    const colors = new Float32Array(vertexCount * 3);

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
    }

    return new THREE.BufferAttribute(colors, 3);
  }
}
