/**
 * §8.3's play-start callable — the only way a client ever gets the key to the
 * §8.2 sealed piece sequence.
 *
 * Two jobs, in this order, and the order is the feature:
 *  1. **Consume the attempt.** §8.3: "Abandoning mid-run (app kill) = attempt
 *     consumed. One attempt means one, or streak psychology dies." Consumption
 *     is a Firestore `create()` on `users/{uid}/submissions/{date}` — the same
 *     idempotency primitive §8.2's publication uses, chosen for the same reason:
 *     a read-then-write would let two concurrent calls both see "not started"
 *     and both hand out a key. `create()` cannot.
 *  2. **Hand over the key**, and only then. A crash between the two leaves the
 *     attempt spent and the player without a key, which is the correct side to
 *     fail on: the opposite order lets an app-kill-after-response mint a fresh
 *     attempt, and that is precisely what §8.3 forbids. It is also
 *     indistinguishable, server-side, from the app-kill §8.3 already rules on.
 *
 * What does NOT leave this process: `DAILY_BOARD_SALT`, the day seed, and the
 * attempt seed (§16 — "daily-board salt only in Functions config"). The client
 * gets one derived 32-byte key that opens exactly one day's sequence and says
 * nothing about any other day's, because `sequenceKey` is an HMAC of a
 * salt-derived seed (§8.2, PRD v1.14).
 *
 * Remote Config is not read here. The daily path plays from the frozen snapshot
 * only (§8.2 / PRD v1.7).
 */

import {
  DAILY_ATTEMPTS_SUBCOLLECTION,
  DAILY_BOARDS_COLLECTION,
  USERS_COLLECTION,
  parseDailyBoardDoc,
} from '@blockmanor/shared';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { DAILY_BOARD_SALT, isAlreadyExists } from './publish';
import { attemptSeed, dailySeed, sequenceKey } from './seal';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One UTC day. §8.1: exactly one board per UTC day, live for exactly that day. */
const DAY_MS = 86_400_000;

/**
 * What §8.3 needs to start playing, and nothing else. The board document itself
 * — tuning, prefill, `pieceCount`, the sealed sequence — the client already
 * reads directly under `firestore.rules`; duplicating it here would just be a
 * second copy to keep in sync and a bigger response to pay for.
 */
export interface PlayStartResult {
  date: string;
  /** Base64 of the raw 32-byte `sequenceKey` (§8.2). AES-256-GCM, per `alg`. */
  sequenceKey: string;
  /** Echoed so the client's countdown/attempt badge runs off server time. */
  startedAt: string;
}

/** Distinct `HttpsError.details.reason` values, so the client can route each. */
export type PlayStartRejection = 'not-published' | 'not-yet-live' | 'closed' | 'attempt-consumed';

const reject = (
  reason: PlayStartRejection,
  message: string,
  code: 'not-found' | 'failed-precondition' = 'failed-precondition',
): HttpsError => new HttpsError(code, message, { reason });

/**
 * The callable's body, with the clock and the salt injected so the emulator
 * suite can drive the §8.8 clock-skew cases directly. Same split as
 * `publishDailyBoard`.
 *
 * `now` is always SERVER time. The client never sends a timestamp — it sends a
 * date, and the two guards below are what make a skewed device clock inert
 * (§8.8, ±3h): a device running fast asks for tomorrow's board and is refused by
 * `not-yet-live`; one running slow asks for yesterday's and is refused by
 * `closed`. `firestore.rules` enforces the same `activatesAt` boundary on the
 * board document itself, so neither guard is the only one (§8.2 v1.12: "enforced
 * in three places, not one").
 */
export async function startDailyAttempt(
  uid: string,
  date: string,
  secretSalt: string,
  now: number,
): Promise<PlayStartResult> {
  if (!DATE_RE.test(date)) {
    throw new HttpsError('invalid-argument', 'date must be YYYY-MM-DD');
  }
  const db = getFirestore();
  const snap = await db.collection(DAILY_BOARDS_COLLECTION).doc(date).get();
  if (!snap.exists) throw reject('not-published', 'No board for that date', 'not-found');

  // A board document that does not parse is an ops problem, not a player one:
  // fail as `internal` so it lands in error reporting instead of looking like a
  // client mistake.
  let board;
  try {
    board = parseDailyBoardDoc(snap.data());
  } catch (error) {
    logger.error('daily_play_start: board document did not parse', { date, error });
    throw new HttpsError('internal', 'Board document is unreadable');
  }

  // §8.2 v1.12 publication boundary. The document exists from D-1 23:45 UTC;
  // it is not playable until D 00:00:00.000 UTC.
  if (now < board.activatesAt) throw reject('not-yet-live', 'That board is not live yet');
  // §8.1: one board per UTC day. Without this, a player who missed a day could
  // open yesterday's board today and collect yesterday's §8.6 streak credit,
  // because §8.5 credits the streak to the BOARD's UTC day (which is what makes
  // the legitimate play-at-23:59 / submit-at-00:01 case work).
  if (now >= board.activatesAt + DAY_MS) throw reject('closed', 'That board has closed');

  const attempt = db
    .collection(USERS_COLLECTION)
    .doc(uid)
    .collection(DAILY_ATTEMPTS_SUBCOLLECTION)
    .doc(date);
  try {
    await attempt.create({
      date,
      status: 'started',
      startedAt: new Date(now).toISOString(),
      // Which board was actually dealt. Pinned at start so §8.5 can tell a
      // submission against today's published board from one against a board
      // that was somehow re-rolled underneath the player.
      revision: board.revision,
      engineVersionAtStart: board.engineVersion,
    });
  } catch (error) {
    if (isAlreadyExists(error)) {
      // Not an error condition — this is §8.3 working. A relaunch after an app
      // kill lands here, and the client's next move is to SUBMIT its partial
      // log (§8.5), not to start again.
      logger.info('daily_play_start: attempt already consumed', { date, uid });
      throw reject('attempt-consumed', 'Your one attempt for this board is already spent');
    }
    throw error;
  }

  logger.info('daily_play_start: attempt opened', { date, uid, revision: board.revision });
  return {
    date,
    sequenceKey: sequenceKey(attemptSeed(dailySeed(secretSalt, date), board.revision)).toString(
      'base64',
    ),
    startedAt: new Date(now).toISOString(),
  };
}

/**
 * §8.3. Auth required: the attempt is per-user and §4.3's anonymous auth is the
 * floor, so there is no anonymous daily play.
 */
export const dailyPlayStart = onCall<{ date?: unknown }>(
  { secrets: [DAILY_BOARD_SALT] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required');
    const date = request.data?.date;
    if (typeof date !== 'string') throw new HttpsError('invalid-argument', 'date is required');

    if (getApps().length === 0) initializeApp();
    return startDailyAttempt(request.auth.uid, date, DAILY_BOARD_SALT.value(), Date.now());
  },
);
