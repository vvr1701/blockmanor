import { createGame, type GameConfig, type GameState } from '@blockmanor/engine';
import { describe, expect, it } from 'vitest';
import { deriveGoalBar } from '../src/game/goalBar';

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
