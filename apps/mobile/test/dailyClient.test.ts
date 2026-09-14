import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/analytics', () => ({ track: vi.fn() }));

import { track } from '../src/services/analytics';
import {
  DAILY_BOARDS_COLLECTION,
  REMOTE_CONFIG_DEFAULTS,
  dailyGameConfig,
  dailyPlaySeed,
  engineVersion,
  type DailyBoardDoc,
} from '@blockmanor/shared';
import {
  applyPlacement,
  createGame,
  getLegalPlacements,
  type Move,
  type PieceId,
} from '@blockmanor/engine';
import {
  claimedScoreFor,
  clearPendingRun,
  readPendingRun,
  recordDailyMove,
  startDailyRun,
  resolvePendingAttempt,
  savePendingRun,
  submitPendingRun,
} from '../src/services/dailyClient';
import { firebaseMock, resetFirebaseMock } from './mocks/react-native-firebase';

/**
 * §8.3 client service against the RNFB stand-in. The ordering claim is the
 * one worth pinning: the board is read BEFORE play-start, because play-start
 * consumes the attempt and an unreadable board must not burn it.
 */

const DATE = '2026-08-09';
const SEQUENCE: PieceId[] = ['P01', 'P02', 'P03'];

/** Same minimal document `packages/shared/test/dailyBoard.test.ts` uses. */
const board = (): DailyBoardDoc => ({
  date: DATE,
  generatorVersion: 1,
  revision: '',
  engineVersion: engineVersion(),
  engineConfig: {
    tuning: {
      mercy_threshold: REMOTE_CONFIG_DEFAULTS.mercy_threshold,
      mercy_small_prob: REMOTE_CONFIG_DEFAULTS.mercy_small_prob,
      score_clear_base: REMOTE_CONFIG_DEFAULTS.score_clear_base,
      combo_step: REMOTE_CONFIG_DEFAULTS.combo_step,
      perfect_clear_bonus: REMOTE_CONFIG_DEFAULTS.perfect_clear_bonus,
    },
    prefill: [{ r: 0, c: 0, color: 1 }],
    pieceCount: 60,
    pieceSequence: { alg: 'AES-256-GCM', iv: 'aXY=', ct: 'Y3Q=', tag: 'dGFn' },
  },
  configSource: {
    mercy_threshold: 'live',
    mercy_small_prob: 'live',
    score_clear_base: 'live',
    combo_step: 'live',
    perfect_clear_bonus: 'live',
    daily_piece_count: 'live',
  },
  solvability: { trials: 200, medianMoves: 31, minMoves: 15, passed: true },
  generatedAt: '2026-08-08T23:45:00.000Z',
  activatesAt: Date.UTC(2026, 7, 9),
});

const publish = () => {
  firebaseMock.docs[`${DAILY_BOARDS_COLLECTION}/${DATE}`] = board();
};
const playStartReturns = () => {
  firebaseMock.callables['dailyPlayStart'] = () => ({
    date: DATE,
    sequence: SEQUENCE,
    startedAt: '2026-08-09T12:00:00.000Z',
  });
};
const playStartRejects = (details: Record<string, string>) => {
  firebaseMock.callables['dailyPlayStart'] = () => {
    throw Object.assign(new Error('failed-precondition'), {
      code: 'functions/failed-precondition',
      details,
    });
  };
};

const trackMock = vi.mocked(track);

beforeEach(() => {
  trackMock.mockClear();
  resetFirebaseMock();
  firebaseMock.configured = true;
  clearPendingRun();
});

describe('§8.3 startDailyRun', () => {
  it('is offline without a Firebase project and calls nothing', async () => {
    firebaseMock.configured = false;
    await expect(startDailyRun(DATE)).resolves.toStrictEqual({ kind: 'offline' });
    expect(firebaseMock.calls).toHaveLength(0);
  });

  it('builds the daily config from the board and the opened sequence, and persists the run', async () => {
    publish();
    playStartReturns();
    const outcome = await startDailyRun(DATE);
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') return;
    expect(outcome.config.mode).toBe('daily');
    expect(outcome.config.pieceSequence).toStrictEqual(SEQUENCE);
    expect(outcome.config.level?.prefill).toStrictEqual([{ r: 0, c: 0, type: 'filled', color: 1 }]);
    expect(firebaseMock.calls).toStrictEqual([{ name: 'dailyPlayStart', data: { date: DATE } }]);
    expect(readPendingRun()).toMatchObject({ date: DATE, sequence: SEQUENCE, moves: [] });
    expect(trackMock).toHaveBeenCalledWith('daily_start', {});
  });

  it('never consumes the attempt when the board cannot be read', async () => {
    playStartReturns();
    // Not yet live: the rules refuse the read.
    firebaseMock.docError = { code: 'firestore/permission-denied' };
    await expect(startDailyRun(DATE)).resolves.toStrictEqual({
      kind: 'refused',
      reason: 'not-yet-live',
    });
    // Unreadable for any other reason.
    firebaseMock.docError = { code: 'firestore/unavailable' };
    await expect(startDailyRun(DATE)).resolves.toStrictEqual({ kind: 'offline' });
    // Not published.
    firebaseMock.docError = null;
    await expect(startDailyRun(DATE)).resolves.toStrictEqual({
      kind: 'refused',
      reason: 'not-published',
    });
    expect(firebaseMock.calls).toHaveLength(0);
    expect(readPendingRun()).toBeNull();
  });

  it('routes play-start rejections, including the pending date to submit first', async () => {
    publish();
    playStartRejects({ reason: 'pending-attempt', pendingDate: '2026-08-08' });
    await expect(startDailyRun(DATE)).resolves.toStrictEqual({
      kind: 'refused',
      reason: 'pending-attempt',
      pendingDate: '2026-08-08',
    });
    playStartRejects({ reason: 'attempt-consumed' });
    await expect(startDailyRun(DATE)).resolves.toStrictEqual({
      kind: 'refused',
      reason: 'attempt-consumed',
    });
    // An unknown reason is a fault, not a routing decision.
    playStartRejects({ reason: 'something-new' });
    await expect(startDailyRun(DATE)).resolves.toStrictEqual({ kind: 'offline' });
    expect(readPendingRun()).toBeNull();
  });
});

