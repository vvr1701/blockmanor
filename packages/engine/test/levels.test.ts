/** Level schema validation — PRD §7.7 (engine-side trust boundary; zod lives in content/shared). */

import { describe, expect, it } from 'vitest';
import { LevelSchemaError, validateLevel } from '../src/levels';

/** The §7.7 example, verbatim. */
const EXAMPLE = {
  id: 24,
  chapter: 1,
  seedSalt: 'L24-a',
  prefill: [
    { r: 2, c: 3, type: 'crate' },
    { r: 2, c: 4, type: 'crate2' },
  ],
  goals: [{ type: 'crate', count: 12 }],
  pieceWeightOverrides: { P11: 0 },
  mercy: true,
  stars: { s2: 1500, s3: 2600 },
  ivySpreadInterval: 3,
  ivyMaxTiles: 16,
  estMoves: 22,
  difficultyTier: 'spike',
};

/** The §7.7 required set, and nothing else. */
const MINIMAL = { id: 1, chapter: 1, seedSalt: 'a', stars: { s2: 1, s3: 2 } };

describe('validateLevel (PRD §7.7)', () => {
  it('accepts the PRD example unchanged', () => {
    expect(validateLevel(EXAMPLE)).toEqual(EXAMPLE);
  });

  it('defaults the optional fields', () => {
    const level = validateLevel(MINIMAL);
    expect(level).toEqual({
      ...MINIMAL,
      prefill: [],
      goals: [],
      pieceWeightOverrides: {},
      mercy: true,
      ivySpreadInterval: 3,
      ivyMaxTiles: 16,
    });
  });

  it('omits estMoves and difficultyTier rather than defaulting them (§7.7)', () => {
    // Harness-written metadata: "not measured yet" must stay distinguishable
    // from a measured 0, so the validator must not invent a value.
    const level = validateLevel(MINIMAL);
    expect('estMoves' in level).toBe(false);
    expect('difficultyTier' in level).toBe(false);
    expect(validateLevel({ ...MINIMAL, estMoves: 0 }).estMoves).toBe(0);
  });

  it('takes per-level ivy tuning (§7.8 — level-scoped, not [RC])', () => {
    const level = validateLevel({ ...MINIMAL, ivySpreadInterval: 5, ivyMaxTiles: 4 });
    expect(level.ivySpreadInterval).toBe(5);
    expect(level.ivyMaxTiles).toBe(4);
  });

  it.each([
    ['not an object', 42],
    ['missing seedSalt', { id: 1, chapter: 1, stars: { s2: 1, s3: 2 } }],
    ['missing chapter', { id: 1, seedSalt: 'a', stars: { s2: 1, s3: 2 } }],
    ['missing stars', { id: 1, chapter: 1, seedSalt: 'a' }],
    ['zero ivySpreadInterval', { ...MINIMAL, ivySpreadInterval: 0 }],
    ['fractional ivySpreadInterval', { ...MINIMAL, ivySpreadInterval: 1.5 }],
    ['zero ivyMaxTiles', { ...MINIMAL, ivyMaxTiles: 0 }],
    ['non-string difficultyTier', { ...MINIMAL, difficultyTier: 7 }],
    ['off-board prefill', { ...EXAMPLE, prefill: [{ r: 9, c: 0, type: 'crate' }] }],
    ['unknown prefill type', { ...EXAMPLE, prefill: [{ r: 0, c: 0, type: 'lava' }] }],
    ['prefill not an array', { ...EXAMPLE, prefill: {} }],
    ['crate2 as a goal type', { ...EXAMPLE, goals: [{ type: 'crate2', count: 1 }] }],
    ['zero goal count', { ...EXAMPLE, goals: [{ type: 'crate', count: 0 }] }],
    ['unknown piece override', { ...EXAMPLE, pieceWeightOverrides: { P99: 1 } }],
    ['negative override', { ...EXAMPLE, pieceWeightOverrides: { P11: -1 } }],
    ['non-numeric star threshold', { ...EXAMPLE, stars: { s2: 'high', s3: 1 } }],
  ])('rejects %s', (_name, input) => {
    expect(() => validateLevel(input)).toThrow(LevelSchemaError);
  });

  it('keeps an explicit prefill color and mercy:false', () => {
    const level = validateLevel({
      ...EXAMPLE,
      mercy: false,
      prefill: [{ r: 0, c: 0, type: 'chain', color: 4 }],
    });
    expect(level.mercy).toBe(false);
    expect(level.prefill[0]).toEqual({ r: 0, c: 0, type: 'chain', color: 4 });
  });
});
