import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  getFirestore,
  query,
  where,
} from '@react-native-firebase/firestore';
import { getAuth } from '@react-native-firebase/auth';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { simulate, type GameConfig, type Move, type PieceId } from '@blockmanor/engine';
import {
  DAILY_ATTEMPTS_SUBCOLLECTION,
  DAILY_BOARDS_COLLECTION,
  USERS_COLLECTION,
  dailyGameConfig,
  dailyPlaySeed,
  parseDailyBoardDoc,
  type DailyEngineConfig,
  type PlayStartRejection,
  type PlayStartResult,
  type SubmitRejection,
  type SubmitResult,
} from '@blockmanor/shared';
import { MMKV } from 'react-native-mmkv';
import { track } from './analytics';
import { isFirebaseConfigured, recordError } from './firebase';

/**
 * §8.3 Daily Board client service — the board read, the play-start callable,
 * and the in-progress move log that "is submitted on next open".
 *
 * Board first, attempt second: `firestore.rules` refuses `dailyBoards/{date}`
 * before `activatesAt`, and play-start CONSUMES the attempt before it answers.
 * Reading the board after play-start would let an unreadable board (offline,
 * corrupt) burn the player's one attempt on a run they can never render.
 */

type Tuning = Pick<DailyEngineConfig, 'tuning' | 'prefill'>;

export type DailyStartOutcome =
  | { kind: 'ready'; date: string; config: GameConfig; startedAt: string }
  | { kind: 'refused'; reason: PlayStartRejection; pendingDate?: string }
  | { kind: 'offline' };

/** A run's log, persisted after every placement so an app kill loses nothing. */
export interface PendingDailyRun {
  date: string;
  engineConfig: Tuning;
  sequence: PieceId[];
  moves: Move[];
}

const PENDING_KEY = 'daily.pendingRun';
const LAST_RESULT_KEY = 'daily.lastResult';
const storage = new MMKV({ id: 'blockmanor' });

const REJECTIONS: readonly PlayStartRejection[] = [
  'not-published',
  'not-yet-live',
  'closed',
  'attempt-consumed',
  'pending-attempt',
];

/** An RNFB `HttpsError`'s `details.reason`, if it is one play-start defines. */
function rejectionOf(error: unknown): { reason: PlayStartRejection; pendingDate?: string } | null {
  const details = (error as { details?: unknown } | null)?.details;
  if (typeof details !== 'object' || details === null) return null;
  const { reason, pendingDate } = details as { reason?: unknown; pendingDate?: unknown };
  if (!REJECTIONS.includes(reason as PlayStartRejection)) return null;
  return {
    reason: reason as PlayStartRejection,
    ...(typeof pendingDate === 'string' ? { pendingDate } : {}),
  };
}

export async function startDailyRun(date: string): Promise<DailyStartOutcome> {
  if (!isFirebaseConfigured()) return { kind: 'offline' };

  let engineConfig: Tuning;
  try {
    const snapshot = await getDoc(doc(getFirestore(), `${DAILY_BOARDS_COLLECTION}/${date}`));
    if (!snapshot.exists()) return { kind: 'refused', reason: 'not-published' };
    engineConfig = parseDailyBoardDoc(snapshot.data()).engineConfig;
  } catch (error) {
    // The rules' `activatesAt` gate surfaces as permission-denied.
    if ((error as { code?: unknown } | null)?.code === 'firestore/permission-denied') {
      return { kind: 'refused', reason: 'not-yet-live' };
    }
    recordError(error, 'daily_board_read');
    return { kind: 'offline' };
  }

  try {
    const call = httpsCallable<{ date: string }, PlayStartResult>(getFunctions(), 'dailyPlayStart');
    const { data } = await call({ date });
    savePendingRun({ date, engineConfig, sequence: data.sequence, moves: [] });
    track('daily_start', {});
    return {
      kind: 'ready',
      date,
      config: dailyGameConfig(engineConfig, data.sequence, date),
      startedAt: data.startedAt,
    };
  } catch (error) {
    const rejection = rejectionOf(error);
    if (rejection) return { kind: 'refused', ...rejection };
    recordError(error, 'daily_play_start');
    return { kind: 'offline' };
  }
}

