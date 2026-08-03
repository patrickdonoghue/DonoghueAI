/**
 * Deterministic PRNG (mulberry32) for anything seeded: terrain noise
 * permutation tables, grass scatter. Not cryptographic — just fast, and
 * stable across runs so the same seed always builds the same level.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hashes two chunk-grid integers plus a seed into a fresh PRNG. Lets
 *  every chunk have its own deterministic-but-independent random stream
 *  without sharing state across chunks (which would make chunk generation
 *  order-dependent). */
export function chunkRandom(seed: number, chunkX: number, chunkZ: number): () => number {
  const mixed = (seed ^ Math.imul(chunkX, 374761393) ^ Math.imul(chunkZ, 668265263)) >>> 0;
  return mulberry32(mixed);
}
