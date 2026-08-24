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

/** i18n key per §7.8 goal type — shared by every screen that lists goal
 * progress (`GameplayScreen`'s HUD goal bar, `FailScreen`'s §7.5 "Crates
 * 9/12" line), so the type->label mapping lives in exactly one place. */
export const GOAL_LABEL_KEY = {
  crate: 'gameplay.goal.crate',
  chain: 'gameplay.goal.chain',
  ivy: 'gameplay.goal.ivy',
  heirloom: 'gameplay.goal.heirloom',
} as const;

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

/** Overall goal completion, 0-100 — one place for the calc both
 * `LevelSession` (the §14 `level_fail.goal_progress_pct` param) and
 * `FailScreen` (the §7.5 "so close" gate, audit mn-3) need, instead of two
 * copies drifting apart. 0 for a goal-less config (nothing to be "close" to). */
export function goalProgressPct(goals: readonly GoalBarEntry[]): number {
  const total = goals.reduce((sum, g) => sum + g.total, 0);
  if (total === 0) return 0;
  const done = goals.reduce((sum, g) => sum + (g.total - g.remaining), 0);
  return Math.round((100 * done) / total);
}

/**
 * §12.2's quit-to-map gate: "confirm if goals >50% done".
 *
 * READING OF THE THRESHOLD (stated because "50%" has two sides): `>` is
 * strict, so EXACTLY 50% does NOT confirm — the confirm appears only from the
 * first unit of progress past half. Nothing in §12.2 or §6.7 is ambiguous
 * here; the PRD writes `>`, not `>=`, and §7.5's neighbouring "so close"
 * gate deliberately writes `>=` in its own code, so the distinction is being
 * drawn, not glossed.
 *
 * Compared on the EXACT ratio, in integers, rather than on
 * `goalProgressPct`'s rounded output: 101/200 crates is genuinely past half
 * but rounds to 51 either way, while 100.5/200-shaped inputs cannot occur —
 * what CAN occur is a case like 51/101 (50.495%), which rounds to 50 and
 * would wrongly skip the confirm if this read the rounded integer. `2*done >
 * total` is the same comparison with no float and no rounding at all.
 *
 * A goal-less config (endless-shaped, or FTUE's L1-L3) has nothing to be
 * half-done with: `false`, matching `goalProgressPct`'s own 0.
 */
export function goalsPastHalf(goals: readonly GoalBarEntry[]): boolean {
  const total = goals.reduce((sum, g) => sum + g.total, 0);
  if (total === 0) return false;
  const done = goals.reduce((sum, g) => sum + (g.total - g.remaining), 0);
  return 2 * done > total;
}
