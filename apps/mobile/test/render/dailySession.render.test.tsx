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
import { StreakScreen } from '../../src/screens/StreakScreen';
import { StreakMilestoneSheet } from '../../src/game/StreakMilestoneSheet';
import { track } from '../../src/services/analytics';
import { clearPendingRun, readPendingRun, savePendingRun } from '../../src/services/dailyClient';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useMetaStore } from '../../src/state/useMetaStore';
import { resetShareMock, shareMock } from '../mocks/react-native-share';
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
  resetShareMock();
  act(() => {
    useConfigStore.setState({ snapshot: { ...REMOTE_CONFIG_DEFAULTS }, fetchedAt: null });
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
    // §0 v1.30: quitting the one attempt always asks first.
    expect(screen.props.pause.confirmQuit).toBe('daily');
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

  it('clears a pending older day with its empty log, then starts today (§0 v1.26(a))', async () => {
    submitReturns(null);
    let starts = 0;
    firebaseMock.callables['dailyPlayStart'] = () => {
      starts += 1;
      if (starts === 1) {
        throw Object.assign(new Error('pending'), {
          code: 'functions/failed-precondition',
          details: { reason: 'pending-attempt', pendingDate: '2026-08-08' },
        });
      }
      return { date: DATE, sequence: SEQUENCE, startedAt: '2026-08-09T12:00:00.000Z' };
    };
    const r = await mount();
    await pressPlay(r);
    const submits = firebaseMock.calls.filter((c) => c.name === 'dailySubmit');
    expect(submits).toStrictEqual([
      { name: 'dailySubmit', data: { date: '2026-08-08', moves: [], claimedScore: 0 } },
    ]);
    expect(r.root.findByType(GameplayScreen).props.initialState.config.mode).toBe('daily');
  });

  it('offline play keeps the gate playable and offers a retry toast', async () => {
    firebaseMock.configured = false;
    const r = await mount();
    await pressPlay(r);
    expect(gate(r).props.status).toStrictEqual({ kind: 'ready' });
    expect(r.root.findAllByType(RetryToast)).toHaveLength(1);
  });

  const endRun = async (r: ReturnType<typeof TestRenderer.create>) => {
    const screen = r.root.findByType(GameplayScreen);
    const state = screen.props.initialState as GameState;
    await act(async () =>
      (screen.props.onEvent as (e: readonly GameEvent[], s: GameState) => void)([], {
        ...state,
        status: 'lost',
      }),
    );
  };

  it('§8.6: day 7 fires streak_milestone and shows the celebration over the result', async () => {
    act(() => {
      useMetaStore.setState({ streak: 6 });
    });
    submitReturns(20, 7);
    const r = await mount();
    await pressPlay(r);
    await endRun(r);
    expect(trackMock).toHaveBeenCalledWith('streak_milestone', { n: 7 });
    expect(r.root.findByType(StreakMilestoneSheet).props.streak).toBe(7);
    act(() => {
      (r.root.findByType(StreakMilestoneSheet).props.onContinue as () => void)();
    });
    expect(r.root.findAllByType(StreakMilestoneSheet)).toHaveLength(0);
    expect(r.root.findAllByType(DailyResultScreen)).toHaveLength(1);
  });

  it('§8.6: a gap reset fires streak_broken with the lost streak, and no celebration', async () => {
    act(() => {
      useMetaStore.setState({ streak: 12 });
    });
    submitReturns(20, 1);
    const r = await mount();
    await pressPlay(r);
    await endRun(r);
    expect(trackMock).toHaveBeenCalledWith('streak_broken', { n: 12 });
    expect(r.root.findAllByType(StreakMilestoneSheet)).toHaveLength(0);
  });

  it("§8.6: the gate's streak stat opens the calendar with the server's played days", async () => {
    firebaseMock.currentUser = { uid: 'u1' };
    firebaseMock.docs['users/u1/submissions/2026-08-03'] = { status: 'submitted' };
    firebaseMock.docs['users/u1/submissions/2026-08-08'] = { status: 'submitted' };
    const r = await mount();
    await act(async () => (gate(r).props.onOpenStreak as () => void)());
    const calendar = r.root.findByType(StreakScreen);
    expect(calendar.props.month).toBe('2026-08');
    expect(calendar.props.playedDates).toStrictEqual(new Set(['2026-08-03', '2026-08-08']));
    act(() => {
      (calendar.props.onBack as () => void)();
    });
    expect(r.root.findAllByType(DailyGateScreen)).toHaveLength(1);
  });

  it('§8.7: the result shares to WhatsApp with the score, rank, streak and install link', async () => {
    submitReturns(11, 4);
    const r = await mount();
    await pressPlay(r);
    await endRun(r);
    const result = r.root.findByType(DailyResultScreen);
    await act(async () => (result.props.onShare as (c: string) => void)('whatsapp'));
    expect(shareMock.calls).toHaveLength(1);
    expect(shareMock.calls[0]).toMatchObject({
      method: 'shareSingle',
      options: { social: 'whatsapp' },
    });
    expect(shareMock.calls[0]?.options['message']).toBe(
      `99 · Top 11% · 🔥4 · Block Manor\n${REMOTE_CONFIG_DEFAULTS.share_install_url}`,
    );
  });

  it('§8.7: flag_share_card off hides sharing entirely', async () => {
    act(() => {
      useConfigStore.setState({
        snapshot: {
          ...REMOTE_CONFIG_DEFAULTS,
          flag_share_card: false,
        } as unknown as typeof REMOTE_CONFIG_DEFAULTS,
        fetchedAt: null,
      });
    });
    submitReturns(11, 4);
    const r = await mount();
    await pressPlay(r);
    await endRun(r);
    expect(r.root.findByType(DailyResultScreen).props.onShare).toBeUndefined();
  });
});
