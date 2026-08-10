/**
 * The Daily-Board client/server seam — PRD §8.2, consumed by §8.3 and §8.5.
 *
 * §4.2 puts "types, zod schemas, constants shared app<->backend" HERE, and this
 * is the one place where that matters most: §8.3's client builds a `GameConfig`
 * from the published `dailyBoards/{date}` document and §8.5's Cloud Function
 * rebuilds the SAME `GameConfig` to re-simulate the submitted move log. If the
 * two builders were separate copies they would have to agree forever, and the
 * first divergence would reject honest players as cheats. There is one builder,
 * and it lives here.
 *
 * What deliberately does NOT live here: the secret-handling half of §8.2 — the
 * HMAC salt, seed derivation, and the AES sealing/opening of the piece sequence.
 * Those stay in `backend/functions/src/daily/seal.ts` (§16: "Daily-board salt
 * only in Functions config"), and nothing in this file can reach them. The
 * sequence arrives here as an already-opened `PieceId[]`, handed over by the
 * §8.3 play-start callable.
 *
 * Remote Config is not imported here and must never be (PRD v1.7 / §8.2): the
 * daily path plays and validates from the frozen snapshot only.
 */

import {
  BLOCK_COLOR_COUNT,
  BOARD_SIZE,
  type EngineTuning,
  type GameConfig,
  type PieceId,
} from '@blockmanor/engine';
import { z } from 'zod';

/** §8.2: the published board lives at `dailyBoards/{YYYY-MM-DD}`. */
export const DAILY_BOARDS_COLLECTION = 'dailyBoards';

/**
 * §8.2 (PRD v1.12): what re-simulation depends on, beyond the frozen constants.
 *
 * The `packages/engine` package version plus the pinned determinism corpus hash
 * (§5 Stage-0 DoD). Captured on every published board so §8.5 can tell "this
 * player cheated" from "we deployed a different engine under them".
 *
 * Written out as a literal rather than imported because `packages/engine` is
 * PURE and stays untouched, and its `package.json` is not an exported subpath.
 * `packages/shared/test/dailyBoard.test.ts` asserts both halves against their
 * real sources on disk, so this cannot drift silently.
 */
export const ENGINE_VERSION = '0.1.0+392ad7a4';

/**
 * §8.2 publication boundary. Day D's board is generated at D-1 23:45 UTC and
 * becomes live at D 00:00:00.000 UTC.
 *
 * Epoch **milliseconds**, not an ISO string and not a Firestore `Timestamp`:
 * `firestore.rules` is the enforcement point and compares this against
 * `request.time.toMillis()`, an int-to-int comparison with no format or type
 * ambiguity. `packages/shared` also must not depend on `firebase-admin`.
 */
export const dailyActivatesAt = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);

/** AES-256-GCM envelope for the §8.2 sealed piece sequence; fields are base64. */
export interface SealedSequence {
  alg: 'AES-256-GCM';
  iv: string;
  ct: string;
  tag: string;
}

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
 *  - `pieceSequence` — sealed (§8.2); the play-start callable is the only way in.
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

/** The six frozen numbers, in the order §13 lists them. */
export const FROZEN_CONFIG_KEYS = [
  'mercy_threshold',
  'mercy_small_prob',
  'score_clear_base',
  'combo_step',
  'perfect_clear_bonus',
  'daily_piece_count',
] as const;

export type FrozenConfigKey = (typeof FROZEN_CONFIG_KEYS)[number];

/**
 * Provenance of each frozen number: `'live'` means the Remote Config template
 * supplied a value that passed validation, `'default'` means the §13 registry
 * default was frozen instead (template unreadable, key absent, or the live value
 * out of bounds — e.g. an operator typo, which `asNumber()` silently renders as
 * `0`). Published so that an operator debugging a strange day can tell which it
 * was without re-deriving anything.
 */
export type DailyConfigSource = Record<FrozenConfigKey, 'live' | 'default'>;

