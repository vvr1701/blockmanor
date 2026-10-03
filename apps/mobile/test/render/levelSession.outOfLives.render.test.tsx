/**
 * `LevelSession` §9.2 out-of-lives gate wiring (§0 v1.47). `canStartLevel`'s
 * own rules are proven in `test/lives.test.ts`; this file proves
 * `LevelSession`'s WIRING around them — the single choke point (§0
 * v1.47(b)), the refill button's real `spendCoins` path (not mocked, same
 * split `levelSession.continue.render.test.tsx` uses for §9.4's own spend),
 * and the auto-unblock-on-regen path.
 *
 * Real shipped content (`getLevel`) is used rather than a hand-crafted
 * fixture: every test here stops at the gate itself, never drives a
 * placement, so there is nothing level-shape-specific to control for.
 */
import { FIRST_POST_FTUE_LEVEL } from '@blockmanor/content';
import { REMOTE_CONFIG_DEFAULTS, type WalletResult } from '@blockmanor/shared';
import { BackHandler } from 'react-native';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryToast } from '../../src/components/RetryToast';
import { FAIL_HOLD_MS, WIN_HOLD_MS } from '../../src/game/juice';
import { FailScreen } from '../../src/screens/FailScreen';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { OutOfCoinsSheet } from '../../src/screens/OutOfCoinsSheet';
import { OutOfLivesSheet } from '../../src/screens/OutOfLivesSheet';
import { WinScreen } from '../../src/screens/WinScreen';
import { resetConnectivity } from '../../src/services/connectivity';
import { resetTrustedClock } from '../../src/services/trustedClock';
import { resetMockUptime, setMockUptime } from '../mocks/device-uptime';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useLivesStore } from '../../src/state/useLivesStore';
import { useMetaStore } from '../../src/state/useMetaStore';
import { useWalletStore } from '../../src/state/useWalletStore';
import { firebaseMock, resetFirebaseMock } from '../mocks/react-native-firebase';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));
// §9.1 level-win coins: irrelevant here (no test reaches a win) — stubbed
// only so a stray import never throws.
vi.mock('../../src/services/wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/wallet')>();
  return { ...actual, grantCoins: vi.fn() };
});

import { LevelSession } from '../../src/game/LevelSession';
import { track } from '../../src/services/analytics';

const trackMock = vi.mocked(track);
const D = REMOTE_CONFIG_DEFAULTS;
const LEVEL_ID = FIRST_POST_FTUE_LEVEL;
const activeRenderers: ReactTestRenderer[] = [];

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  activeRenderers.push(renderer);
  return renderer;
}

const served = (coins: number, applied = true): WalletResult => ({
  coins,
  rev: 1,
  amount: D.life_refill_price,
  applied,
});
const rejection = (reason: string) =>
  Object.assign(new Error(reason), { code: 'functions/failed-precondition', details: { reason } });
const unavailable = () => Object.assign(new Error('x'), { code: 'functions/unavailable' });

let clockNow: number;
let uptimeNow: number;
let dateSpy: ReturnType<typeof vi.spyOn>;

/** Advances BOTH the wall clock and (by the same amount) the mocked device
 * uptime — an honest wait, never the clock-jump shape §9.2's own exploit
 * tests cover (those live in `lives.test.ts`/`trustedClock.test.ts`). */
