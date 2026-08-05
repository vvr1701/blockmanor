/**
 * Seeded PRNG — PRD §4.3.
 *
 * mulberry32 is the SINGLE reference implementation for the whole product; there
 * are deliberately no alternates. Changing it is a breaking change (PRD §4.3):
 * it invalidates every golden replay fixture and `_balance_report.json`.
 *
 * `Math.random` / `Date.now` are lint-banned in this package (eslint.config.mjs).
 */

/** Mutable 32-bit PRNG state. Cloned with the game state so replays fork cleanly. */
export interface Rng {
  s: number;
}

/**
 * FNV-1a 32-bit. Used for two things only:
 *  - deriving a u32 mulberry32 seed from the `seed: string` of §4.3
 *  - the board digest in `FinalResult` (a compact anti-cheat comparison value)
 * It is a hash, not a generator: mulberry32 remains the only PRNG.
 */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: string): Rng {
  return { s: fnv1a(seed) };
}

export function cloneRng(rng: Rng): Rng {
  return { s: rng.s };
}

/** mulberry32 core — advances the state and returns a u32. */
export function nextU32(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) | 0;
  let t = Math.imul(rng.s ^ (rng.s >>> 15), 1 | rng.s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform in [0, 1). */
export function nextFloat(rng: Rng): number {
  return nextU32(rng) / 4294967296;
}

/** Uniform integer in [0, bound). `bound` must be > 0. */
export function nextInt(rng: Rng, bound: number): number {
  return Math.floor(nextFloat(rng) * bound);
}
