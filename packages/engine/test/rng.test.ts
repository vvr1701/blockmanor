/**
 * Seeded PRNG — PRD §4.3.
 *
 * The reference vector below pins mulberry32 + the FNV-1a seed derivation. If it
 * changes, every golden fixture and `_balance_report.json` is invalidated and a
 * PRD amendment is required (§4.3) — this test is the tripwire.
 */

import { describe, expect, it } from 'vitest';
import { cloneRng, createRng, fnv1a, nextFloat, nextInt, nextU32 } from '../src/rng';

describe('mulberry32 (PRD §4.3)', () => {
  it('reproduces the pinned reference vector for seed "blockmanor"', () => {
    const rng = createRng('blockmanor');
    expect(rng.s).toBe(3099916019);
    expect([nextU32(rng), nextU32(rng), nextU32(rng), nextU32(rng), nextU32(rng)]).toEqual([
      437634442, 1707167469, 3868986281, 3601648820, 623821066,
    ]);
  });

  it('hashes the empty seed to the FNV-1a offset basis', () => {
    expect(fnv1a('')).toBe(2166136261);
  });

  it('produces floats in [0,1) and ints in [0,n)', () => {
    const rng = createRng('range');
    for (let i = 0; i < 20000; i++) {
      const f = nextFloat(rng);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = nextInt(rng, 7);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });

  it('forks cleanly: a clone continues the same stream without touching the original', () => {
    const a = createRng('fork');
    nextU32(a);
    const b = cloneRng(a);
    expect(nextU32(b)).toBe(nextU32(a));
  });

  it('gives different streams for different seeds', () => {
    expect(nextU32(createRng('a'))).not.toBe(nextU32(createRng('b')));
  });
});