function advance(ms: number): void {
  clockNow += ms;
  uptimeNow += ms;
  setMockUptime(uptimeNow);
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function blockedLives() {
  useLivesStore.setState({
    missing: D.lives_max,
    regenFrom: clockNow,
    chargedRun: null,
    pendingRefill: null,
    adLives: { day: '', count: 0 },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clockNow = Date.UTC(2026, 8, 29, 12);
  uptimeNow = 0;
  dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => clockNow);
  trackMock.mockClear();
  resetFirebaseMock();
  resetConnectivity();
  resetTrustedClock();
  resetMockUptime();
  firebaseMock.configured = true;
  firebaseMock.currentUser = { uid: 'alice' };
  useMetaStore.setState({
    currentLevel: LEVEL_ID,
    attempts: {},
    stars: {},
    chestsClaimed: {},
    winStreak: 0,
    recentFails: 0,
    lastFailAt: 0,
    reviewPromptedVersion: '',
    totalLines: 0,
  });
  useConfigStore.setState({ snapshot: { ...D, flag_economy: true }, fetchedAt: null });
  useWalletStore.setState({ coins: 5_000, rev: 0, pending: {}, held: 0 });
  useLivesStore.setState({
    missing: 0,
    regenFrom: 0,
    chargedRun: null,
    pendingRefill: null,
    adLives: { day: '', count: 0 },
  });
});

afterEach(() => {
  while (activeRenderers.length > 0) {
    const renderer = activeRenderers.pop()!;
    act(() => renderer.unmount());
  }
  dateSpy.mockRestore();
  vi.useRealTimers();
});

describe('§9.2 the gate, as ONE choke point (§0 v1.47(b))', () => {
  it('a 0-life mount shows OutOfLivesSheet instead of GameplayScreen, fires life_blocked once, and never mints the attempt', () => {
    blockedLives();
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(0);
    expect(renderer.root.findAllByType(OutOfLivesSheet).length).toBe(1);
    expect(trackMock.mock.calls.filter(([name]) => name === 'life_blocked')).toHaveLength(1);
    expect(trackMock.mock.calls.filter(([name]) => name === 'level_start')).toHaveLength(0);
    expect(useMetaStore.getState().attempts?.[String(LEVEL_ID)]).toBeUndefined();
  });

  it('never even TRANSIENTLY commits GameplayScreen on a 0-life mount (qa-prd-auditor MAJOR)', () => {
    // `BackHandler.addEventListener` only ever fires from GameplayScreen's
    // own mount effect. A `toHaveBeenCalledTimes` SPY (not `__count()`,
    // which only reflects the FINAL subscription count) is the point: if the
    // gate were corrected only in an effect — one commit after the first
    // paint, mounting then immediately unmounting `GameplayScreen` within
    // the same `act()` flush — the subscribe-then-unsubscribe pair would
    // leave `__count()` at 0 too, even though the mount genuinely happened
    // (and genuinely ran whatever ELSE a real mount effect does that isn't
    // as neatly reversible as an event subscription, e.g. the pre-armed
    // booster's single-fire `attemptBooster`). The spy records history a
    // final-state check cannot un-see.
    const addListener = vi.spyOn(BackHandler, 'addEventListener');
    blockedLives();
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(addListener).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('never gates an FTUE level (id < FIRST_POST_FTUE_LEVEL), even at 0 lives', () => {
    blockedLives();
    useMetaStore.setState({ currentLevel: 1 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(renderer.root.findAllByType(OutOfLivesSheet).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock.mock.calls.filter(([name]) => name === 'life_blocked')).toHaveLength(0);
  });

  it('a full-lives mount is never gated and starts the run normally', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(renderer.root.findAllByType(OutOfLivesSheet).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock.mock.calls).toEqual([['level_start', { id: LEVEL_ID, attempt: 1 }]]);
  });

  it('Cancel routes to onLevelMap when supplied, else onExit', () => {
    blockedLives();
    const onExit = vi.fn();
    const onLevelMap = vi.fn();
    const renderer = render(
      <LevelSession onExit={onExit} onLevelMap={onLevelMap} onOpenSettings={vi.fn()} />,
    );
    act(() => {
      renderer.root.findByType(OutOfLivesSheet).props.onCancel();
    });
    expect(onLevelMap).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Cancel falls back to onExit with no map route', () => {
    blockedLives();
    const onExit = vi.fn();
    const renderer = render(<LevelSession onExit={onExit} onOpenSettings={vi.fn()} />);
    act(() => {
      renderer.root.findByType(OutOfLivesSheet).props.onCancel();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('§9.2 auto-unblock on natural regen', () => {
  it('a regenerated life starts the run with no further life_blocked and no purchase', () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, life_regen_minutes: 1 } });
    blockedLives();
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    trackMock.mockClear();
    advance(60_000 + 1_000); // one regen period, plus one interval tick past it
    expect(renderer.root.findAllByType(OutOfLivesSheet).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock.mock.calls.filter(([name]) => name === 'life_blocked')).toHaveLength(0);
    expect(trackMock.mock.calls.filter(([name]) => name === 'level_start')).toHaveLength(1);
  });

  it('stays blocked through several poll ticks while truly still at 0 lives (qa-prd-auditor MAJOR — a `lives >= 0` typo would pass every other test here)', () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, life_regen_minutes: 30 } });
    blockedLives();
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    trackMock.mockClear();
    advance(5_000); // 5 poll ticks, nowhere near one 30-minute regen period
    expect(renderer.root.findAllByType(OutOfLivesSheet).length).toBe(1);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(0);
    expect(trackMock.mock.calls.filter(([name]) => name === 'level_start')).toHaveLength(0);
  });

  it('the sheet countdown actually ticks (qa-prd-auditor NIT — a frozen `setBlockedNow` call would ship green otherwise)', () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, life_regen_minutes: 30 } });
    blockedLives();
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    const before = renderer.root.findByType(OutOfLivesSheet).props.now;
    advance(5_000);
    const after = renderer.root.findByType(OutOfLivesSheet).props.now;
    expect(after).toBeGreaterThan(before);
  });
});

