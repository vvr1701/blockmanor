/**
 * Daily-Board generation — PRD §8.2. Pure: no Firestore, no clock, no Remote
 * Config, no `Math.random`. Everything it needs is an argument, so the whole of
 * §8.2's interesting behaviour is testable without an emulator.
 *
 * The output document is what §8.3 plays from and §8.5 re-simulates from. Its
 * `engineConfig` is the frozen snapshot mandated by PRD v1.7: once this function
 * returns, NOTHING downstream may consult Remote Config, or a LiveOps push
 * mid-day could turn an honest submission into a `daily_cheat_rejected`.
 *
 * The document's TYPES and the `dailyGameConfig` builder live in
 * `@blockmanor/shared` (§4.2), not here: `apps/mobile` cannot import
 * `backend/functions`, and §8.3's client must build its `GameConfig` from the
 * very same code §8.5 re-simulates with. This file owns generation only.
 */

import { playout } from '@blockmanor/content';
import {
  BLOCK_COLOR_COUNT,
  createRng,
  drawPiece,
  nextInt,
  type EngineTuning,
  type GameConfig,
  type PieceId,
} from '@blockmanor/engine';
import {
  engineVersion,
  dailyActivatesAt,
  dailyGameConfig,
  dailyPlaySeed,
  type DailyBoardDoc,
  type DailyConfigSource,
  type DailyPrefillCell,
  type DailySolvability,
} from '@blockmanor/shared';
import { PREFILL_TEMPLATES, TEMPLATE_ORIENTATIONS, orient } from './patterns';
import { attemptSeed, prefillSeed, sealSequence, sequenceSeed } from './seal';

/** Bump when a change here would produce a different board from the same seed. */
export const DAILY_GENERATOR_VERSION = 1;

/** §8.2 solvability gate: "greedy bot must survive ≥15 placements across 200 trials median". */
export const SOLVABILITY_TRIALS = 200;
export const SOLVABILITY_MIN_MOVES = 15;

/** §8.2 re-roll suffix: attempt `n` (1-based) uses `seed + "-rN"`. */
export const rerollRevision = (n: number): string => (n === 0 ? '' : `-r${n}`);

export interface DailyGenerationInput {
  date: string;
  /** `dailySeed(salt, date)` — the §8.2 HMAC. Never published. */
  seed: string;
  /** Frozen at generation from Remote Config (§13). */
  tuning: EngineTuning;
  /** Frozen `daily_piece_count` (§13 `[RC, 60]`). */
  pieceCount: number;
  /** `daily_reroll_cap` (§13 `[RC, 5]`) — re-rolls AFTER the first roll. */
  rerollCap: number;
  /** Per-key provenance of the six frozen numbers, published for ops. */
  configSource: DailyConfigSource;
  generatedAt: string;
}

export interface DailyGenerationResult {
  doc: DailyBoardDoc;
  /** Plaintext, for logging counts and for tests. Never written to Firestore. */
  sequence: PieceId[];
  /** Every roll in order, rejected ones included — the ops signal for the gate. */
  attempts: DailySolvability[];
}

/** §8.2(a): 6–14 obstacle-free filled cells from a curated template. */
export function drawPrefill(seed: string): DailyPrefillCell[] {
  const rng = createRng(seed);
  const template = PREFILL_TEMPLATES[nextInt(rng, PREFILL_TEMPLATES.length)];
  if (!template) throw new Error('PRD §8.2: prefill template table is empty');
  const cells = orient(template.cells, nextInt(rng, TEMPLATE_ORIENTATIONS));
  return cells.map(({ r, c }) => ({ r, c, color: nextInt(rng, BLOCK_COLOR_COUNT) }));
}

/**
 * §8.2(b): the first `daily_piece_count` piece IDs drawn from the §6.2 weights,
 * no mercy. `drawPiece` with the default pool IS the §6.2 weighted draw — the
 * weights are never restated here, so they cannot drift from the engine's.
 */
export function drawSequence(seed: string, count: number): PieceId[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`PRD §8.2: daily_piece_count must be a positive integer, got ${count}`);
  }
  const rng = createRng(seed);
  return Array.from({ length: count }, () => drawPiece(rng));
}

