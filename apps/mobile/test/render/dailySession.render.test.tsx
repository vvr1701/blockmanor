/**
 * `DailySession` — PRD §8.3 flow against the RNFB stand-in: gate →
 * play-start → `GameplayScreen` with a daily config → each placement
 * persisted → run end submits → `DailyResultScreen`, plus the "submitted on
 * next open" leftover run and the refusal/offline routes.
 */
import {
  getLegalPlacements,
  type GameEvent,
  type GameState,
  type PieceId,
} from '@blockmanor/engine';
import {
  DAILY_BOARDS_COLLECTION,
  REMOTE_CONFIG_DEFAULTS,
  engineVersion,
  type DailyBoardDoc,
} from '@blockmanor/shared';
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

import { RetryToast } from '../../src/components/RetryToast';
import { DailySession } from '../../src/game/DailySession';
import { DailyGateScreen } from '../../src/screens/DailyGateScreen';
import { DailyResultScreen } from '../../src/screens/DailyResultScreen';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { track } from '../../src/services/analytics';
import { clearPendingRun, readPendingRun, savePendingRun } from '../../src/services/dailyClient';
import { useMetaStore } from '../../src/state/useMetaStore';
import { firebaseMock, resetFirebaseMock } from '../mocks/react-native-firebase';

const trackMock = vi.mocked(track);
const DATE = '2026-08-09';
const NOW = Date.UTC(2026, 7, 9, 12);
const SEQUENCE: PieceId[] = ['P01', 'P02', 'P03', 'P01', 'P02', 'P03'];

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
    prefill: [],
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

const submitReturns = (percentile: number | null, streak = 4) => {
  firebaseMock.callables['dailySubmit'] = (data) => ({
    date: (data as { date: string }).date,
    score: 99,
    status: 'lost',
    moves: (data as { moves: unknown[] }).moves.length,
    streak,
    streakGranted: true,
    countsForPercentile: percentile !== null,
    percentile,
  });
};

const refuseStart = (reason: string) => {
  firebaseMock.callables['dailyPlayStart'] = () => {
    throw Object.assign(new Error(reason), {
      code: 'functions/failed-precondition',
      details: { reason },
    });
  };
};

async function mount(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<DailySession onExit={vi.fn()} onLevels={vi.fn()} now={() => NOW} />);
  });
  return r;
}

const gate = (r: ReactTestRenderer) => r.root.findByType(DailyGateScreen);
const texts = (node: ReactTestInstance): string =>
  node
    .findAllByType('RNText' as never)
    .map((n) => n.children.join(''))
    .join(' | ');

async function pressPlay(r: ReactTestRenderer): Promise<void> {
  await act(async () => {
    (gate(r).props as { onPlay: () => void }).onPlay();
  });
}

beforeEach(() => {
  trackMock.mockClear();
  resetFirebaseMock();
  firebaseMock.configured = true;
  firebaseMock.docs[`${DAILY_BOARDS_COLLECTION}/${DATE}`] = board();
  firebaseMock.callables['dailyPlayStart'] = () => ({
    date: DATE,
    sequence: SEQUENCE,
    startedAt: '2026-08-09T12:00:00.000Z',
  });
  clearPendingRun();
  act(() => {
    useMetaStore.setState({ streak: 3, bestDailyPercentile: 0, badges: { dailyUnplayed: true } });
  });
});

describe('DailySession (PRD §8.3)', () => {
  it('opens on the gate, fires daily_view, and plays a daily run with no restart', async () => {
    const r = await mount();
    expect(trackMock).toHaveBeenCalledWith('daily_view', {});
    expect(gate(r).props.status).toStrictEqual({ kind: 'ready' });

    await pressPlay(r);
    const screen = r.root.findByType(GameplayScreen);
    const state = screen.props.initialState as GameState;
    expect(state.config.mode).toBe('daily');
    expect(state.config.pieceSequence).toStrictEqual(SEQUENCE);
    // "One attempt means one": the pause sheet gets no restart.
    expect(screen.props.pause.onRestart).toBeUndefined();
  });

  it('persists each placement and submits when the run ends, then shows the result', async () => {
    submitReturns(7, 4);
    const r = await mount();
    await pressPlay(r);
    const screen = r.root.findByType(GameplayScreen);
    const state = screen.props.initialState as GameState;
    const [move] = getLegalPlacements(state, 0);
    const placed = {
      type: 'PIECE_PLACED',
      pieceIndex: move!.pieceIndex,
      r: move!.r,
      c: move!.c,
    } as GameEvent;
    const onEvent = screen.props.onEvent as (e: readonly GameEvent[], s: GameState) => void;

    act(() => onEvent([placed], state));
    expect(readPendingRun()?.moves).toStrictEqual([move]);

    await act(async () => onEvent([], { ...state, status: 'lost' }));
    const result = r.root.findByType(DailyResultScreen);
    expect(result.props).toMatchObject({ score: 99, percentile: 7, streak: 4 });
    expect(texts(result)).toContain('Top 7% worldwide');
    expect(readPendingRun()).toBeNull();
    const meta = useMetaStore.getState();
    expect(meta.streak).toBe(4);
    expect(meta.bestDailyPercentile).toBe(7);
    expect(meta.badges.dailyUnplayed).toBe(false);
  });

  it('shows Early bird when the server returns no percentile, and keeps the best untouched', async () => {
    submitReturns(null);
    const r = await mount();
    await pressPlay(r);
    const screen = r.root.findByType(GameplayScreen);
    const state = screen.props.initialState as GameState;
    await act(async () =>
      (screen.props.onEvent as (e: readonly GameEvent[], s: GameState) => void)([], {
        ...state,
        status: 'lost',
      }),
    );
    expect(texts(r.root.findByType(DailyResultScreen))).toContain('Early bird! 🌅');
    expect(useMetaStore.getState().bestDailyPercentile).toBe(0);
  });

  it("submits a leftover run for today on open and shows that run's result", async () => {
    submitReturns(12);
    savePendingRun({
      date: DATE,
      engineConfig: board().engineConfig,
      sequence: SEQUENCE,
      moves: [],
    });
    const r = await mount();
    expect(firebaseMock.calls.map((c) => c.name)).toStrictEqual(['dailySubmit']);
    expect(r.root.findByType(DailyResultScreen).props.percentile).toBe(12);
  });

  it('routes a consumed attempt to "played" and a not-live board to its message', async () => {
    refuseStart('attempt-consumed');
    const r = await mount();
    await pressPlay(r);
    expect(gate(r).props.status).toStrictEqual({ kind: 'played' });

    refuseStart('not-yet-live');
    await pressPlay(r);
    expect(gate(r).props.status).toStrictEqual({ kind: 'unavailable', reason: 'not-yet-live' });
  });

  it('offline play keeps the gate playable and offers a retry toast', async () => {
    firebaseMock.configured = false;
    const r = await mount();
    await pressPlay(r);
    expect(gate(r).props.status).toStrictEqual({ kind: 'ready' });
    expect(r.root.findAllByType(RetryToast)).toHaveLength(1);
  });
});
