/**
 * Dev/QA-only demo `GameState` — NOT a production code path. `GameplayScreen`
 * consumes any `GameState` (PRD §7.2 scope); nothing wires up real level
 * selection or the input loop yet (§7.3+, later sessions), so this is what
 * lets the operator actually see the renderer to profile it on-device, and
 * lets a reviewer eyeball all 5 §7.8 obstacle sprites at once.
 */

import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import { createGame, type EngineTuning, type GameState } from '@blockmanor/engine';

const TUNING: EngineTuning = {
  mercy_threshold: REMOTE_CONFIG_DEFAULTS.mercy_threshold,
  mercy_small_prob: REMOTE_CONFIG_DEFAULTS.mercy_small_prob,
  score_clear_base: REMOTE_CONFIG_DEFAULTS.score_clear_base,
  combo_step: REMOTE_CONFIG_DEFAULTS.combo_step,
  perfect_clear_bonus: REMOTE_CONFIG_DEFAULTS.perfect_clear_bonus,
};

export function createDemoGameState(): GameState {
  return createGame(
    {
      mode: 'level',
      tuning: TUNING,
      level: {
        id: 24,
        chapter: 1,
        seedSalt: 'renderer-demo',
        // One of every §7.8 obstacle, so BoardCanvas's full sprite set is visible.
        prefill: [
          { r: 1, c: 1, type: 'crate' },
          { r: 1, c: 3, type: 'crate2' },
          { r: 1, c: 5, type: 'chain', color: 2 },
          { r: 3, c: 1, type: 'ivy' },
          { r: 3, c: 5, type: 'heirloom' },
          { r: 5, c: 2, type: 'filled', color: 4 },
        ],
        goals: [
          { type: 'crate', count: 12 },
          { type: 'ivy', count: 4 },
        ],
        pieceWeightOverrides: {},
        mercy: true,
        stars: { s2: 1500, s3: 2600 },
        ivySpreadInterval: 3,
        ivyMaxTiles: 16,
      },
    },
    'demo-seed',
  );
}