export function savePendingRun(run: PendingDailyRun): void {
  storage.set(PENDING_KEY, JSON.stringify(run));
}

/** Append one placement to the persisted log (§8.3 app-kill safety). */
export function recordDailyMove(move: Move): void {
  const run = readPendingRun();
  if (!run) return;
  savePendingRun({
    ...run,
    moves: [...run.moves, { pieceIndex: move.pieceIndex, r: move.r, c: move.c }],
  });
}

export function readPendingRun(): PendingDailyRun | null {
  const raw = storage.getString(PENDING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingDailyRun;
  } catch {
    return null;
  }
}

export function clearPendingRun(): void {
  storage.delete(PENDING_KEY);
}

/**
 * §8.5 `claimedScore` for a persisted run: replayed through the SAME shared
 * builder and seed the server re-simulates with. A run resubmitted after an
 * app kill has no live game state to read a score from, and a claim that
 * disagrees with the replay is rejected as `score-mismatch`.
 */
export function claimedScoreFor(run: PendingDailyRun): number {
  const config = dailyGameConfig(run.engineConfig, run.sequence, run.date);
  return simulate(config, dailyPlaySeed(run.date), run.moves).score;
}

export type DailySubmitOutcome =
  | { kind: 'none' }
  | { kind: 'accepted'; result: SubmitResult }
  | { kind: 'rejected'; reason: SubmitRejection }
  | { kind: 'offline' };

const SUBMIT_REJECTIONS: readonly SubmitRejection[] = [
  'not-published',
  'board-unreadable',
  'not-yet-live',
  'stale-date',
  'too-many-moves',
  'not-started',
  'already-submitted',
  'illegal-move',
  'score-mismatch',
];

/** Retrying can still land: the board is not readable or live yet. Every other
 * rejection is final for this log, so the run is dropped rather than resent. */
const RETRYABLE: readonly SubmitRejection[] = ['not-published', 'board-unreadable', 'not-yet-live'];

/**
 * §8.3 "submitted on next open" and the normal end of a run: send the
 * persisted log. Kept until the server has answered for good, so an offline
 * end or an app kill resubmits later (§0 v1.26(a) blocks the next day until
 * it does).
 */
export async function submitPendingRun(): Promise<DailySubmitOutcome> {
  const run = readPendingRun();
  if (!run) return { kind: 'none' };
  let claimedScore: number;
  try {
    claimedScore = claimedScoreFor(run);
  } catch (error) {
    // A log that cannot even replay locally can never land; left in place it
    // would be kept forever and block the next day (§0 v1.26(a)). Consume the
    // attempt with the always-valid empty log instead.
    recordError(error, 'daily_replay');
    return sendSubmission(run.date, [], 0);
  }
  return sendSubmission(run.date, run.moves, claimedScore);
}

/**
 * §8.6 / §0 v1.26(a): play-start refused with `pending-attempt` for
 * `pendingDate`. Submits the stored log when it is that day's; otherwise —
 * play-start's response was lost, the app died before the run was saved, or
 * the saved run is unreadable — the empty log, which §8.6 names as valid and
 * which always replays to 0, so it needs neither the board nor the sequence.
 */
export async function resolvePendingAttempt(pendingDate: string): Promise<DailySubmitOutcome> {
  if (readPendingRun()?.date === pendingDate) return submitPendingRun();
  return sendSubmission(pendingDate, [], 0);
}

