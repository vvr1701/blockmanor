/**
 * The 23:45 UTC scheduled publisher — PRD §8.2 (v1.12): day D's board is
 * generated on D-1 and activates at D 00:00 UTC.
 *
 * Everything impure lives here: the secret, the clock, Remote Config, Firestore.
 * `generate.ts` holds the rules and is pure.
 *
 * Remote Config is read EXACTLY ONCE, here, to build the frozen snapshot
 * (§8.2 / PRD v1.7). No other file in the daily path may import Remote Config —
 * that is the whole point of the snapshot.
 */

import {
  DAILY_BOARDS_COLLECTION,
  FROZEN_CONFIG_KEYS,
  REMOTE_CONFIG_DEFAULTS,
  type DailyBoardDoc,
  type DailyConfigSource,
  type DailySolvability,
  type FrozenConfigKey,
} from '@blockmanor/shared';
import { type EngineTuning } from '@blockmanor/engine';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { generateDailyBoard } from './generate';
import { dailySeed } from './seal';

/**
 * §16: "Daily-board salt only in Functions config." Provisioned with
 * `firebase functions:secrets:set DAILY_BOARD_SALT` (Secret Manager). It is
 * never in the repo, never in `.env`, and never in a client bundle — nothing
 * under `apps/mobile` can reach it.
 */
export const DAILY_BOARD_SALT = defineSecret('DAILY_BOARD_SALT');

/**
 * `daily_reroll_cap` is read from Remote Config alongside the six frozen numbers
 * but is deliberately NOT one of them: it steers generation and has no bearing
 * on re-simulation, so it is neither embedded in `engineConfig` nor reported in
 * `configSource` — the frozen snapshot stays exactly what §8.5 replays from.
 */
type DailyRcKey = FrozenConfigKey | 'daily_reroll_cap';

/**
 * Sanity bounds for each daily Remote Config number.
 *
 * This exists because a frozen value is IMMUTABLE for 24h and there is no undo:
 * `create()` refuses to overwrite (that is the idempotency guarantee), so
 * rolling Remote Config back does not repair the day. Worse, `asNumber()` on the
 * admin SDK returns **0** for anything that will not parse — so an operator
 * typing `ten` into `score_clear_base` in the RC console would freeze `0` and
 * every clear that day would score nothing, silently. And a bad
 * `daily_piece_count` makes `drawSequence` throw, which fails all three
 * scheduler retries identically and leaves NO board at all for 24h.
 *
 * Bounds are deliberately wide: they are a typo/corruption guard, not a balance
 * policy. Balance lives in Remote Config (§13), and anything inside these bounds
 * is honoured verbatim.
 */
const FROZEN_BOUNDS: Record<DailyRcKey, { min: number; max: number; integer: boolean }> = {
  // §6.4 probabilities.
  mercy_threshold: { min: 0, max: 1, integer: false },
  mercy_small_prob: { min: 0, max: 1, integer: false },
  // §6.6 scoring. `score_clear_base: 0` would make every clear worth nothing,
  // which is exactly the `asNumber()` failure mode, so 0 is out of band.
  score_clear_base: { min: 1, max: 10_000, integer: false },
  combo_step: { min: 0, max: 10, integer: false },
  perfect_clear_bonus: { min: 0, max: 1_000_000, integer: false },
  // §8.2 sequence length. Must be a positive integer or `drawSequence` throws.
  daily_piece_count: { min: 1, max: 1_000, integer: true },
  // §8.2 re-rolls. Each costs 200 bot playouts (~2s), so the ceiling is the
  // function timeout, not taste. 0 is legal and means "no re-roll".
  daily_reroll_cap: { min: 0, max: 20, integer: true },
};

export interface FrozenRemoteConfig {
  tuning: EngineTuning;
  pieceCount: number;
  /** §8.2 `daily_reroll_cap` — steers generation, not re-simulation. */
  rerollCap: number;
  /** Per-key provenance, published on the document (§8.2 ops signal). */
  source: DailyConfigSource;
}

/** Reads one key, or falls back to its §13 registry default. Never throws. */
function frozenNumber(
  key: DailyRcKey,
  read: (key: DailyRcKey) => number,
): { value: number; source: 'live' | 'default' } {
  const fallback = REMOTE_CONFIG_DEFAULTS[key];
  const bounds = FROZEN_BOUNDS[key];
  let value: number;
  try {
    value = read(key);
  } catch (error) {
    logger.warn('daily_generation: Remote Config key unreadable, freezing §13 default', {
      key,
      fallback,
      error,
    });
    return { value: fallback, source: 'default' };
  }

  const ok =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= bounds.min &&
    value <= bounds.max &&
    (!bounds.integer || Number.isInteger(value));

  if (!ok) {
    // The loud one. `asNumber()` renders a typo as 0, so this is the ONLY place
    // that mistake is catchable before it is frozen for the day.
    logger.error('daily_generation: Remote Config value out of bounds, freezing §13 default', {
      key,
      rejected: value,
      fallback,
      bounds,
    });
    return { value: fallback, source: 'default' };
  }
  return { value, source: 'live' };
}

