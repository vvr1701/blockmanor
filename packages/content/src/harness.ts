/**
 * Balance harness — PRD §7.9, §5 (Stage-0 tooling).
 *
 * "For every level, run `simulate()` with a greedy-AI bot × 500 seeds; recorded
 * bot win-rate must sit within ±10pp of target. Store results in
 * `levels/_balance_report.json`."
 *
 * Every number here is reproducible from (level JSON, bot policy, seed count):
 * seeds are derived, never random, so a committed report can be re-derived and
 * diffed in CI. That is the whole point — a balance report nobody can reproduce
 * is a rumour, not evidence.
 */

import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import type { EngineTuning, GameConfig, LevelConfig } from '@blockmanor/engine';
import { playout } from './bot';
import { parseLevel } from './schema';

/** §7.9 pipeline default. */
export const DEFAULT_SEEDS = 500;
/** §7.9 acceptance band, in percentage points. */
export const WIN_RATE_TOLERANCE_PP = 10;

/**
 * §13 defaults for the five engine knobs. Level/endless read live Remote Config
 * at runtime (§13 scope note), but balance evidence has to be measured against a
 * fixed reference or the numbers mean nothing — so the harness always uses the
 * registry defaults, and records that it did.
 */
export const REFERENCE_TUNING: EngineTuning = {
  mercy_threshold: REMOTE_CONFIG_DEFAULTS.mercy_threshold,
  mercy_small_prob: REMOTE_CONFIG_DEFAULTS.mercy_small_prob,
  score_clear_base: REMOTE_CONFIG_DEFAULTS.score_clear_base,
  combo_step: REMOTE_CONFIG_DEFAULTS.combo_step,
  perfect_clear_bonus: REMOTE_CONFIG_DEFAULTS.perfect_clear_bonus,
};

export interface LevelBalance {
  id: number;
  /** §7.9 target win-rate for this level's slot, as a fraction. */
  target: number;
  winRate: number;
  /** Signed distance from target in percentage points; |value| must be ≤ 10. */
  deltaPp: number;
  withinTolerance: boolean;
  medianMoves: number;
  /**
   * Score percentiles ACROSS WINNING RUNS ONLY — star thresholds price wins,
   * and a losing run's score says nothing about how well a level rewards.
   * Ascending convention: `p10Score` is a weak win, `p90Score` a strong one.
   */
  p10Score: number;
  p90Score: number;
  /**
   * Suggested §7.7 thresholds. The level-authoring skill phrases these from the
   * TOP — "s2 ≈ p40 of winning bot scores, s3 ≈ p10" means the score the best
   * 40% and the best 10% of wins reach. In the ascending convention above that
   * is p60 and p90, which is what we compute. s3 > s2 always, per §7.5.
   */
  suggestedStars: { s2: number; s3: number };
}

export interface BalanceReport {
  /** Bumped whenever the bot policy or seeding changes — old rows are then void. */
  harnessVersion: number;
  seeds: number;
  tuning: EngineTuning;
  levels: LevelBalance[];
}

export const HARNESS_VERSION = 1;

/** Nearest-rank percentile over a sorted ascending array. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1] as number;
}

/** Round to something a player could plausibly read off a card. */
const friendly = (n: number): number =>
  n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 50) * 50;

/**
 * Star thresholds after rounding, guaranteed strictly ordered. On a level with a
 * tight score spread, p60 and p90 can round to the same number — and an s3 that
 * is not above s2 would make the 3rd star unearnable-but-awarded (§7.5) and is
 * rejected by `levelSchema` anyway.
 */
function starsFrom(p60: number, p90: number): { s2: number; s3: number } {
  const s2 = friendly(p60);
  const s3 = friendly(p90);
  return { s2, s3: s3 > s2 ? s3 : s2 + 50 };
}

export interface LevelSpec {
  level: LevelConfig;
  /** §7.9 win-rate target for the level's slot, as a fraction (0.9 for L1–10). */
  target: number;
}

/** Run one level through `seeds` bot playouts and score it against its target. */
export function measureLevel(spec: LevelSpec, seeds = DEFAULT_SEEDS): LevelBalance {
  const config: GameConfig = { mode: 'level', tuning: REFERENCE_TUNING, level: spec.level };

  let wins = 0;
  const moves: number[] = [];
  const winScores: number[] = [];

  for (let i = 0; i < seeds; i++) {
    // Derived, not random: the same level always sweeps the same seeds.
    const { result } = playout(config, `L${spec.level.id}-s${i}`, `bot-${spec.level.id}-${i}`);
    moves.push(result.moves);
    if (result.status === 'won') {
      wins++;
      winScores.push(result.score);
    }
  }

  moves.sort((a, b) => a - b);
  winScores.sort((a, b) => a - b);

  const winRate = wins / seeds;
  const deltaPp = (winRate - spec.target) * 100;

  return {
    id: spec.level.id,
    target: spec.target,
    winRate: Number(winRate.toFixed(4)),
    deltaPp: Number(deltaPp.toFixed(2)),
    withinTolerance: Math.abs(deltaPp) <= WIN_RATE_TOLERANCE_PP,
    medianMoves: percentile(moves, 50),
    p10Score: percentile(winScores, 10),
    p90Score: percentile(winScores, 90),
    suggestedStars: starsFrom(percentile(winScores, 60), percentile(winScores, 90)),
  };
}

export function buildReport(specs: readonly LevelSpec[], seeds = DEFAULT_SEEDS): BalanceReport {
  return {
    harnessVersion: HARNESS_VERSION,
    seeds,
    tuning: REFERENCE_TUNING,
    levels: specs.map((spec) => measureLevel(spec, seeds)),
  };
}

/** Convenience for callers holding raw JSON rather than validated levels. */
export const specFrom = (json: unknown, target: number): LevelSpec => ({
  level: parseLevel(json),
  target,
});