describe('§8.3 pending run log', () => {
  it('appends each placement so an app kill loses nothing', async () => {
    publish();
    playStartReturns();
    await startDailyRun(DATE);
    recordDailyMove({ pieceIndex: 0, r: 2, c: 3 });
    recordDailyMove({ pieceIndex: 2, r: 5, c: 1 });
    expect(readPendingRun()?.moves).toStrictEqual([
      { pieceIndex: 0, r: 2, c: 3 },
      { pieceIndex: 2, r: 5, c: 1 },
    ]);
  });

  it('ignores a placement with no run in progress', () => {
    recordDailyMove({ pieceIndex: 0, r: 0, c: 0 });
    expect(readPendingRun()).toBeNull();
  });
});

describe('§8.5 claimedScoreFor', () => {
  it('replays a persisted run to the score the live game reached', () => {
    const engineConfig = board().engineConfig;
    let state = createGame(dailyGameConfig(engineConfig, SEQUENCE, DATE), dailyPlaySeed(DATE));
    const moves: Move[] = [];
    for (let i = 0; i < 3; i++) {
      const [move] = getLegalPlacements(state, i);
      if (!move) break;
      moves.push(move);
      state = applyPlacement(state, move).state;
    }
    expect(moves.length).toBeGreaterThan(0);
    expect(state.score).toBeGreaterThan(0);
    expect(claimedScoreFor({ date: DATE, engineConfig, sequence: SEQUENCE, moves })).toBe(
      state.score,
    );
    expect(claimedScoreFor({ date: DATE, engineConfig, sequence: SEQUENCE, moves: [] })).toBe(0);
  });
});

describe('§8.3 submitPendingRun', () => {
  const accepted = (percentile: number | null) => {
    firebaseMock.callables['dailySubmit'] = () => ({
      date: DATE,
      score: 42,
      status: 'lost',
      moves: 2,
      streak: 3,
      streakGranted: true,
      countsForPercentile: percentile !== null,
      percentile,
    });
  };
  const rejected = (reason: string) => {
    firebaseMock.callables['dailySubmit'] = () => {
      throw Object.assign(new Error('failed-precondition'), {
        code: 'functions/failed-precondition',
        details: { reason },
      });
    };
  };
  const started = async () => {
    publish();
    playStartReturns();
    await startDailyRun(DATE);
    recordDailyMove({ pieceIndex: 0, r: 2, c: 3 });
  };

  it('does nothing without a pending run', async () => {
    await expect(submitPendingRun()).resolves.toStrictEqual({ kind: 'none' });
    expect(firebaseMock.calls).toHaveLength(0);
  });

  it('sends the log with its replayed score, clears it, and fires daily_complete', async () => {
    await started();
    accepted(12);
    const run = readPendingRun()!;
    await expect(submitPendingRun()).resolves.toMatchObject({ kind: 'accepted' });
    expect(firebaseMock.calls.at(-1)).toStrictEqual({
      name: 'dailySubmit',
      data: { date: DATE, moves: run.moves, claimedScore: claimedScoreFor(run) },
    });
    expect(readPendingRun()).toBeNull();
    expect(trackMock).toHaveBeenCalledWith('daily_complete', {
      score: 42,
      moves: 2,
      percentile: 12,
    });
  });

  it('omits percentile from daily_complete when there is none (§0 v1.29(b))', async () => {
    await started();
    accepted(null);
    await submitPendingRun();
    expect(trackMock).toHaveBeenCalledWith('daily_complete', { score: 42, moves: 2 });
  });

  it('keeps the run when offline or retryable, drops it when the rejection is final', async () => {
    await started();
    firebaseMock.callables['dailySubmit'] = () => {
      throw Object.assign(new Error('unavailable'), { code: 'functions/unavailable' });
    };
    await expect(submitPendingRun()).resolves.toStrictEqual({ kind: 'offline' });
    expect(readPendingRun()).not.toBeNull();

    rejected('board-unreadable');
    await expect(submitPendingRun()).resolves.toStrictEqual({
      kind: 'rejected',
      reason: 'board-unreadable',
    });
    expect(readPendingRun()).not.toBeNull();

    rejected('already-submitted');
    await expect(submitPendingRun()).resolves.toStrictEqual({
      kind: 'rejected',
      reason: 'already-submitted',
    });
    expect(readPendingRun()).toBeNull();
    expect(trackMock.mock.calls.filter(([name]) => name === 'daily_complete')).toHaveLength(0);
  });
});

