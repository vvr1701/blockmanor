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
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryToast } from '../../src/components/RetryToast';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { OutOfCoinsSheet } from '../../src/screens/OutOfCoinsSheet';
import { OutOfLivesSheet } from '../../src/screens/OutOfLivesSheet';
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
    expect(firebaseMock.calls.map((c) => (c.data as { idempotencyKey: string }).idempotencyKey)).toEqual(
      [firstKey, firstKey],
    );
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
  });
});