/** The `dailyBoards/{date}` document (§8.2). */
export interface DailyBoardDoc {
  date: string;
  generatorVersion: number;
  /** `''` for the first roll, `'-r1'`…`'-r5'` after a §8.2 solvability re-roll. */
  revision: string;
  /** §8.2 / v1.12 — `ENGINE_VERSION` at generation. §8.5's mismatch signal. */
  engineVersion: string;
  engineConfig: DailyEngineConfig;
  configSource: DailyConfigSource;
  solvability: DailySolvability;
  /** ISO-8601, injected by the caller — generation has no clock of its own. */
  generatedAt: string;
  /** §8.2 / v1.12 — epoch ms; the board is not readable or playable before it. */
  activatesAt: number;
}

/**
 * The seed handed to `createGame`/`simulate` for a daily run. Public on purpose:
 * client and server must agree on it, and it is not the secret §8.2 seed. With a
 * fixed `pieceSequence` and an obstacle-free prefill the engine consumes no
 * randomness at all, so this only has to be STABLE, not unpredictable.
 */
export const dailyPlaySeed = (date: string): string => `daily:${date}`;

/**
 * Rebuild the engine config for a day from the frozen snapshot — the ONE seam
 * §8.3 (play) and §8.5 (re-simulation) both call. Note what is NOT here: any
 * read of Remote Config.
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

// --- trust boundary (§4.2 "zod schemas ... shared app<->backend") -----------

const finite = z.number().finite();
const base64 = z.string().min(1);

const tuningSchema = z.object({
  mercy_threshold: finite,
  mercy_small_prob: finite,
  score_clear_base: finite,
  combo_step: finite,
  perfect_clear_bonus: finite,
});

const prefillCellSchema = z.object({
  r: z
    .number()
    .int()
    .min(0)
    .max(BOARD_SIZE - 1),
  c: z
    .number()
    .int()
    .min(0)
    .max(BOARD_SIZE - 1),
  color: z
    .number()
    .int()
    .min(0)
    .max(BLOCK_COLOR_COUNT - 1),
});

const sourceSchema = z.enum(['live', 'default']);

/**
 * Validates a document fetched from `dailyBoards/{date}` (§8.2) before anything
 * plays or re-simulates from it. This is a real trust boundary in both
 * directions: the client is parsing bytes off the network, and §8.5's callable
 * is parsing a document that a future generator version may have written.
 * `EngineConfigError`-style late failures deep inside the engine are much worse
 * than a parse error at the edge.
 *
 * Typed as `z.ZodType<DailyBoardDoc>` on purpose: TypeScript then rejects any
 * drift between the interface above and this schema at compile time, so there is
 * only one shape to keep in sync, not two.
 */
export const dailyBoardDocSchema: z.ZodType<DailyBoardDoc> = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  generatorVersion: z.number().int().nonnegative(),
  revision: z.string(),
  engineVersion: z.string().min(1),
  engineConfig: z.object({
    tuning: tuningSchema,
    prefill: z.array(prefillCellSchema),
    // §8.5 rejects `moves.length > daily_piece_count`, so a non-integer or
    // non-positive count here would corrupt that comparison.
    pieceCount: z.number().int().positive(),
    pieceSequence: z.object({
      alg: z.literal('AES-256-GCM'),
      iv: base64,
      ct: base64,
      tag: base64,
    }),
  }),
  configSource: z.object({
    mercy_threshold: sourceSchema,
    mercy_small_prob: sourceSchema,
    score_clear_base: sourceSchema,
    combo_step: sourceSchema,
    perfect_clear_bonus: sourceSchema,
    daily_piece_count: sourceSchema,
  }),
  solvability: z.object({
    trials: z.number().int().nonnegative(),
    medianMoves: finite,
    minMoves: finite,
    passed: z.boolean(),
  }),
  generatedAt: z.string().min(1),
  activatesAt: z.number().int().nonnegative(),
});

/** Throws `z.ZodError` on anything that is not a §8.2 board document. */
export const parseDailyBoardDoc = (input: unknown): DailyBoardDoc =>
  dailyBoardDocSchema.parse(input);