describe('§9.2 "Refill 🪙" from the sheet (§0 v1.47(c)) — real spendCoins', () => {
  it('insufficient shown balance opens OutOfCoinsSheet instead of spending, with lives-specific copy', () => {
    blockedLives();
    useWalletStore.setState({ coins: D.life_refill_price - 1 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    act(() => {
      renderer.root.findByType(OutOfLivesSheet).props.onRefill();
    });
    expect(firebaseMock.calls).toEqual([]);
    const sheet = renderer.root.findByType(OutOfCoinsSheet);
    expect(sheet.props.body).toContain('refill a life');
    expect(firebaseMock.calls).toEqual([]);
    // qa-prd-auditor NIT, §0 v1.48(h): the VALUE matters, not just that some
    // `sink` was passed — this is the whole point of the param (§9.5's
    // zero-balance "where" breakdown).
    expect(trackMock).toHaveBeenCalledWith('oob_sheet_shown', { sink: 'life_refill' });
  });

  it('a server rejection also opens OutOfCoinsSheet', async () => {
    blockedLives();
    firebaseMock.callables['spendCoins'] = () => {
      throw rejection('insufficient-funds');
    };
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await act(async () => {
      renderer.root.findByType(OutOfLivesSheet).props.onRefill();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByType(OutOfCoinsSheet).length).toBe(1);
    expect(renderer.root.findAllByType(OutOfLivesSheet).length).toBe(1);
  });

  it('a successful refill unblocks immediately — no need to wait for the regen poll', async () => {
    blockedLives();
    firebaseMock.callables['spendCoins'] = () => served(5_000 - D.life_refill_price);
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    trackMock.mockClear();
    await act(async () => {
      renderer.root.findByType(OutOfLivesSheet).props.onRefill();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByType(OutOfLivesSheet).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock.mock.calls).toEqual([
      ['coins_spent', { sink: 'life_refill', amount: D.life_refill_price }],
      ['level_start', { id: LEVEL_ID, attempt: 1 }],
    ]);
  });

  it('an offline/server-fault answer shows a RetryToast whose Retry replays the same pending key', async () => {
    blockedLives();
    firebaseMock.callables['spendCoins'] = () => {
      throw unavailable();
    };
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await act(async () => {
      renderer.root.findByType(OutOfLivesSheet).props.onRefill();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByType(RetryToast).length).toBe(1);
    const firstKey = useLivesStore.getState().pendingRefill?.key;
    expect(firstKey).toBeDefined();

    firebaseMock.callables['spendCoins'] = () => served(5_000 - D.life_refill_price);
    await act(async () => {
      renderer.root.findByType(RetryToast).props.onRetry();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      firebaseMock.calls.map((c) => (c.data as { idempotencyKey: string }).idempotencyKey),
    ).toEqual([firstKey, firstKey]);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
  });

  it('replays a pending refill rather than re-checking the shown balance, even when it has fallen below the price (qa-prd-auditor MAJOR)', async () => {
    blockedLives();
    useLivesStore.setState({
      pendingRefill: { key: 'life_refill:prev', amount: D.life_refill_price },
    });
    useWalletStore.setState({ coins: 10 }); // far below the pending intent's own amount
    firebaseMock.callables['spendCoins'] = () => served(10, false); // not (yet) applied
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await act(async () => {
      renderer.root.findByType(OutOfLivesSheet).props.onRefill();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The real fix: the server was actually asked (not short-circuited by
    // the shown balance), with the SAME key the earlier, lost attempt used.
    expect(firebaseMock.calls).toHaveLength(1);
    expect(firebaseMock.calls[0]?.data).toMatchObject({ idempotencyKey: 'life_refill:prev' });
    expect(renderer.root.findAllByType(OutOfCoinsSheet).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
  });

  it('does not double-fire level_start when a refill success and the regen-poll race to unblock the SAME run (qa-prd-auditor MAJOR)', async () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, life_regen_minutes: 1 } });
    blockedLives();
    let resolveSpend!: (result: WalletResult) => void;
    firebaseMock.callables['spendCoins'] = () =>
      new Promise<WalletResult>((resolve) => {
        resolveSpend = resolve;
      });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    trackMock.mockClear();
    act(() => {
      renderer.root.findByType(OutOfLivesSheet).props.onRefill();
    });

    // The regen poll fires FIRST and unblocks the run naturally, while the
    // refill spend above is still in flight.
    advance(60_000 + 1_000);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock.mock.calls.filter(([name]) => name === 'level_start')).toHaveLength(1);

    // The held spend now resolves — successfully — AFTER the run already
    // started by the other path. Without `beginRun`'s idempotency guard this
    // re-fires `level_start` a second time for the identical run.
    await act(async () => {
      resolveSpend(served(5_000 - D.life_refill_price));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(trackMock.mock.calls.filter(([name]) => name === 'level_start')).toHaveLength(1);
  });

  it('a refill answer that lands AFTER the run already unblocked some other way shows nothing and fires no phantom oob_sheet_shown (qa-prd-auditor NIT)', async () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, life_regen_minutes: 1 } });
    blockedLives();
    let resolveSpend!: () => void;
    firebaseMock.callables['spendCoins'] = () =>
      new Promise((_resolve, reject) => {
        resolveSpend = () => reject(rejection('insufficient-funds'));
      });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    act(() => {
      renderer.root.findByType(OutOfLivesSheet).props.onRefill();
    });

    advance(60_000 + 1_000); // regen poll unblocks the run while the spend is still in flight
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    trackMock.mockClear();

    await act(async () => {
      resolveSpend();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The spend itself still resolves correctly (rejected, nothing charged) —
    // but with no blocked sheet left to answer FOR, nothing pops up over the
    // board the player is already playing, and no stray analytics event
    // claims a zero-balance moment nobody is looking at.
    expect(renderer.root.findAllByType(OutOfCoinsSheet).length).toBe(0);
    expect(renderer.root.findAllByType(RetryToast).length).toBe(0);
    expect(trackMock).not.toHaveBeenCalled();
  });
});

describe('§9.2 the gate at Retry and Next, not just the initial mount (qa-prd-auditor MAJOR)', () => {
  it('Retry after a fail, at 0 lives, shows OutOfLivesSheet instead of starting a new attempt', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    const gameplay = renderer.root.findByType(GameplayScreen);
    const lost = { ...(gameplay.props.initialState as object), status: 'lost' };
    act(() => {
      (gameplay.props.onEvent as (e: unknown[], s: unknown) => void)([], lost);
    });
    advance(FAIL_HOLD_MS);
    expect(renderer.root.findAllByType(FailScreen).length).toBe(1);

    blockedLives();
    trackMock.mockClear();
    act(() => {
      renderer.root.findByType(FailScreen).props.onRetry();
    });
    expect(renderer.root.findAllByType(OutOfLivesSheet).length).toBe(1);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(0);
    expect(trackMock.mock.calls.filter(([name]) => name === 'level_start')).toHaveLength(0);
    expect(trackMock.mock.calls.filter(([name]) => name === 'life_blocked')).toHaveLength(1);
  });

  it('Next after a win, at 0 lives, shows OutOfLivesSheet instead of starting the next level', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    const gameplay = renderer.root.findByType(GameplayScreen);
    const initialState = gameplay.props.initialState as { score: number };
    const won = { ...(gameplay.props.initialState as object), status: 'won' };
    act(() => {
      (gameplay.props.onEvent as (e: unknown[], s: unknown) => void)(
        [{ type: 'LEVEL_WON', score: initialState.score, stars: 1 }],
        won,
      );
    });
    advance(WIN_HOLD_MS);
    expect(renderer.root.findAllByType(WinScreen).length).toBe(1);

    blockedLives();
    trackMock.mockClear();
    act(() => {
      renderer.root.findByType(WinScreen).props.onNext();
    });
    expect(renderer.root.findAllByType(OutOfLivesSheet).length).toBe(1);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(0);
    expect(trackMock.mock.calls.filter(([name]) => name === 'level_start')).toHaveLength(0);
  });
});