async function sendSubmission(
  date: string,
  moves: Move[],
  claimedScore: number,
): Promise<DailySubmitOutcome> {
  if (!isFirebaseConfigured()) return { kind: 'offline' };
  try {
    const call = httpsCallable<{ date: string; moves: Move[]; claimedScore: number }, SubmitResult>(
      getFunctions(),
      'dailySubmit',
    );
    const { data } = await call({ date, moves, claimedScore });
    return accept(data);
  } catch (error) {
    const reason = (error as { details?: { reason?: unknown } } | null)?.details?.reason;
    if (SUBMIT_REJECTIONS.includes(reason as SubmitRejection)) {
      if (readPendingRun()?.date === date && !RETRYABLE.includes(reason as SubmitRejection)) {
        clearPendingRun();
      }
      if (reason === 'already-submitted') {
        // A retry of a submission the server already accepted (its response
        // was lost): the result exists server-side, so recover it rather than
        // losing the player's score, rank and `daily_complete`.
        const stored = await readStoredResult(date);
        if (stored) return accept(stored);
      }
      return { kind: 'rejected', reason: reason as SubmitRejection };
    }
    recordError(error, 'daily_submit');
    return { kind: 'offline' };
  }
}

function accept(data: SubmitResult): DailySubmitOutcome {
  if (readPendingRun()?.date === data.date) clearPendingRun();
  storage.set(LAST_RESULT_KEY, JSON.stringify({ date: data.date, percentile: data.percentile }));
  track('daily_complete', {
    score: data.score,
    moves: data.moves,
    ...(data.percentile === null ? {} : { percentile: data.percentile }),
  });
  return { kind: 'accepted', result: data };
}

/** The accepted submission as the server stored it (owner-readable under the rules). */
async function readStoredResult(date: string): Promise<SubmitResult | null> {
  const uid = getAuth().currentUser?.uid;
  if (!uid) return null;
  try {
    const db = getFirestore();
    const attempt = await getDoc(
      doc(db, `${USERS_COLLECTION}/${uid}/${DAILY_ATTEMPTS_SUBCOLLECTION}/${date}`),
    );
    const user = await getDoc(doc(db, `${USERS_COLLECTION}/${uid}`));
    const a = (attempt.exists() ? attempt.data() : null) as Record<string, unknown> | null;
    const u = (user.exists() ? user.data() : null) as Record<string, unknown> | null;
    if (!a || a['status'] !== 'submitted' || typeof a['score'] !== 'number') return null;
    return {
      date,
      score: a['score'],
      status: a['engineStatus'] as SubmitResult['status'],
      moves: typeof a['moveCount'] === 'number' ? a['moveCount'] : 0,
      streak: typeof u?.['streak'] === 'number' ? u['streak'] : 0,
      streakGranted: a['streakGranted'] === true,
      countsForPercentile: a['countsForPercentile'] === true,
      percentile: typeof a['percentile'] === 'number' ? a['percentile'] : null,
    };
  } catch (error) {
    recordError(error, 'daily_result_recover');
    return null;
  }
}

/** The last accepted submission — the gate's "yesterday's percentile" (§8.3)
 * and its "already played today" hint. Written by every accepted outcome. */
export interface LastDailyResult {
  date: string;
  percentile: number | null;
}

export function readLastResult(): LastDailyResult | null {
  const raw = storage.getString(LAST_RESULT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastDailyResult;
  } catch {
    return null;
  }
}

/**
 * §8.6 calendar month view: the UTC days in `month` (YYYY-MM) this player has
 * a SUBMITTED attempt for, read from the server rather than a local list so a
 * reinstall or a second device shows the same month. `null` = unknown
 * (offline, not signed in), which the screen renders as loading, never as
 * "nothing played".
 */
export async function readPlayedDates(month: string): Promise<Set<string> | null> {
  if (!isFirebaseConfigured()) return null;
  const uid = getAuth().currentUser?.uid;
  if (!uid) return null;
  try {
    const snapshot = await getDocs(
      query(
        collection(getFirestore(), `${USERS_COLLECTION}/${uid}/${DAILY_ATTEMPTS_SUBCOLLECTION}`),
        where(documentId(), '>=', `${month}-01`),
        where(documentId(), '<=', `${month}-31`),
      ),
    );
    return new Set(
      snapshot.docs.filter((d) => d.data()['status'] === 'submitted').map((d) => d.id),
    );
  } catch (error) {
    recordError(error, 'daily_calendar');
    return null;
  }
}
