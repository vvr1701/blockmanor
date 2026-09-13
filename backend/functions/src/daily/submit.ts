/**
 * §8.5 anti-cheat submission + §8.6 streak — the server side of §4.3's
 * determinism promise.
 *
 * "The client submits its move log; the server re-simulates and accepts only
 * matching scores" (§4.3). The re-simulation calls the SAME `simulate()` the
 * client played with, over a `GameConfig` rebuilt by the SAME
 * `dailyGameConfig()` builder in `@blockmanor/shared` (§4.2). Two copies of that
 * builder would have to agree forever, and the first divergence would reject
 * honest players as cheats — so there is one, and it is imported, not repeated.
 *
 * Where the config comes from is the other half, and it is not negotiable
 * (§8.2 / PRD v1.7, restated in §13's scope note): the frozen `engineConfig`
 * snapshot on `dailyBoards/{date}`, NEVER live Remote Config. A LiveOps push at
 * noon must not turn an honest submission made at 09:00 into a
 * `daily_cheat_rejected`. That includes `daily_piece_count`: §8.5's move-count
 * ceiling is read from `engineConfig.pieceCount`, which was frozen at
 * generation, not from the live key of the same name.
 *
 * This file therefore cannot reach Remote Config at all — it does not import
 * it, and `generate.test.ts` asserts that it never will. §8.6's one live key,
 * `daily_streak_min_moves [RC, 3]`, is read in `streak.ts`, which explains
 * there why a non-engine key is allowed to be live.
 *
 * A PARTIAL move log is normal, not an attack: §8.3's app-kill path submits the
 * log up to that point, and `simulate()` over it simply ends with the run still
 * `'playing'`. Nothing here requires a terminal status.
 */

import {
  DAILY_ATTEMPTS_SUBCOLLECTION,
  DAILY_BOARDS_COLLECTION,
  DAILY_MOVE_LOGS_SUBCOLLECTION,
  DAILY_STALE_AFTER_MS,
  USERS_COLLECTION,
  dailyGameConfig,
  dailyPlaySeed,
  dailySubmissionSchema,
  engineVersion,
  parseDailyBoardDoc,
  type DailyBoardDoc,
  type DailySubmission,
} from '@blockmanor/shared';
import { IllegalMoveError, TRAY_SIZE, simulate, type FinalResult } from '@blockmanor/engine';
import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { DAILY_BOARD_SALT, raiseOpsAlert } from './publish';
import { attemptSeed, dailySeed, openSequence } from './seal';
import { nextStreak, streakMinMoves, type StreakState } from './streak';

/**
 * §8.5: "submission for a past date >36h old" is rejected, measured from the
 * board's `activatesAt` — twelve hours for a player who died at 23:59 to get
 * back online. The value lives in `@blockmanor/shared` because play-start's
 * pending-attempt gate (§0 v1.26(a)) must agree with it exactly.
 */
const STALE_AFTER_MS = DAILY_STALE_AFTER_MS;

/** Distinct `HttpsError.details.reason` values — §8.5 rejects each separately. */
export type SubmitRejection =
  | 'not-published'
  | 'board-unreadable'
  | 'not-yet-live'
  | 'stale-date'
  | 'too-many-moves'
  | 'not-started'
  | 'already-submitted'
  | 'illegal-move'
  | 'score-mismatch';

const reject = (
  reason: SubmitRejection,
  message: string,
  code: 'not-found' | 'failed-precondition' | 'permission-denied' = 'failed-precondition',
): HttpsError => new HttpsError(code, message, { reason });

export interface SubmitResult {
  date: string;
  /** The RE-SIMULATED score. The claimed one is never stored, only compared. */
  score: number;
  status: FinalResult['status'];
  moves: number;
  /** §8.6, server-authoritative. */
  streak: number;
  streakGranted: boolean;
  /**
   * §0 v1.26(b): false when an identical move log was already accepted for this
   * day. The submission still counts for the attempt and the streak, but §8.4's
   * histogram excludes it and the client shows no percentile.
   */
  countsForPercentile: boolean;
}

