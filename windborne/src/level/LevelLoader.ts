import type { LevelBounds } from '../player/WindController';

/**
 * The level authoring format (PRD §7.2): JSON, hand-editable, hot-reloaded
 * in dev, written to disk by the placement tool's save endpoint.
 *
 * Conventions this loader defines (the PRD leaves them open):
 * - Flower/prop/exit positions are `[x, z]` pairs — height always snaps to
 *   the terrain at load, same as grass blades, so moving a flower never
 *   involves fixing its altitude by hand.
 * - Spawn position is `[x, y, z]` (altitude is part of the flight feel).
 * - Spawn heading is degrees, where 0 faces +Z and 180 faces −Z, i.e.
 *   `direction = (sin θ, 0, cos θ)`.
 *
 * `onComplete` event blocks are carried through untouched as data — the
 * tool authors geometry only (PRD §7.4); events are hand-written JSON and
 * interpreted by Phase 3b's EventRunner. Terrain `splines` are likewise
 * carried but not yet applied to the heightfield (nothing authored needs
 * them yet; they join the terrain build when a level actually uses one).
 */

export interface LevelFlower {
  pos: [number, number]; // [x, z], terrain-snapped at load
  species: string;
}

export interface LevelCluster {
  id: string;
  flowers: LevelFlower[];
  /** Opaque until Phase 3b's EventRunner. Preserved verbatim on save. */
  onComplete?: unknown[];
}

export interface LevelProp {
  type: string;
  pos: [number, number];
  cluster?: string;
}

export interface LevelTerrain {
  octaves: { frequency: number; amplitude: number }[];
  /** Authored terrain shaping — carried, not yet applied (see above). */
  splines?: unknown[];
}

export interface LevelData {
  id: string;
  seed: number;
  bounds: LevelBounds;
  terrain: LevelTerrain;
  palette: string;
  spawn: { position: [number, number, number]; heading: number };
  clusters: LevelCluster[];
  props: LevelProp[];
  exit: { pos: [number, number]; requires?: { vitality?: number } } | null;
}

/** Parse and lightly validate raw JSON into LevelData. Throws with a
 *  plain-language message on structural problems — a hand-edited file
 *  deserves a better error than `undefined is not an object` mid-load. */
export function parseLevel(raw: unknown): LevelData {
  const level = raw as Partial<LevelData>;
  if (!level || typeof level !== 'object') throw new Error('Level JSON is not an object');
  if (typeof level.id !== 'string') throw new Error('Level is missing "id"');
  if (typeof level.seed !== 'number') throw new Error(`Level ${level.id}: missing numeric "seed"`);

  const bounds = level.bounds as { min?: unknown; max?: unknown } | undefined;
  if (
    !bounds ||
    !Array.isArray(bounds.min) ||
    !Array.isArray(bounds.max) ||
    bounds.min.length !== 2 ||
    bounds.max.length !== 2
  ) {
    throw new Error(`Level ${level.id}: "bounds" must have [x, z] min and max`);
  }

  if (!level.terrain || !Array.isArray(level.terrain.octaves) || level.terrain.octaves.length === 0) {
    throw new Error(`Level ${level.id}: "terrain.octaves" must be a non-empty array`);
  }
  if (typeof level.palette !== 'string') throw new Error(`Level ${level.id}: missing "palette"`);

  const spawn = level.spawn as { position?: unknown; heading?: unknown } | undefined;
  if (!spawn || !Array.isArray(spawn.position) || spawn.position.length !== 3 || typeof spawn.heading !== 'number') {
    throw new Error(`Level ${level.id}: "spawn" needs [x, y, z] position and a numeric heading`);
  }

  const clusters = Array.isArray(level.clusters) ? level.clusters : [];
  for (const cluster of clusters) {
    if (typeof cluster.id !== 'string') throw new Error(`Level ${level.id}: every cluster needs an "id"`);
    if (!Array.isArray(cluster.flowers)) throw new Error(`Level ${level.id}: cluster ${cluster.id} needs a "flowers" array`);
    for (const flower of cluster.flowers) {
      if (!Array.isArray(flower.pos) || flower.pos.length !== 2 || typeof flower.species !== 'string') {
        throw new Error(`Level ${level.id}: cluster ${cluster.id} has a malformed flower (need pos [x, z] and species)`);
      }
    }
  }

  return {
    id: level.id,
    seed: level.seed,
    bounds: level.bounds as LevelBounds,
    terrain: level.terrain,
    palette: level.palette,
    spawn: level.spawn as LevelData['spawn'],
    clusters,
    props: Array.isArray(level.props) ? level.props : [],
    exit: level.exit ?? null,
  };
}

/** Flatten a level's clusters into the flat placement list FlowerField
 *  consumes. Cluster identity itself matters to Phase 3b's bloom
 *  tracking, not to rendering. */
export function flattenFlowers(level: LevelData): { x: number; z: number; species: string }[] {
  const out: { x: number; z: number; species: string }[] = [];
  for (const cluster of level.clusters) {
    for (const flower of cluster.flowers) {
      out.push({ x: flower.pos[0], z: flower.pos[1], species: flower.species });
    }
  }
  return out;
}