/**
 * §8.2 solvability: median placements the greedy bot survives over `trials`.
 *
 * The board is fully deterministic here (fixed sequence, no obstacles, so the
 * engine draws no randomness) — the only thing varying across trials is the
 * bot's own tiebreak RNG, which is what `playout`'s separate `botSeed` exists
 * for. The bot is imported from `packages/content` unchanged: it is a fixed
 * yardstick, and reimplementing it would silently change the measurement.
 */
export function solvabilityMedian(
  config: GameConfig,
  date: string,
  trials: number = SOLVABILITY_TRIALS,
): number {
  const seed = dailyPlaySeed(date);
  const survived: number[] = [];
  for (let i = 0; i < trials; i++) {
    survived.push(playout(config, seed, `${seed}|bot${i}`).result.moves);
  }
  survived.sort((a, b) => a - b);
  const mid = trials >> 1;
  const hi = survived[mid] ?? 0;
  return trials % 2 === 1 ? hi : ((survived[mid - 1] ?? 0) + hi) / 2;
}

/**
 * Generate and seal one day's board (§8.2, PRD v1.12).
 *
 * Re-rolls with `seed + "-rN"` while the solvability gate fails, up to
 * `rerollCap` re-rolls. The first passing roll wins. If EVERY roll fails we
 * publish the best-scoring one (highest bot median) with `passed: false` rather
 * than publishing nothing: §8.1's ritual is "one board every day, for everyone",
 * and a missing document breaks every client for 24h, while a hard board merely
 * plays badly. `publish.ts` raises the ops alert for that case.
 */
export function generateDailyBoard(input: DailyGenerationInput): DailyGenerationResult {
  if (!Number.isInteger(input.rerollCap) || input.rerollCap < 0) {
    throw new Error(`PRD §8.2: daily_reroll_cap must be a non-negative integer`);
  }

  const attempts: DailySolvability[] = [];
  const rolls: DailyGenerationResult[] = [];

  for (let n = 0; n <= input.rerollCap; n++) {
    const revision = rerollRevision(n);
    const attempt = attemptSeed(input.seed, revision);
    const prefill = drawPrefill(prefillSeed(attempt));
    const sequence = drawSequence(sequenceSeed(attempt), input.pieceCount);
    const config = dailyGameConfig({ tuning: input.tuning, prefill }, sequence, input.date);

    const medianMoves = solvabilityMedian(config, input.date);
    const solvability: DailySolvability = {
      trials: SOLVABILITY_TRIALS,
      medianMoves,
      minMoves: SOLVABILITY_MIN_MOVES,
      passed: medianMoves >= SOLVABILITY_MIN_MOVES,
    };
    attempts.push(solvability);

    const rolled: DailyGenerationResult = {
      doc: {
        date: input.date,
        generatorVersion: DAILY_GENERATOR_VERSION,
        revision,
        engineVersion: engineVersion(),
        engineConfig: {
          tuning: input.tuning,
          prefill,
          pieceCount: input.pieceCount,
          pieceSequence: sealSequence(attempt, sequence),
        },
        configSource: input.configSource,
        solvability,
        generatedAt: input.generatedAt,
        activatesAt: dailyActivatesAt(input.date),
      },
      sequence,
      attempts,
    };

    if (solvability.passed) return rolled;
    rolls.push(rolled);
  }

  // Every roll failed the gate (§8.2 v1.12): ship the least-bad one.
  const best = rolls[bestAttemptIndex(rolls.map((r) => r.doc.solvability.medianMoves))];
  if (!best) throw new Error('PRD §8.2: generation loop produced no board');
  return best;
}

/**
 * §8.2 (v1.12): which failed roll gets published — the highest greedy-bot
 * median. Ties keep the EARLIEST roll, so a day where every roll scores the same
 * publishes the plain un-suffixed board rather than `-r5` for no reason, and the
 * choice stays a pure function of the day.
 */
export function bestAttemptIndex(medians: readonly number[]): number {
  let best = -1;
  let bestMedian = Number.NEGATIVE_INFINITY;
  medians.forEach((median, i) => {
    if (median > bestMedian) {
      bestMedian = median;
      best = i;
    }
  });
  return best;
}
