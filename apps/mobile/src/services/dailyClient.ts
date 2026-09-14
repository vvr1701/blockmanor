import { doc, getDoc, getFirestore } from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { simulate, type GameConfig, type Move, type PieceId } from '@blockmanor/engine';
import {
  DAILY_BOARDS_COLLECTION,
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
  if (!isFirebaseConfigured()) return { kind: 'offline' };
  try {
    const call = httpsCallable<{ date: string; moves: Move[]; claimedScore: number }, SubmitResult>(
      getFunctions(),
      'dailySubmit',
    );
    const { data } = await call({
      date: run.date,
      moves: run.moves,
      claimedScore: claimedScoreFor(run),
    });
    clearPendingRun();
    storage.set(LAST_RESULT_KEY, JSON.stringify({ date: data.date, percentile: data.percentile }));
    track('daily_complete', {
      score: data.score,
      moves: data.moves,
      ...(data.percentile === null ? {} : { percentile: data.percentile }),
    });
    return { kind: 'accepted', result: data };
  } catch (error) {
    const reason = (error as { details?: { reason?: unknown } } | null)?.details?.reason;
    if (SUBMIT_REJECTIONS.includes(reason as SubmitRejection)) {
      if (!RETRYABLE.includes(reason as SubmitRejection)) clearPendingRun();
      return { kind: 'rejected', reason: reason as SubmitRejection };
    }
    recordError(error, 'daily_submit');
    return { kind: 'offline' };
  }
}

/** The last accepted submission — the gate's "yesterday's percentile" (§8.3)
 * and its "already played today" hint. Written by `submitPendingRun`. */
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
