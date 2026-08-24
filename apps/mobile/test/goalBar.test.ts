import { createGame, type GameConfig, type GameState } from '@blockmanor/engine';
import { describe, expect, it } from 'vitest';
import { deriveGoalBar, goalProgressPct, goalsPastHalf } from '../src/game/goalBar';

const TUNING = {
  mercy_threshold: 0.55,
  mercy_small_prob: 0.65,
  score_clear_base: 10,
  combo_step: 0.25,
  perfect_clear_bonus: 300,
};

function levelConfig(): GameConfig {
  return {
    mode: 'level',
    tuning: TUNING,
    level: {
      id: 1,
      chapter: 1,
      seedSalt: 'goalbar-test',
      prefill: [],
      goals: [
        { type: 'crate', count: 12 },
        { type: 'ivy', count: 3 },
      ],
      pieceWeightOverrides: {},
      mercy: true,
      stars: { s2: 100, s3: 200 },
      ivySpreadInterval: 3,
      ivyMaxTiles: 16,
    },
  };
}

describe('deriveGoalBar (PRD §7.2 goal bar: icon + remaining count per goal)', () => {
  it('reads remaining = total at game start, one entry per level goal, in order', () => {
    const state = createGame(levelConfig(), 'seed-1');
    const bar = deriveGoalBar(state);
    expect(bar).toEqual([
      { type: 'crate', remaining: 12, total: 12, icon: 'crossPlank' },
      { type: 'ivy', remaining: 3, total: 3, icon: 'leafPair' },
    ]);
  });

  it('is empty for a goal-less mode (endless/daily have no goals)', () => {
    const state = createGame({ mode: 'endless', tuning: TUNING }, 'seed-2');
    expect(deriveGoalBar(state)).toEqual([]);
  });

  it('reflects live remaining counts distinct from the frozen total', () => {
    const state: Pick<GameState, 'goals' | 'config'> = {
      goals: [{ type: 'crate', remaining: 7 }],
      config: levelConfig(),
    };
    expect(deriveGoalBar(state)).toEqual([
      { type: 'crate', remaining: 7, total: 12, icon: 'crossPlank' },
    ]);
  });

  it('falls back to remaining as total rather than throwing if config/goals length mismatch', () => {
    const state: Pick<GameState, 'goals' | 'config'> = {
      goals: [{ type: 'heirloom', remaining: 2 }],
      config: { mode: 'level', tuning: TUNING },
    };
    expect(deriveGoalBar(state)).toEqual([
      { type: 'heirloom', remaining: 2, total: 2, icon: 'itemChain' },
    ]);
  });
});

/**
 * §12.2's quit-to-map gate — "confirm if goals >50% done". The one genuinely
 * testable clause of that section, so the boundary is walked from both sides
 * and stated explicitly: `>` is STRICT, so exactly 50% does NOT confirm.
 */
describe('goalsPastHalf (PRD §12.2 ">50% done" confirm gate)', () => {
  /** One goal with `total` and `total - remaining === done`. */
  function entry(done: number, total: number) {
    return [
      { type: 'crate' as const, remaining: total - done, total, icon: 'crossPlank' as const },
    ];
  }

  it('0% — a run the player has not started scoring against', () => {
    expect(goalsPastHalf(entry(0, 12))).toBe(false);
  });

  it('just UNDER 50% (5/12 = 41.7%)', () => {
    expect(goalsPastHalf(entry(5, 12))).toBe(false);
  });

  it('EXACTLY 50% (6/12) does NOT confirm — the PRD writes ">", not ">="', () => {
    expect(goalsPastHalf(entry(6, 12))).toBe(false);
  });

  it('just OVER 50% (7/12 = 58.3%) confirms', () => {
    expect(goalsPastHalf(entry(7, 12))).toBe(true);
  });

  it('100% confirms', () => {
    expect(goalsPastHalf(entry(12, 12))).toBe(true);
  });

  /**
   * The reason this is not `goalProgressPct(goals) > 50`: 51/101 is 50.495%,
   * genuinely past half, and rounds DOWN to 50 — the rounded read would skip
   * the confirm on a run that is over the line. Asserted against
   * `goalProgressPct` itself so the test fails if either side is "fixed" to
   * agree with the other.
   */
  it('is exact, not rounded: 51/101 is past half even though goalProgressPct reads 50', () => {
    expect(goalProgressPct(entry(51, 101))).toBe(50);
    expect(goalsPastHalf(entry(51, 101))).toBe(true);
  });

  it('the mirror case: 50/101 rounds to 50 too, and is NOT past half', () => {
    expect(goalProgressPct(entry(50, 101))).toBe(50);
    expect(goalsPastHalf(entry(50, 101))).toBe(false);
  });

  it('aggregates ACROSS goals rather than testing each one', () => {
    const goals = [
      { type: 'crate' as const, remaining: 0, total: 10, icon: 'crossPlank' as const },
      { type: 'ivy' as const, remaining: 10, total: 10, icon: 'leafPair' as const },
    ];
    // 10 of 20 done overall — exactly half, despite one goal being finished.
    expect(goalsPastHalf(goals)).toBe(false);
    expect(
      goalsPastHalf([
        ...goals,
        { type: 'chain' as const, remaining: 0, total: 1, icon: 'chainBar' as const },
      ]),
    ).toBe(true);
  });

  it('a goal-less config has nothing to be half-done with', () => {
    expect(goalsPastHalf([])).toBe(false);
    expect(goalsPastHalf(deriveGoalBar(createGame({ mode: 'endless', tuning: TUNING }, 's')))).toBe(
      false,
    );
  });

  it("reads the ENGINE's own goal state, not a hand-built list", () => {
    // A real `createGame` level (12 crates + 3 ivy = 15 total) with 8 of the
    // 15 credited: past half by one unit.
    const state: Pick<GameState, 'goals' | 'config'> = {
      goals: [
        { type: 'crate', remaining: 4 },
        { type: 'ivy', remaining: 3 },
      ],
      config: levelConfig(),
    };
    expect(goalsPastHalf(deriveGoalBar(state))).toBe(true);
    const half: Pick<GameState, 'goals' | 'config'> = {
      goals: [
        { type: 'crate', remaining: 5 },
        { type: 'ivy', remaining: 3 },
      ],
      config: levelConfig(),
    };
    // 7 of 15 — under half, so no confirm.
    expect(goalsPastHalf(deriveGoalBar(half))).toBe(false);
  });
});
