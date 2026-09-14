import { beforeEach, describe, expect, it } from 'vitest';
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

beforeEach(() => {
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
