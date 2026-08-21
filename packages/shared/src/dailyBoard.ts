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
  PIECE_IDS,
  applyPlacement,
  createGame,
  fnv1a,
  getLegalPlacements,
  simulate,
  type EngineTuning,
  type GameConfig,
  type GameEvent,
  type GameState,
  type GameStatus,
  type Move,
  type PieceId,
} from '@blockmanor/engine';
import { z } from 'zod';

/** §8.2: the published board lives at `dailyBoards/{YYYY-MM-DD}`. */
export const DAILY_BOARDS_COLLECTION = 'dailyBoards';

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
  /** §8.2 / v1.14 — `engineVersion()` at generation. §8.5's mismatch signal. */
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

// --- engineVersion (§8.2, PRD v1.14) ---------------------------------------

/**
 * Bumped only when the PROBE below changes. It keeps a probe rewrite from
 * looking like an engine change: the prefix moves too, so the reason is legible
 * in a log line instead of guessed at from a digest that jumped.
 */
const PROBE_SCHEME = 'daily-sim-v2';

/**
 * Probe inputs. Deliberately literals, and deliberately NOT read from the §13
 * registry defaults: a balance tweak must not read as an engine change — and
 * this file may not touch Remote Config at all (v1.7, asserted by
 * `backend/functions/test/generate.test.ts`).
 */
const PROBE_DATE = '2000-01-01';
const PROBE_TUNING: EngineTuning = {
  mercy_threshold: 0.6,
  mercy_small_prob: 0.5,
  score_clear_base: 100,
  combo_step: 0.5,
  perfect_clear_bonus: 300,
};
const PROBE_PREFILL: DailyPrefillCell[] = [
  { r: 0, c: 0, color: 0 },
  { r: 0, c: 1, color: 1 },
  { r: 1, c: 0, color: 2 },
  { r: 3, c: 4, color: 3 },
  { r: 6, c: 7, color: 4 },
  { r: 7, c: 2, color: 5 },
];

/**
 * Three probe boards, each pinning a scoring path the others cannot reach. What
 * they cover is asserted directly in `packages/shared/test/dailyBoard.test.ts`,
 * so a probe edit that narrows coverage fails the suite instead of quietly
 * surviving the re-pin the digest test asks for.
 *  1. A short sequence that runs dry with the board alive — `'completed'`, the
 *     `SEQUENCE_EXHAUSTED` path.
 *  2. A long one that packs the board to death — `'lost'`, and the only probe
 *     that clears lines, including a `comboDisplay >= 2` combo (§6.6).
 *  3. Eight dots onto an EMPTY board, which fills row 0 and empties the board —
 *     the only way to reach §6.6's `PERFECT_CLEAR`. Without it, mutating
 *     `perfect_clear_bonus`'s handling leaves the digest byte-identical, and
 *     `perfect_clear_bonus` is frozen into `engineConfig` precisely because it
 *     is score-affecting on the daily path.
 * Sequences 1 and 2 are drawn from `PIECE_IDS`, so the §6.2 piece table is part
 * of the probe input too.
 */
const PROBE_SEQUENCES: readonly { prefill: DailyPrefillCell[]; sequence: readonly PieceId[] }[] = [
  { prefill: PROBE_PREFILL, sequence: PIECE_IDS.slice(0, 6) },
  { prefill: PROBE_PREFILL, sequence: [...PIECE_IDS, ...PIECE_IDS, ...PIECE_IDS] },
  { prefill: [], sequence: Array.from({ length: BOARD_SIZE }, () => 'P01' as PieceId) },
];

/** First legal anchor of the first playable tray slot — a fixed, boring policy. */
function firstLegalMove(state: GameState): Move | undefined {
  for (let i = 0; i < state.tray.length; i++) {
    const [first] = getLegalPlacements(state, i);
    if (first) return first;
  }
  return undefined;
}

/**
 * Play one probe to its terminal status and serialise everything the run
 * touched: the rebuilt `GameConfig` (which carries every literal
 * `dailyGameConfig` hardcodes), every chosen move, every emitted `GameEvent`,
 * and the `simulate()` result over the collected log — the exact call §8.5
 * makes.
 */
function probeTrace(probe: (typeof PROBE_SEQUENCES)[number]): {
  status: GameStatus;
  events: GameEvent[];
  trace: string;
} {
  const config = dailyGameConfig(
    { tuning: PROBE_TUNING, prefill: probe.prefill },
    probe.sequence,
    PROBE_DATE,
  );
  const seed = dailyPlaySeed(PROBE_DATE);
  let state = createGame(config, seed);
  const moves: Move[] = [];
  const steps: unknown[] = [];
  const events: GameEvent[] = [];
  while (state.status === 'playing') {
    const move = firstLegalMove(state);
    // Unreachable while `playing` (§6.7 ends the run when no move exists), and
    // a guard rather than a throw so a future engine change degrades the
    // fingerprint instead of breaking generation.
    if (!move) break;
    const step = applyPlacement(state, move);
    state = step.state;
    moves.push(move);
    steps.push([move, step.events]);
    events.push(...step.events);
  }
  return {
    status: state.status,
    events,
    trace: JSON.stringify([config, seed, steps, simulate(config, seed, moves)]),
  };
}

/**
 * The probe runs behind `engineVersion()`. Exported for its coverage test only:
 * nothing on the daily path should call this — call `engineVersion()`.
 */
export const probeRuns = (): ReturnType<typeof probeTrace>[] => PROBE_SEQUENCES.map(probeTrace);

let cached: string | undefined;

/**
 * §8.2 (PRD v1.14): a fingerprint of the **re-simulation surface** — everything
 * §8.5 needs to reproduce a submitted daily run. Captured on every published
 * board so §8.5 can tell "this player cheated" from "we deployed a different
 * engine under them".
 *
 * It is a digest of what the surface *does*, not of the text it is written in:
 * three fixed daily boards are played out move by move and the whole trace
 * (config, moves, events, `simulate()` result) is hashed. So it moves for any
 * change to `packages/engine` behaviour on the daily path — including how
 * `simulate()` consumes `GameConfig.pieceSequence`, which no golden replay and
 * no determinism-corpus config covers — and for any change to
 * `dailyGameConfig()` or the literals it hardcodes (`mode`, `seedSalt`,
 * `goals`, `mercy`, `stars`, `ivySpreadInterval`, `ivyMaxTiles`), because those
 * ride in the serialised config. It does NOT move for a comment, a rename or a
 * pure refactor, which is the point: a version that jumped on every deploy
 * would be noise, and §8.5's verdict needs signal.
 *
 * Deterministic on any machine: the engine is pure (§0 rule 4) — no clock, no
 * `Math.random`, all randomness seeded from a literal date — the probe inputs
 * are literals, and JSON number formatting is exact per ECMA-262. Nothing here
 * reads a file, a path, a timestamp or an environment variable, so there is
 * nothing for a build to bake in differently. It is therefore computable inside
 * the Cloud Function from the esbuild bundle, where `packages/engine`'s source
 * files do not exist.
 *
 * Memoised: the walk costs ~80 placements, generation calls this once a day,
 * and `apps/mobile` never calls it at all.
 *
 * ponytail: 32-bit digest (fnv1a, matching the §5 corpus hash's format). Ample
 * for telling two builds apart; widen to a double fold if it ever has to
 * identify a build out of a large population.
 */
export function engineVersion(): string {
  cached ??= `${PROBE_SCHEME}+${fnv1a(
    probeRuns()
      .map((r) => r.trace)
      .join('\n'),
  )
    .toString(16)
    .padStart(8, '0')}`;
  return cached;
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