/**
 * Read Remote Config once, validating EVERY frozen number before it becomes
 * immutable. Defaults come from the §13 registry in `packages/shared` — never a
 * literal at this call site (CLAUDE.md rule 3).
 *
 * Fallback is PER KEY, not all-or-nothing: one mistyped scoring constant must
 * not discard four good live values, and four good live values must not carry a
 * mistyped fifth into the snapshot.
 *
 * A whole-template fetch failure freezes the registry defaults rather than
 * aborting: the resulting board is internally consistent, which is all §8.5
 * needs, and no board at all would break the ritual for 24h (§8.1).
 */
export async function readFrozenRemoteConfig(): Promise<FrozenRemoteConfig> {
  let read: (key: DailyRcKey) => number;
  try {
    const template = await getRemoteConfig().getServerTemplate({
      defaultConfig: { ...REMOTE_CONFIG_DEFAULTS },
    });
    const config = template.evaluate();
    read = (key) => config.getNumber(key);
  } catch (error) {
    logger.warn('daily_generation: Remote Config unreadable, freezing §13 defaults', { error });
    read = () => {
      throw error;
    };
  }

  const frozen = Object.fromEntries(
    FROZEN_CONFIG_KEYS.map((key) => [key, frozenNumber(key, read)]),
  ) as Record<FrozenConfigKey, { value: number; source: 'live' | 'default' }>;

  return {
    tuning: {
      mercy_threshold: frozen.mercy_threshold.value,
      mercy_small_prob: frozen.mercy_small_prob.value,
      score_clear_base: frozen.score_clear_base.value,
      combo_step: frozen.combo_step.value,
      perfect_clear_bonus: frozen.perfect_clear_bonus.value,
    },
    pieceCount: frozen.daily_piece_count.value,
    rerollCap: frozenNumber('daily_reroll_cap', read).value,
    source: Object.fromEntries(
      FROZEN_CONFIG_KEYS.map((key) => [key, frozen[key].source]),
    ) as DailyConfigSource,
  };
}

/** The UTC calendar day of an ISO instant — §8.2 keys boards by UTC date. */
export const utcDate = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

/**
 * §8.2 (v1.12): the run at D-1 23:45 UTC generates day **D**. Derived from the
 * scheduled instant rather than from "now + 15 minutes" so a late or retried
 * run still targets the day it was scheduled for.
 */