describe('§8.3 audit fixes: pending attempts, lost accepts, final rejections', () => {
  const rejectWith = (reason: string) => {
    firebaseMock.callables['dailySubmit'] = () => {
      throw Object.assign(new Error('failed-precondition'), {
        code: 'functions/failed-precondition',
        details: { reason },
      });
    };
  };
  const acceptAnything = () => {
    firebaseMock.callables['dailySubmit'] = (data) => ({
      date: (data as { date: string }).date,
      score: 0,
      status: 'lost',
      moves: 0,
      streak: 1,
      streakGranted: false,
      countsForPercentile: true,
      percentile: null,
    });
  };
  const run = (date = DATE) => ({
    date,
    engineConfig: board().engineConfig,
    sequence: SEQUENCE,
    moves: [] as { pieceIndex: number; r: number; c: number }[],
  });

  it('clears a pending day with the empty log when no local run is that day (§8.6)', async () => {
    acceptAnything();
    savePendingRun(run(DATE));
    await expect(resolvePendingAttempt('2026-08-08')).resolves.toMatchObject({ kind: 'accepted' });
    expect(firebaseMock.calls.at(-1)).toStrictEqual({
      name: 'dailySubmit',
      data: { date: '2026-08-08', moves: [], claimedScore: 0 },
    });
    // Today's own run is untouched.
    expect(readPendingRun()?.date).toBe(DATE);
  });

  it("submits the stored log when it IS the pending day's", async () => {
    acceptAnything();
    // A REAL log: with `moves: []` the stored log and the empty fallback would
    // send the very same call, and replacing a real run would go unnoticed.
    const engineConfig = board().engineConfig;
    const state = createGame(dailyGameConfig(engineConfig, SEQUENCE, DATE), dailyPlaySeed(DATE));
    const [move] = getLegalPlacements(state, 0);
    const stored = { date: DATE, engineConfig, sequence: SEQUENCE, moves: [move!] };
    const claimedScore = claimedScoreFor(stored);
    expect(claimedScore).toBeGreaterThan(0);
    savePendingRun(stored);

    await resolvePendingAttempt(DATE);
    expect(firebaseMock.calls.at(-1)).toStrictEqual({
      name: 'dailySubmit',
      data: { date: DATE, moves: [move], claimedScore },
    });
    expect(readPendingRun()).toBeNull();
  });

  it('a log that cannot replay is replaced by the empty log, never kept forever', async () => {
    acceptAnything();
    savePendingRun({ ...run(DATE), moves: [{ pieceIndex: 9, r: 0, c: 0 }] });
    await expect(submitPendingRun()).resolves.toMatchObject({ kind: 'accepted' });
    expect(firebaseMock.calls.at(-1)?.data).toStrictEqual({
      date: DATE,
      moves: [],
      claimedScore: 0,
    });
    expect(readPendingRun()).toBeNull();
  });

  it('recovers an already-accepted submission instead of losing its result', async () => {
    firebaseMock.currentUser = { uid: 'u1' };
    firebaseMock.docs[`users/u1/submissions/${DATE}`] = {
      status: 'submitted',
      score: 55,
      engineStatus: 'lost',
      moveCount: 3,
      streakGranted: true,
      countsForPercentile: true,
      percentile: 9,
    };
    firebaseMock.docs['users/u1'] = { streak: 6 };
    savePendingRun(run(DATE));
    rejectWith('already-submitted');
    await expect(submitPendingRun()).resolves.toStrictEqual({
      kind: 'accepted',
      result: {
        date: DATE,
        score: 55,
        status: 'lost',
        moves: 3,
        streak: 6,
        streakGranted: true,
        countsForPercentile: true,
        percentile: 9,
      },
    });
    expect(trackMock).toHaveBeenCalledWith('daily_complete', {
      score: 55,
      moves: 3,
      percentile: 9,
    });
    expect(readPendingRun()).toBeNull();
  });

  it.each([
    ['not-published', true],
    ['board-unreadable', true],
    ['not-yet-live', true],
    ['stale-date', false],
    ['too-many-moves', false],
    ['not-started', false],
    ['already-submitted', false],
    ['illegal-move', false],
    ['score-mismatch', false],
  ])('rejection %s keeps the run: %s', async (reason, kept) => {
    savePendingRun(run(DATE));
    rejectWith(reason);
    await expect(submitPendingRun()).resolves.toStrictEqual({ kind: 'rejected', reason });
    expect(readPendingRun() !== null).toBe(kept);
  });
});
