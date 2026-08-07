/**
 * Goal-bar derivation — PRD §7.2 "goal bar (icon + remaining count per goal)".
 * Pure function of `GameState`, no new engine signal needed: `state.goals`
 * carries the live `remaining` count (§4.3 `GoalProgress`) and
 * `state.config.level.goals` — the ORIGINAL, unmutated level config (§4.3
 * `cloneState` never clones `config`) — carries each goal's starting `count`.
 * The two arrays are always the same length, built 1:1 by `createGame`.
 */

import type { GameState } from '@blockmanor/engine';
import { spriteForObstacle, type MotifShape } from './obstacleSprites';

export interface GoalBarEntry {
  type: GameState['goals'][number]['type'];
  remaining: number;
  /** Starting count (§7.7 `LevelGoal.count`) — 0 goals or endless/daily modes
   * yield an empty list upstream, so this is always the level's real total. */
  total: number;
  icon: MotifShape;
}

export function deriveGoalBar(state: Pick<GameState, 'goals' | 'config'>): GoalBarEntry[] {
  const originals = state.config.level?.goals ?? [];
  return state.goals.map((goal, i) => ({
    type: goal.type,
    remaining: goal.remaining,
    // Defensive fallback (mismatched-length config would be an engine bug, not
    // a renderer concern) rather than crashing the HUD on bad input.
    total: originals[i]?.count ?? goal.remaining,
    icon: spriteForObstacle(goal.type).motif,
  }));
}
