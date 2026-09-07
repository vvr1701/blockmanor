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
  USERS_COLLECTION,
  dailyGameConfig,
  dailyPlaySeed,
  dailySubmissionSchema,
  engineVersion,
  parseDailyBoardDoc,
  type DailyBoardDoc,
  type DailySubmission,
} from '@blockmanor/shared';
import { IllegalMoveError, simulate, type FinalResult } from '@blockmanor/engine';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { DAILY_BOARD_SALT, raiseOpsAlert } from './publish';
import { attemptSeed, dailySeed, openSequence } from './seal';
import { nextStreak, streakMinMoves, type StreakState } from './streak';

/**
 * §8.5: "submission for a past date >36h old" is rejected. Measured from the
 * board's `activatesAt`, i.e. from the start of its own UTC day, which leaves a
 * player who died at 23:59 twelve hours to get back online and submit — the
 * §8.3 app-kill path the window exists for.
 */
const STALE_AFTER_MS = 36 * 3_600_000;

/** Distinct `HttpsError.details.reason` values — §8.5 rejects each separately. */
export type SubmitRejection =
  | 'not-published'
  | 'board-unreadable'
  | 'not-yet-live'
  | 'stale-date'
  | 'too-many-moves'
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
}

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
  alerted.add(board.date);
  await raiseOpsAlert(ENGINE_DRIFT_ALERT, board.date, {
    boardEngineVersion: board.engineVersion,
    liveEngineVersion: live,
  });
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

  // Cheap pre-check so a duplicate costs one read instead of a re-simulation.
  // NOT the guard — the guard is re-run inside the transaction below, which is
  // what actually closes the two-submissions-at-once race.
  if ((await attemptRef.get()).get('status') === 'submitted') {
    logger.info('daily_submit: duplicate submission', { uid, date: payload.date });
    throw reject('already-submitted', 'You have already submitted for this board');
  }

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
  const streakState = await db.runTransaction(async (tx) => {
    // Re-read inside the transaction: two submissions racing both pass the
    // pre-check above, and only one may be recorded (§8.5 ">1 submission/user/
    // day"). Firestore aborts and retries the loser, which then sees
    // `'submitted'`.
    const attempt = await tx.get(attemptRef);
    if (attempt.get('status') === 'submitted') {
      throw reject('already-submitted', 'You have already submitted for this board');
    }
    const user = await tx.get(userRef);
    const streak = typeof user.get('streak') === 'number' ? (user.get('streak') as number) : 0;
    const last: unknown = user.get('lastStreakDate');
    // Built by cases rather than with an `undefined` field: Firestore rejects
    // `undefined` values outright, so the key is either a string or absent.
    const before: StreakState =
      typeof last === 'string' ? { streak, lastStreakDate: last } : { streak };
    const after = earnsStreak ? nextStreak(before, payload.date) : before;

    tx.set(
      attemptRef,
      {
        date: payload.date,
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
      },
      // Merge, so a submission whose §8.3 start doc is missing still records.
      // The real gate on playing at all is the sequence key, not this document:
      // without the key there is no legal move log to submit.
      { merge: true },
    );
    tx.set(userRef, after, { merge: true });
    return { before, after };
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
