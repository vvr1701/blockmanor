/**
 * Daily-Board generation — PRD §8.2. Pure: no Firestore, no clock, no Remote
 * Config, no `Math.random`. Everything it needs is an argument, so the whole of
 * §8.2's interesting behaviour is testable without an emulator.
 *
 * The output document is what §8.3 plays from and §8.5 re-simulates from. Its
 * `engineConfig` is the frozen snapshot mandated by PRD v1.7: once this function
 * returns, NOTHING downstream may consult Remote Config, or a LiveOps push
 * mid-day could turn an honest submission into a `daily_cheat_rejected`.
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
import { PREFILL_TEMPLATES, TEMPLATE_ORIENTATIONS, orient } from './patterns';
import { attemptSeed, prefillSeed, sealSequence, sequenceSeed, type SealedSequence } from './seal';

/** Bump when a change here would produce a different board from the same seed. */
export const DAILY_GENERATOR_VERSION = 1;

/** §8.2 solvability gate: "greedy bot must survive ≥15 placements across 200 trials median". */
export const SOLVABILITY_TRIALS = 200;
export const SOLVABILITY_MIN_MOVES = 15;

/** §8.2 re-roll suffix. The PRD specifies exactly one re-roll. */
export const REROLL_REVISION = '-r1';

/** A prefilled cell. Always a plain block: §8.2 says "obstacle-free". */
export interface DailyPrefillCell {
  r: number;
  c: number;
  color: number;
}

/**
 * The frozen `engineConfig` snapshot (PRD §8.2 / v1.7). Every engine-relevant
 * value for the day, captured once at generation:
 *  - `tuning` — the §6.6 scoring constants AND the §6.4 mercy values. Mercy is
 *    OFF on the Daily Board (§6.4, §8.1), and the values are recorded anyway
 *    because §8.2 requires the snapshot to be COMPLETE: §8.5 rebuilds a whole
 *    `GameConfig` from this object and must never fall back to live RC for a
 *    missing field.
 *  - `pieceSequence` — sealed (§8.2); `openSequence` is the only way in.
 *  - `pieceCount` — in the clear so §8.5 can enforce its `moves.length >
 *    daily_piece_count` rule without decrypting anything.
 *  - `prefill` — colours included, because `FinalResult.boardHash` covers cell
 *    colours and §8.5 compares results exactly.
 */
export interface DailyEngineConfig {
  tuning: EngineTuning;
  prefill: DailyPrefillCell[];
  pieceCount: number;
  pieceSequence: SealedSequence;
}

export interface DailySolvability {
  trials: number;
  medianMoves: number;
  minMoves: number;
  passed: boolean;
}

/** The `dailyBoards/{date}` document (§8.2). */
export interface DailyBoardDoc {
  date: string;
  generatorVersion: number;
  /** `''` for the first roll, `'-r1'` after the §8.2 solvability re-roll. */
  revision: string;
  engineConfig: DailyEngineConfig;
  solvability: DailySolvability;
  /** ISO-8601, injected by the caller — this module has no clock. */
  generatedAt: string;
}

export interface DailyGenerationInput {
  date: string;
  /** `dailySeed(salt, date)` — the §8.2 HMAC. Never published. */
  seed: string;
  /** Frozen at generation from Remote Config (§13). */
  tuning: EngineTuning;
  /** Frozen `daily_piece_count` (§13 `[RC, 60]`). */
  pieceCount: number;
  generatedAt: string;
}

export interface DailyGenerationResult {
  doc: DailyBoardDoc;
  /** Plaintext, for logging counts and for tests. Never written to Firestore. */
  sequence: PieceId[];
  /** Includes the roll that was rejected, if any — the ops signal for the gate. */
  attempts: DailySolvability[];
}

/**
 * The seed handed to `createGame`/`simulate` for a daily run. Public on purpose:
 * client and server must agree on it, and it is not the secret §8.2 seed. With a
 * fixed `pieceSequence` and an obstacle-free prefill the engine consumes no
 * randomness at all, so this only has to be STABLE, not unpredictable.
 */
export const dailyPlaySeed = (date: string): string => `daily:${date}`;

/**
 * Rebuild the engine config for a day from the frozen snapshot — the seam §8.3
 * and §8.5 both call. Note what is NOT here: any read of Remote Config.
 *
 * The prefill rides in on `level.prefill` because that is the engine's only
 * prefill channel (§4.3 `GameConfig` has no top-level prefill field). `goals` is
 * empty, so the §6.7 win branch is unreachable and the run can only end in
 * `'lost'` or `'completed'` — exactly §8.2's "the Daily Board has no win state".
 */
export function dailyGameConfig(
  engineConfig: Pick<DailyEngineConfig, 'tuning' | 'prefill'>,
  sequence: readonly PieceId[],
  date: string,
): GameConfig {
  return {
    mode: 'daily',
    tuning: engineConfig.tuning,
    pieceSequence: sequence,
    level: {
      id: 0,
      chapter: 0,
      seedSalt: dailyPlaySeed(date),
      prefill: engineConfig.prefill.map(({ r, c, color }) => ({
        r,
        c,
        type: 'filled' as const,
        color,
      })),
      goals: [],
      pieceWeightOverrides: {},
      // §6.4/§8.1: mercy off. Redundant with `mode: 'daily'` and with the fixed
      // sequence, and set anyway so no single flag flip can switch it back on.
      mercy: false,
      stars: { s2: 0, s3: 0 },
      ivySpreadInterval: 3,
      ivyMaxTiles: 16,
    },
  };
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
 * Generate and seal one day's board (§8.2), re-rolling once with `seed + "-r1"`
 * if the solvability gate fails.
 *
 * If the re-roll ALSO fails we publish it and mark `passed: false` rather than
 * publishing nothing: §8.1's ritual is "one board every day, for everyone", and
 * a missing document breaks every client for 24h, while a hard board merely
 * plays badly. `publish.ts` logs that case at error level for the operator.
 * (PRD §8.2 does not say what to do after a failed re-roll — flagged as a gap.)
 */
export function generateDailyBoard(input: DailyGenerationInput): DailyGenerationResult {
  const attempts: DailySolvability[] = [];

  for (const revision of ['', REROLL_REVISION]) {
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

    if (solvability.passed || revision === REROLL_REVISION) {
      return {
        doc: {
          date: input.date,
          generatorVersion: DAILY_GENERATOR_VERSION,
          revision,
          engineConfig: {
            tuning: input.tuning,
            prefill,
            pieceCount: input.pieceCount,
            pieceSequence: sealSequence(attempt, sequence),
          },
          solvability,
          generatedAt: input.generatedAt,
        },
        sequence,
        attempts,
      };
    }
  }

  // Unreachable: the loop returns on its final iteration.
  throw new Error('PRD §8.2: generation loop fell through');
}