export const nextUtcDate = (iso: string): string =>
  new Date(new Date(`${utcDate(iso)}T00:00:00.000Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);

/** §8.2: durable ops alerts. Deny-all for clients; written by Functions only. */
export const OPS_ALERTS_COLLECTION = 'opsAlerts';
export const SOLVABILITY_ALERT = 'daily_solvability_exhausted';

/**
 * §8.2 (v1.12): "fire an ops alert — never a bare log line."
 *
 * Two channels because they fail differently: the error log reaches Cloud Error
 * Reporting immediately but ages out with log retention, and the Firestore
 * document survives, is queryable, and is what an operator sees when asked
 * "which days shipped a board that failed the gate?". The document id is
 * deterministic, so a scheduler retry updates one alert instead of fanning out.
 *
 * Alerting never blocks publication: a board with no alert beats no board.
 */
async function raiseOpsAlert(
  kind: string,
  date: string,
  detail: Record<string, unknown>,
): Promise<void> {
  logger.error(`ops_alert: ${kind}`, { alert: kind, date, ...detail });
  try {
    await getFirestore()
      .collection(OPS_ALERTS_COLLECTION)
      .doc(`${date}_${kind}`)
      .set({ kind, date, raisedAt: new Date().toISOString(), ...detail });
  } catch (error) {
    logger.error('ops_alert: could not persist alert document', { alert: kind, date, error });
  }
}

type AlreadyExists = { code?: number | string };
const isAlreadyExists = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  // Firestore/gRPC ALREADY_EXISTS.
  ((error as AlreadyExists).code === 6 || (error as AlreadyExists).code === 'already-exists');

export interface PublishResult {
  status: 'created' | 'exists';
  doc?: DailyBoardDoc;
}

/**
 * Generate and publish one day's board. Idempotent by construction: `create()`
 * refuses to overwrite, so a scheduler retry (or a manual re-run) can never
 * swap the board out from under a player mid-day. Determinism alone is not
 * enough for that guarantee — a Remote Config push between the two runs would
 * otherwise produce a different frozen snapshot for the same date.
 */
export async function publishDailyBoard(
  date: string,
  secretSalt: string,
  generatedAt: string,
): Promise<PublishResult> {
  const { tuning, pieceCount, rerollCap, source } = await readFrozenRemoteConfig();
  const { doc, attempts } = generateDailyBoard({
    date,
    seed: dailySeed(secretSalt, date),
    tuning,
    pieceCount,
    rerollCap,
    configSource: source,
    generatedAt,
  });

  if (!doc.solvability.passed) {
    // §8.2 (v1.12): every roll failed, so the best of them ships and someone is
    // told. The board is hard, not broken — but nobody should learn that from a
    // player.
    await raiseOpsAlert(SOLVABILITY_ALERT, date, {
      publishedRevision: doc.revision,
      publishedMedian: doc.solvability.medianMoves,
      minMoves: doc.solvability.minMoves,
      rerollCap,
      medians: attempts.map((a: DailySolvability) => a.medianMoves),
    });
  }

  try {
    await getFirestore().collection(DAILY_BOARDS_COLLECTION).doc(date).create(doc);
  } catch (error) {
    if (isAlreadyExists(error)) {
      logger.info('daily_generation: board already published, leaving it alone', { date });
      return { status: 'exists' };
    }
    throw error;
  }

  logger.info('daily_generation: published', {
    date,
    revision: doc.revision,
    rolls: attempts.length,
    pieceCount,
    prefillCells: doc.engineConfig.prefill.length,
    medianMoves: doc.solvability.medianMoves,
    engineVersion: doc.engineVersion,
    activatesAt: doc.activatesAt,
    configSource: doc.configSource,
  });
  return { status: 'created', doc };
}

/**
 * §8.2 (v1.12): "Cloud Function scheduled 23:45 UTC on D-1, generating day D".
 *
 * The old 00:00 schedule generated day D *at* 00:00 on D, which left a gap of
 * seconds-to-minutes in which §8.3's countdown had reached zero and the document
 * did not exist yet. Pre-generating closes it; the board is inert until its
 * `activatesAt`, enforced in `firestore.rules`.
 *
 * No §14 analytics event fires here. §14's taxonomy is client Firebase Analytics
 * and marks exactly one server event (`daily_missed`, which belongs to §8.6);
 * there is no generation event in it. Inventing one would be a new permanent
 * API name and needs a PRD amendment first (§14, §0.1) — so generation reports
 * through structured logs and, on failure, through `opsAlerts`.
 */
export const generateDailyBoardScheduled = onSchedule(
  {
    schedule: '45 23 * * *',
    timeZone: 'UTC',
    secrets: [DAILY_BOARD_SALT],
    // Up to 6 rolls × 200 greedy-bot playouts of a 60-piece sequence — seconds,
    // not the 60s default.
    timeoutSeconds: 300,
    memory: '512MiB',
    retryCount: 3,
  },
  async (event) => {
    if (getApps().length === 0) initializeApp();
    const generatedAt = event.scheduleTime ?? new Date().toISOString();
    await publishDailyBoard(nextUtcDate(generatedAt), DAILY_BOARD_SALT.value(), generatedAt);
  },
);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * §8.2 (v1.12) self-heal: re-run generation for one date, by hand.
 *
 * The scheduler retries three times and then gives up; without this there is no
 * way to recover a day short of a deploy. Admin-only via the `admin` custom
 * claim — set with `admin.auth().setCustomUserClaims(uid, { admin: true })`, so
 * it cannot be granted from a client. Safe to call twice: publication uses
 * `create()`, so an existing board is returned untouched (`status: 'exists'`).
 */
export const regenerateDailyBoard = onCall<{ date?: unknown }>(
  { secrets: [DAILY_BOARD_SALT], timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    if (request.auth?.token.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin only');
    }
    const date = request.data?.date;
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      throw new HttpsError('invalid-argument', 'date must be YYYY-MM-DD');
    }

    if (getApps().length === 0) initializeApp();
    const result = await publishDailyBoard(
      date,
      DAILY_BOARD_SALT.value(),
      new Date().toISOString(),
    );
    logger.info('daily_generation: manual re-trigger', {
      date,
      uid: request.auth.uid,
      status: result.status,
    });
    return { status: result.status, date };
  },
);