/**
 * §0 v1.26(b)/v1.27: stable identity of a move log. A daily tray yields exactly
 * `TRAY_SIZE` placements before refilling (§6.3), and its used slots stay put,
 * so placements from one tray can often be replayed in any order for the same
 * score. Each tray's placements are sorted by slot before hashing, so a
 * reordered copy is the same log. Moves are rebuilt with a fixed key order, so
 * JSON is canonical; sha256 keeps the document id fixed-length and opaque.
 */
export const moveLogHash = (moves: DailySubmission['moves']): string => {
  const canonical = moves.map(({ pieceIndex, r, c }) => ({ pieceIndex, r, c }));
  for (let i = 0; i < canonical.length; i += TRAY_SIZE) {
    const tray = canonical.slice(i, i + TRAY_SIZE).sort((a, b) => a.pieceIndex - b.pieceIndex);
    canonical.splice(i, tray.length, ...tray);
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

/** §8.2 v1.12/v1.14: the published board was generated under a different engine. */
export const ENGINE_DRIFT_ALERT = 'daily_engine_drift';

/**
 * ponytail: per-instance memo, so a drift day costs one alert write per warm
 * instance instead of one per submission. Swap for a `create()`-guarded write
 * if instance churn ever makes that too noisy.
 */
const alerted = new Set<string>();

/**
 * §8.2 (PRD v1.12/v1.14), ruled for §8.5: a mismatch between the board's
 * `engineVersion` and this deploy's changes NOTHING about the submission, and
 * is never `daily_cheat_rejected`. The frozen snapshot freezes *config*, not
 * engine *code*, so a mismatch means we deployed under the player — blaming
 * them for our deploy is the one thing this design must not do.
 *
 * If the engine change was not replay-affecting (the common case) the
 * re-simulation still matches and nothing happens. If it was, honest
 * submissions start failing together, and this is the signal that surfaces it —
 * a durable `opsAlerts` document, not only a log line, for the same reason
 * §8.2's solvability alert is one: logs age out, and the question an operator
 * asks later is "which days ran under a drifted engine?".
 */
async function checkEngineDrift(board: DailyBoardDoc): Promise<void> {
  const live = engineVersion();
  if (board.engineVersion === live || alerted.has(board.date)) return;
  // Memoised only AFTER the durable write lands. Marking first would let a
  // single Firestore blip turn a whole instance's drift day into log lines
  // nobody queries later, which is exactly the failure the durable half exists
  // to prevent.
  const persisted = await raiseOpsAlert(ENGINE_DRIFT_ALERT, board.date, {
    boardEngineVersion: board.engineVersion,
    liveEngineVersion: live,
  });
  if (persisted) alerted.add(board.date);
}

/**
 * §8.5's single structured log. Not a §14 analytics event: §14's Daily row has
 * no `daily_cheat_rejected` in it, and §14 names are a permanent API that
 * needs a PRD amendment before one is invented (§0.1) — the same call
 * `publish.ts` makes for generation. §8.5 says "logged", and this is that.
 *
 * Fires only for rejections that tampering is the sole explanation for. A
 * duplicate submission is usually a client retrying over a flaky connection and
 * a stale date is usually a player who was offline for two days; logging either
 * as a cheat would poison the one signal this log exists to carry.
 */
function logCheatRejected(
  reason: SubmitRejection,
  uid: string,
  board: DailyBoardDoc,
  payload: DailySubmission,
  detail: Record<string, unknown>,
): void {
  logger.warn('daily_cheat_rejected', {
    event: 'daily_cheat_rejected',
    reason,
    uid,
    date: payload.date,
    moves: payload.moves.length,
    claimedScore: payload.claimedScore,
    revision: board.revision,
    // Both fingerprints, so an operator can tell "this player cheated" from "we
    // deployed a different engine under them" (§8.2 v1.12/v1.14). No verdict is
    // derived from a mismatch — §8.5 does not specify one; see the WP report.
    boardEngineVersion: board.engineVersion,
    liveEngineVersion: engineVersion(),
    ...detail,
  });
}

/**
 * The callable's body with the clock and the salt injected, matching
 * `publishDailyBoard` and `startDailyAttempt`.
 */
export async function submitDailyAttempt(
  uid: string,
  input: unknown,
  secretSalt: string,
  now: number,
): Promise<SubmitResult> {
  const parsed = dailySubmissionSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Malformed submission', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  const payload = parsed.data;

  const db = getFirestore();
  const snap = await db.collection(DAILY_BOARDS_COLLECTION).doc(payload.date).get();
  if (!snap.exists) throw reject('not-published', 'No board for that date', 'not-found');

  let board: DailyBoardDoc;
  try {
    board = parseDailyBoardDoc(snap.data());
  } catch (error) {
    logger.error('daily_submit: board document did not parse', { date: payload.date, error });
    throw new HttpsError('internal', 'Board document is unreadable');
  }

  // Before any verdict, and regardless of which one follows: an ops signal, not
  // a player one.
  await checkEngineDrift(board);

  // Server time, always (§8.8): the payload carries a date, never a timestamp,
  // so a skewed device clock cannot move either edge of this window.
  if (now < board.activatesAt) throw reject('not-yet-live', 'That board is not live yet');
  if (now > board.activatesAt + STALE_AFTER_MS) {
    logger.info('daily_submit: rejected a stale submission', {
      uid,
      date: payload.date,
      ageMs: now - board.activatesAt,
    });
    throw reject('stale-date', 'That board closed for submissions more than 36h ago');
  }

  // §8.5: "a submission cannot contain more moves than the sequence has pieces."
  // `pieceCount` is the FROZEN `daily_piece_count`, so a mid-day RC push to that
  // key cannot retroactively invalidate a log that was legal when it was played.
  if (payload.moves.length > board.engineConfig.pieceCount) {
    logCheatRejected('too-many-moves', uid, board, payload, {
      pieceCount: board.engineConfig.pieceCount,
    });
    throw reject('too-many-moves', 'More moves than the board has pieces');
  }

  const attemptRef = db
    .collection(USERS_COLLECTION)
    .doc(uid)
    .collection(DAILY_ATTEMPTS_SUBCOLLECTION)
    .doc(payload.date);

  // No pre-transaction duplicate/started check. There was one, as a "cheap
  // reject before re-simulating", and it made BOTH guards below individually
  // unprovable: each mutation was masked by the other layer. It also cost an
  // extra Firestore read on every submission to save ~1ms of CPU on a rare one.
  // One guard, in the transaction, where the race is actually closed.

  // §4.3 determinism: same builder, same engine, same frozen inputs.
  const sequence = openSequence(
    attemptSeed(dailySeed(secretSalt, payload.date), board.revision),
    board.engineConfig.pieceSequence,
  );
  const config = dailyGameConfig(board.engineConfig, sequence, payload.date);

  let result: FinalResult;
  try {
    result = simulate(config, dailyPlaySeed(payload.date), payload.moves);
  } catch (error) {
    if (error instanceof IllegalMoveError) {
      logCheatRejected('illegal-move', uid, board, payload, { engine: error.message });
      throw reject('illegal-move', 'The move log does not replay on this board');
    }
    // `EngineConfigError` and anything else: the board doc is the suspect, not
    // the player. Distinct on purpose — §6's own comment asks for it.
    logger.error('daily_submit: re-simulation failed on a non-move error', {
      date: payload.date,
      error,
    });
    throw new HttpsError('internal', 'Could not re-simulate this board');
  }

  if (result.score !== payload.claimedScore) {
    logCheatRejected('score-mismatch', uid, board, payload, {
      simulatedScore: result.score,
      simulatedStatus: result.status,
      boardHash: result.boardHash,
    });
    throw reject('score-mismatch', 'Submitted score does not match the replay');
  }

  // §8.6: playing, not winning. `result.score` is deliberately unused here.
  const minMoves = await streakMinMoves();
  const earnsStreak = payload.moves.length >= minMoves;

  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const movesHash = moveLogHash(payload.moves);
  const logRef = db
    .collection(DAILY_BOARDS_COLLECTION)
    .doc(payload.date)
    .collection(DAILY_MOVE_LOGS_SUBCOLLECTION)
    .doc(movesHash);
  const streakState = await db.runTransaction(async (tx) => {
    // THE concurrency guard for §8.5 ">1 submission/user/day": this read is
    // inside the transaction, so Firestore aborts and retries a racing loser,
    // which then sees `'submitted'`. The later reads of `userRef` and `logRef`
    // happen to serialize same-user transactions too — do not rely on that. A
    // refactor that moves THIS read outside the transaction reopens the race
    // even if those other reads still mask it in tests.
    const attempt = await tx.get(attemptRef);
    const status = attempt.get('status');

    // §8.5 ">1 submission/user/day". Inside the transaction and nowhere else:
    // two submissions racing outside one would both read "not submitted".
    if (status === 'submitted') {
      logger.info('daily_submit: duplicate submission', { uid, date: payload.date });
      throw reject('already-submitted', 'You have already submitted for this board');
    }

    // §8.3 is the only door onto the board, and this is what makes it the ONLY
    // one. Without it, §8.6's "a missed UTC day resets to 0" is unenforceable
    // for the 12 hours between the board's day closing (24h) and the §8.5 stale
    // cutoff (36h): play-start correctly refuses a closed board (PRD v1.19(iv)),
    // but a player who never opened it could still submit a log for it and
    // collect the day.
    //
    // The sequence is NOT the gate. §8.1 makes the board "identical ... for
    // every player", so the moment the day opens every player who started holds
    // it and can share it — it is a pre-computation secret (§8.2), never a
    // per-player one. The started-attempt document is the per-player fact, and
    // it is the only thing here that is.
    if (status !== 'started') {
      logCheatRejected('not-started', uid, board, payload, { attemptStatus: status ?? null });
      throw reject('not-started', 'No attempt was started for this board');
    }
    const user = await tx.get(userRef);
    const streak = typeof user.get('streak') === 'number' ? (user.get('streak') as number) : 0;
    const last: unknown = user.get('lastStreakDate');
    // Built by cases rather than with an `undefined` field: Firestore rejects
    // `undefined` values outright, so the key is either a string or absent.
    const before: StreakState =
      typeof last === 'string' ? { streak, lastStreakDate: last } : { streak };
    const after = earnsStreak ? nextStreak(before, payload.date) : before;

    // §0 v1.26(b): first accepted submission of this exact log for this day
    // owns it. Read before any write (Firestore transactions require it); a
    // racing identical log serializes on this document.
    const countsForPercentile = !(await tx.get(logRef)).exists;
    if (countsForPercentile) {
      tx.create(logRef, { uid, submittedAt: new Date(now).toISOString() });
    }

    // `update`, not `set(..., {merge: true})`: the guard above proves a
    // `'started'` document is there, so an update that finds nothing is a bug
    // worth failing on rather than a document worth conjuring.
    tx.update(attemptRef, {
      status: 'submitted',
      submittedAt: new Date(now).toISOString(),
      // The RE-SIMULATED score. §8.4's histogram (WP-4b) reads this field, so
      // a claimed number must never reach it.
      score: result.score,
      engineStatus: result.status,
      moveCount: payload.moves.length,
      boardHash: result.boardHash,
      streakGranted: earnsStreak && after.streak !== before.streak,
      engineVersionAtSubmit: engineVersion(),
      movesHash,
      countsForPercentile,
    });
    tx.set(userRef, after, { merge: true });
    return { before, after, countsForPercentile };
  });

  logger.info('daily_submit: accepted', {
    uid,
    date: payload.date,
    score: result.score,
    status: result.status,
    moves: payload.moves.length,
    minMoves,
    streak: streakState.after.streak,
    streakGranted: streakState.after.streak !== streakState.before.streak,
  });

  return {
    date: payload.date,
    score: result.score,
    status: result.status,
    moves: payload.moves.length,
    streak: streakState.after.streak,
    streakGranted: streakState.after.streak !== streakState.before.streak,
    countsForPercentile: streakState.countsForPercentile,
  };
}

/** §8.5. Auth required — the attempt, the submission and the streak are all per-user. */
export const dailySubmit = onCall<unknown>(
  { secrets: [DAILY_BOARD_SALT], timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required');
    if (getApps().length === 0) initializeApp();
    return submitDailyAttempt(request.auth.uid, request.data, DAILY_BOARD_SALT.value(), Date.now());
  },
);
