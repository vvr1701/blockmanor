/** Level schema — PRD §7.7 authoring gate. */

import { describe, expect, it } from 'vitest';
import { levelSchema, parseLevel } from '../src/schema';

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
  estMoves: 22,
  difficultyTier: 'spike',
};

const MINIMAL = { id: 1, chapter: 1, seedSalt: 'a', stars: { s2: 100, s3: 200 } };

describe('levelSchema (PRD §7.7)', () => {
  it('accepts the §7.7 example', () => {
    expect(() => parseLevel(EXAMPLE)).not.toThrow();
  });

  it('applies the §7.7 defaults', () => {
    expect(levelSchema.parse(MINIMAL)).toMatchObject({
      prefill: [],
      goals: [],
      pieceWeightOverrides: {},
      mercy: true,
      ivySpreadInterval: 3,
      ivyMaxTiles: 16,
    });
  });

  it('leaves harness metadata absent rather than defaulting it', () => {
    const parsed = levelSchema.parse(MINIMAL);
    expect('estMoves' in parsed).toBe(false);
    expect('difficultyTier' in parsed).toBe(false);
  });

  it.each([
    ['missing chapter', { id: 1, seedSalt: 'a', stars: { s2: 1, s3: 2 } }],
    ['missing stars', { id: 1, chapter: 1, seedSalt: 'a' }],
    // §7.8 (v1.6): crate2's 2nd hit credits `crate`; there is no crate2 goal.
    ['crate2 as a goal type', { ...MINIMAL, goals: [{ type: 'crate2', count: 1 }] }],
    ['s3 below s2', { ...MINIMAL, stars: { s2: 900, s3: 100 } }],
    [
      'duplicate prefill cells',
      {
        ...MINIMAL,
        prefill: [
          { r: 1, c: 1, type: 'crate' },
          { r: 1, c: 1, type: 'ivy' },
        ],
      },
    ],
    // An ivy goal with no ivy on the board can never be completed.
    ['unreachable ivy goal', { ...MINIMAL, goals: [{ type: 'ivy', count: 1 }] }],
    ['off-board prefill', { ...MINIMAL, prefill: [{ r: 9, c: 0, type: 'crate' }] }],
    ['unknown obstacle', { ...MINIMAL, prefill: [{ r: 0, c: 0, type: 'lava' }] }],
    ['unknown piece override', { ...MINIMAL, pieceWeightOverrides: { P99: 1 } }],
    ['zero ivySpreadInterval', { ...MINIMAL, ivySpreadInterval: 0 }],
    // .strict(): a typo'd key must fail loudly rather than be silently dropped.
    ['unknown key', { ...MINIMAL, mercyy: true }],
  ])('rejects %s', (_name, input) => {
    expect(() => levelSchema.parse(input)).toThrow();
  });

  it('runs the engine validator too, not just zod', () => {
    // Shape-valid for zod, but the engine owns the final word (§4.3 boundary).
    expect(parseLevel(EXAMPLE).goals).toEqual([{ type: 'crate', count: 12 }]);
  });
});
