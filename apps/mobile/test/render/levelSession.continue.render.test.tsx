/**
 * `LevelSession` §9.4 continue-flow wiring. Drives a real placement into a
 * `'lost'` board (same hand-crafted-fixture technique as
 * `levelSession.render.test.tsx`), then exercises the fail -> continue flow
 * end to end against the firebase mock: the dry-run offer gate, tier pricing,
 * the paid-continue spend (real `spendCoins`, not mocked — this IS the money
 * path §9.4 adds), Second chance's independent cap, Give-up, and
 * OutOfCoinsSheet.
 *
 * `reliefClear` ITSELF is mocked here (`@blockmanor/engine`, `importOriginal`
 * for everything else) to a deterministic "always revives, unused tray"
 * stub: its real behaviour (which cells, obstacles, the §6.3 guarantee) is
 * the engine's own audited territory (`packages/engine/test/reliefClear.test.ts`,
 * 1,000-game fuzz corpus `d1d4ef03`), and this fixture's `FAIL_LEVEL` uses a
 * fixed `pieceSequence` for deterministic placements — which the REAL
 * `reliefClear` refuses outright (no relief on FTUE-shaped fixed sequences,
 * §0 v1.38(iv)). That refusal is proven directly in `continueFlow.test.ts`;
 * this file's job is `LevelSession`'s OWN wiring around whatever the dry run
 * says, not reliefClear's prediction accuracy.
 */
import type * as EngineModule from '@blockmanor/engine';
import type * as ContentModule from '@blockmanor/content';
import type { LevelJson } from '@blockmanor/content';
import { REMOTE_CONFIG_DEFAULTS, type WalletResult } from '@blockmanor/shared';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoosterPreLevelSheet } from '../../src/game/BoosterPreLevelSheet';
import { DragLayer } from '../../src/game/DragLayer';
import { FAIL_HOLD_MS } from '../../src/game/juice';
import { RetryToast } from '../../src/components/RetryToast';
import { ContinueSheet } from '../../src/screens/ContinueSheet';
import { OutOfCoinsSheet } from '../../src/screens/OutOfCoinsSheet';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { FailScreen } from '../../src/screens/FailScreen';
import { resetConnectivity } from '../../src/services/connectivity';
import { resetTrustedClock } from '../../src/services/trustedClock';
import { resetMockUptime, setMockUptime } from '../mocks/device-uptime';
import { useBoosterStore } from '../../src/state/useBoosterStore';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useContinueStore } from '../../src/state/useContinueStore';
import { useMetaStore } from '../../src/state/useMetaStore';
import { useWalletStore } from '../../src/state/useWalletStore';
import { firebaseMock, resetFirebaseMock } from '../mocks/react-native-firebase';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));
// §9.1 level-win coins: proven in test/wallet.test.ts; here only the call —
// §9.4's OWN spend (`spendCoins('continue', ...)`) is deliberately NOT
// mocked below, since that money path is this file's subject.
vi.mock('../../src/services/wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/wallet')>();
  return { ...actual, grantCoins: vi.fn() };
});
// §9.2: proven in test/lives.test.ts; here only the call.
vi.mock('../../src/services/lives', () => ({
  forfeitLife: vi.fn(),
  lifeOnWin: vi.fn(),
  // §0 v1.47: always lets a run start — this file is not testing the gate.
  canStartLevel: vi.fn(() => true),
  hasLifeFor: vi.fn(() => true),
  buyLifeRefill: vi.fn(),
  livesRules: vi.fn(() => ({ max: 5, regenMs: 1_800_000 })),
}));

// See the top-of-file doc comment: a deterministic stub, not a re-prediction
// of the real engine rule. Clears the `used` flag on every tray slot (same
// shape as a real redraw, minus the actual redraw) so the SAME fixed
// `pieceSequence` placements can be replayed for a second death.
vi.mock('@blockmanor/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof EngineModule>();
  return {
    ...actual,
    reliefClear: vi.fn((state: EngineModule.GameState) => ({
      state: {
        ...state,
        status: 'playing' as const,
        tray: state.tray.map((slot) => ({ ...slot, used: false })),
      },
      events: [],
    })),
  };
});

const { FAIL_LEVEL } = vi.hoisted(() => {
  // Same construction as `levelSession.render.test.tsx`'s `FAIL_LEVEL`: every
  // cell filled except an isolated scatter, so `P01` at (0,0) clears nothing
  // and the tray's other two pieces fit nowhere -> `GAME_OVER`, goal untouched.
  const FAIL_EMPTY = new Set(['0,0', '0,1', '1,0', '2,2', '3,3', '4,4', '5,5', '6,6', '7,7']);
  const FAIL_CRATES = new Set(['7,0', '7,1']);
  const prefill: { r: number; c: number; type: string }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const key = `${r},${c}`;
      if (FAIL_EMPTY.has(key)) continue;
      prefill.push({ r, c, type: FAIL_CRATES.has(key) ? 'crate' : 'filled' });
    }
  }
  const FAIL_LEVEL = {
    id: 11,
    chapter: 1,
    seedSalt: 'test-continue-fail',
    prefill,
    goals: [{ type: 'crate', count: 2 }],
    pieceWeightOverrides: {},
    mercy: true,
    stars: { s2: 200, s3: 500 },
    ivySpreadInterval: 3,
    ivyMaxTiles: 16,
    pieceSequence: ['P01', 'P02', 'P03'],
  };
  return { FAIL_LEVEL };
});

vi.mock('@blockmanor/content', async (importOriginal) => {
  const actual = await importOriginal<typeof ContentModule>();
  const byId: Record<number, LevelJson> = { 11: FAIL_LEVEL as LevelJson };
  return { ...actual, getLevel: (id: number) => byId[id] };
});

import { reliefClear } from '@blockmanor/engine';
import { LevelSession, levelRunSeed } from '../../src/game/LevelSession';
import { track } from '../../src/services/analytics';

const trackMock = vi.mocked(track);
const D = REMOTE_CONFIG_DEFAULTS;
const activeRenderers: ReactTestRenderer[] = [];

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  activeRenderers.push(renderer);
  return renderer;
}

function place(renderer: ReactTestRenderer, pieceIndex: number, r: number, c: number): void {
  const dragLayer = renderer.root.findByType(DragLayer);
  act(() => {
    (dragLayer.props as { onPlace: (i: number, r: number, c: number) => void }).onPlace(
      pieceIndex,
      r,
      c,
    );
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

// Drains the real `buyContinue` -> `settleContinue` -> `spendCoins` ->
// `httpsCallable` microtask chain (several `await`s deep) under fake timers —
// fake timers don't touch Promise microtask scheduling, so this just needs
// enough ticks, not a timer advance.
const flushAsync = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

/** Drives the FAIL_LEVEL fixture to a `'lost'` board and past the fail hold —
 * the common setup for every test below (one placement, by this fixture's
 * own construction, §0 v1.17's pattern). */
async function toFailScreen(renderer: ReactTestRenderer): Promise<void> {
  place(renderer, 0, 0, 0);
  advance(FAIL_HOLD_MS);
  await flushAsync();
}

/** A SECOND death on the SAME continued run, for tests that need a tier
 * advance or a second cap check without re-engineering this fixture's
 * one-safe-placement board (see the top-of-file doc comment): the revived
 * state the mocked `reliefClear` returned IS a real engine `GameState`, so
 * flipping its `status` back to `'lost'` through the exposed `onEvent` prop
 * simulates dying again, same `FAIL_HOLD_MS` hold as a real one. */
async function secondDeath(renderer: ReactTestRenderer): Promise<void> {
  const gameplay = renderer.root.findByType(GameplayScreen);
  const lostAgain = { ...(gameplay.props.initialState as object), status: 'lost' };
  act(() => {
    (gameplay.props.onEvent as (e: unknown[], s: unknown) => void)([], lostAgain);
  });
  advance(FAIL_HOLD_MS);
  await flushAsync();
}

const served = (amount: number, applied = true): WalletResult => ({
  coins: 50_000 - amount,
  rev: 1,
  amount,
  applied,
});

beforeEach(() => {
  vi.useFakeTimers();
  trackMock.mockClear();
  resetFirebaseMock();
  resetConnectivity();
  resetTrustedClock();
  resetMockUptime();
  firebaseMock.configured = true;
  firebaseMock.currentUser = { uid: 'alice' };
  useMetaStore.setState({
    currentLevel: 11,
    attempts: {},
    stars: {},
    chestsClaimed: {},
    winStreak: 3,
    recentFails: 0,
    lastFailAt: 0,
    reviewPromptedVersion: '',
    totalLines: 0,
  });
  useBoosterStore.setState({
    counts: { hammer: 0, broom: 0, hourglass: 0 },
    showcaseGranted: { hammer: true, broom: true, hourglass: true },
    tooltip: null,
    preSelected: null,
  });
  useConfigStore.setState({ snapshot: { ...D, flag_economy: true }, fetchedAt: null });
  useWalletStore.setState({ coins: 50_000, rev: 0, pending: {}, held: 0 });
  useContinueStore.setState({ secondChance: { day: '', count: 0 }, pendingContinue: null });
  firebaseMock.callables['spendCoins'] = () => served(D.continue_price_1);
});

afterEach(() => {
  while (activeRenderers.length > 0) {
    const renderer = activeRenderers.pop()!;
    act(() => renderer.unmount());
  }
  vi.useRealTimers();
});

describe('§0 v1.45 / §9.4 — FailScreen offers nothing while flag_economy is off', () => {
  it('Stage-1 byte-identical: no ContinueSheet, no OutOfCoinsSheet', async () => {
    useConfigStore.setState({ snapshot: { ...D } }); // flag_economy defaults false
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    expect(renderer.root.findAllByType(ContinueSheet).length).toBe(0);
    expect(renderer.root.findAllByType(FailScreen).length).toBe(1);
  });
});

describe('§9.4 the offer (dry run, tier pricing, continue_shown)', () => {
  it('shows ContinueSheet priced at tier 1 and fires continue_shown{level,price,balance}', async () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);

    const sheet = renderer.root.findByType(ContinueSheet);
    expect(sheet.props.price).toBe(D.continue_price_1);
    expect(sheet.props.secondChanceOffered).toBe(true);
    // §0 v1.45(a): captured BEFORE §9.3's `recordLevelFail` zeroes the live
    // `winStreak` — this fixture's `beforeEach` seeds `winStreak: 3`, so a
    // post-reset read would wrongly show 0 here.
    expect(sheet.props.streakAtDeath).toBe(3);
    expect(trackMock).toHaveBeenCalledWith('continue_shown', {
      level: 11,
      price: D.continue_price_1,
      balance: 50_000,
    });
  });
});

describe('§9.4 paid Continue — real spendCoins, tier advance, resumes play', () => {
  it('accepting spends the price, fires continue_accepted, and returns to GameplayScreen (same run)', async () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);

    const sheet = renderer.root.findByType(ContinueSheet);
    await act(async () => {
      sheet.props.onContinue();
      await flushAsync();
    });

    expect(firebaseMock.calls[0]?.data).toMatchObject({
      sink: 'continue',
      amount: D.continue_price_1,
    });
    expect(trackMock).toHaveBeenCalledWith('continue_accepted', {
      level: 11,
      price: D.continue_price_1,
      balance: 50_000 - D.continue_price_1,
    });
    // Back on the board, same run — `level_start` fired only once (initial
    // mount); a continue is not a new run (§0 v1.17's attempt counter is
    // untouched by it).
    expect(renderer.root.findAllByType(FailScreen).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock.mock.calls.filter(([name]) => name === 'level_start')).toHaveLength(1);
  });

  it('insufficient shown balance opens OutOfCoinsSheet instead of spending', async () => {
    useWalletStore.setState({ coins: D.continue_price_1 - 1 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);

    act(() => {
      renderer.root.findByType(ContinueSheet).props.onContinue();
    });
    expect(firebaseMock.calls).toEqual([]);
    expect(trackMock).toHaveBeenCalledWith('oob_sheet_shown', { sink: 'continue' });
    const oob = renderer.root.findByType(OutOfCoinsSheet);
    expect(oob.props.price).toBe(D.continue_price_1);

    // Cancel returns to the (still-offered) fail screen, nothing charged.
    act(() => {
      oob.props.onCancel();
    });
    expect(renderer.root.findAllByType(OutOfCoinsSheet).length).toBe(0);
    expect(renderer.root.findAllByType(ContinueSheet).length).toBe(1);
  });

  it('a server rejection (insufficient-funds) also opens OutOfCoinsSheet', async () => {
    firebaseMock.callables['spendCoins'] = () => {
      throw Object.assign(new Error('insufficient-funds'), {
        code: 'functions/failed-precondition',
        details: { reason: 'insufficient-funds' },
      });
    };
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    await act(async () => {
      renderer.root.findByType(ContinueSheet).props.onContinue();
      await flushAsync();
    });
    expect(renderer.root.findAllByType(OutOfCoinsSheet).length).toBe(1);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(0);
  });

  it('at continue_max_per_attempt already, no offer at all — even with second_chance unused (§0 v1.45(b))', async () => {
    // `continuesExhausted(0)` true at `continue_max_per_attempt: 0` — proves
    // the SAME gate a mid-attempt exhaustion would hit (continuePrice/
    // continuesExhausted's arithmetic is unit-pinned in continueFlow.test.ts;
    // this is LevelSession's own wiring of that gate into the render).
    useConfigStore.setState({
      snapshot: { ...D, flag_economy: true, continue_max_per_attempt: 0 },
    });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    // §0 v1.45(b): the cap closes BOTH options, not just the paid one.
    expect(renderer.root.findAllByType(ContinueSheet).length).toBe(0);
    expect(renderer.root.findAllByType(FailScreen).length).toBe(1);
  });
});

describe('§0 v1.38(iii) dry-run gate — never offered when reliefClear would stay lost', () => {
  it('neither Continue nor Second chance renders; no coins or ad view are ever spent on a dead board', async () => {
    vi.mocked(reliefClear).mockReturnValueOnce({
      state: { status: 'lost' } as unknown as ReturnType<typeof reliefClear>['state'],
      events: [],
    });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    expect(renderer.root.findAllByType(ContinueSheet).length).toBe(0);
    expect(renderer.root.findAllByType(FailScreen).length).toBe(1);
    expect(firebaseMock.calls).toEqual([]);
  });
});

describe('§0 v1.39(b) tier advance — a second paid continue costs the next tier', () => {
  it('prices the SECOND paid continue (same attempt) at continue_price_2, not price_1 again', async () => {
    useConfigStore.setState({
      snapshot: { ...D, flag_economy: true, continue_max_per_attempt: 2 },
    });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    await act(async () => {
      renderer.root.findByType(ContinueSheet).props.onContinue();
      await flushAsync();
    });
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);

    await secondDeath(renderer);

    const secondSheet = renderer.root.findByType(ContinueSheet);
    expect(secondSheet.props.price).toBe(D.continue_price_2);
    await act(async () => {
      secondSheet.props.onContinue();
      await flushAsync();
    });
    expect(firebaseMock.calls[1]?.data).toMatchObject({
      sink: 'continue',
      amount: D.continue_price_2,
    });
  });

  it('continue_max_per_attempt gates off BOTH options mid-attempt, not just at a 0 cap (§0 v1.45(b))', async () => {
    useConfigStore.setState({
      snapshot: { ...D, flag_economy: true, continue_max_per_attempt: 1 },
    });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    await act(async () => {
      renderer.root.findByType(ContinueSheet).props.onContinue();
      await flushAsync();
    });

    await secondDeath(renderer);

    // The ONE paid continue this attempt's cap allows is already spent —
    // neither Continue nor Second chance (still unused today) is offered.
    expect(renderer.root.findAllByType(ContinueSheet).length).toBe(0);
    expect(renderer.root.findAllByType(FailScreen).length).toBe(1);
  });
});

describe('§0 v1.39(a)/v1.45(c) Second chance — free, separate cap, no tier advance', () => {
  it('accepting does not spend coins, fires continue_accepted{price:0}, and resumes play', async () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);

    act(() => {
      renderer.root.findByType(ContinueSheet).props.onSecondChance();
    });
    expect(firebaseMock.calls).toEqual([]); // no coin spend at all
    expect(trackMock).toHaveBeenCalledWith('continue_accepted', {
      level: 11,
      price: 0,
      balance: 50_000,
    });
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    // Tier NOT advanced: `continuePrice(0)` (unchanged) is pinned directly in
    // continueFlow.test.ts; a second real fail cycle on THIS hand-built
    // fixture would need a cell that clears no line on refill, which this
    // fixture's prefill (deliberately tuned for exactly one safe placement,
    // §0 v1.17's pattern) doesn't offer a second one of — out of scope for
    // this already-narrow fixture rather than re-engineering it.
  });

  it('is capped independently per UTC day — exhausting it still leaves Continue offered', async () => {
    // Exhaust it for "today" the same way a player would: via the store's
    // own grant, not a hand-guessed date string.
    for (let i = 0; i < D.second_chance_daily_cap; i++) {
      useContinueStore.getState().grantSecondChance(Date.now(), D.second_chance_daily_cap);
    }
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    const sheet = renderer.root.findByType(ContinueSheet);
    expect(sheet.props.secondChanceOffered).toBe(false);
    expect(sheet.props.price).toBe(D.continue_price_1); // Continue is unaffected
  });
});

describe('§0 v1.46(c) race guard — Second chance / Give Up are no-ops while a paid continue is in flight', () => {
  it('a tap on Second chance or Give Up mid-spend does nothing; the pending spend still resolves exactly once', async () => {
    let resolveSpend!: (value: WalletResult) => void;
    firebaseMock.callables['spendCoins'] = () =>
      new Promise<WalletResult>((resolve) => {
        resolveSpend = resolve;
      });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);

    act(() => {
      renderer.root.findByType(ContinueSheet).props.onContinue();
    });
    const busySheet = renderer.root.findByType(ContinueSheet);
    expect(busySheet.props.busy).toBe(true);

    // Reproduces the auditor's finding: without the guard, either of these
    // could revive the board (or leave the attempt) out from under the
    // pending spend's own stale closure.
    act(() => {
      busySheet.props.onSecondChance();
      busySheet.props.onGiveUp();
    });
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(0);
    expect(renderer.root.findAllByType(ContinueSheet).length).toBe(1);
    expect(useContinueStore.getState().secondChance.count).toBe(0);

    await act(async () => {
      resolveSpend(served(D.continue_price_1));
      await flushAsync();
    });
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(firebaseMock.calls).toHaveLength(1); // exactly one spend, not two charges
    expect(trackMock.mock.calls.filter(([name]) => name === 'continue_accepted')).toHaveLength(1);
  });
});

describe('§0 v1.46(e) a failed (offline/server-fault) spend gets a retry toast, never silence', () => {
  it('shows RetryToast on a failed spend; its own Retry replays the SAME pending key', async () => {
    firebaseMock.callables['spendCoins'] = () => {
      throw Object.assign(new Error('x'), { code: 'functions/unavailable' });
    };
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    await act(async () => {
      renderer.root.findByType(ContinueSheet).props.onContinue();
      await flushAsync();
    });
    const toast = renderer.root.findByType(RetryToast);
    expect(toast).toBeTruthy();
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(0);

    firebaseMock.callables['spendCoins'] = () => served(D.continue_price_1, false); // already applied
    await act(async () => {
      toast.props.onRetry?.();
      await flushAsync();
    });
    const key = (firebaseMock.calls[0]?.data as { idempotencyKey: string }).idempotencyKey;
    expect(firebaseMock.calls.map((c) => c.data)).toEqual([
      expect.objectContaining({ idempotencyKey: key }),
      expect.objectContaining({ idempotencyKey: key }),
    ]);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
  });
});

describe('§0 v1.46(d) a continue does not re-fire the pre-level booster slot', () => {
  it('a pre-armed booster carried into the continued run is NOT re-targeted on the remount', async () => {
    useBoosterStore.setState({
      counts: { hammer: 1, broom: 0, hourglass: 0 },
      showcaseGranted: { hammer: true, broom: true, hourglass: true },
      tooltip: null,
      preSelected: null,
    });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    act(() => {
      renderer.root.findByType(BoosterPreLevelSheet).props.onConfirm('hammer');
    });
    expect(
      (renderer.root.findByType(GameplayScreen).props as { boosters: { preArmed: unknown } })
        .boosters.preArmed,
    ).toBe('hammer');
    await toFailScreen(renderer);
    await act(async () => {
      renderer.root.findByType(ContinueSheet).props.onContinue();
      await flushAsync();
    });
    const gameplay = renderer.root.findByType(GameplayScreen);
    // §0 v1.46(d): `continuedState` is set, so `preArmed` must be null on
    // this remount — the booster is NOT re-armed just because the screen
    // mounted again.
    expect((gameplay.props.boosters as { preArmed: unknown }).preArmed).toBeNull();
  });
});

describe('§0 v1.46(f) second-chance cap resists a forward clock jump — proves LevelSession really uses trustedNow', () => {
  it('a wall-clock jump to "tomorrow" does not free up a fresh second chance when real uptime barely moved', async () => {
    const { trustedNow } = await import('../../src/services/trustedClock');
    const START = Date.UTC(2026, 8, 29, 12);
    useConfigStore.setState({
      snapshot: { ...D, flag_economy: true, second_chance_daily_cap: 1 },
    });

    // Establish the trustedClock anchor at START (uptime 0), matching the
    // day the cap below is exhausted for.
    let clock = vi.spyOn(Date, 'now').mockReturnValue(START);
    setMockUptime(0);
    trustedNow();
    useContinueStore.setState({
      secondChance: { day: new Date(START).toISOString().slice(0, 10), count: 1 },
      pendingContinue: null,
    });
    clock.mockRestore();

    // Jump the WALL clock forward a full day; only 5 REAL seconds of uptime
    // pass — a raw `Date.now()` read would see "tomorrow" and free up a
    // fresh second chance; `trustedNow()` must clamp it to ~5s, same day.
    setMockUptime(5_000);
    clock = vi.spyOn(Date, 'now').mockReturnValue(START + 25 * 3_600_000);
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    clock.mockRestore();

    const sheet = renderer.root.findByType(ContinueSheet);
    expect(sheet.props.secondChanceOffered).toBe(false);
  });
});

describe('§9.4 Give up', () => {
  it('declines, fires continue_declined, and reverts to the plain Stage-1 fail screen', async () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);

    act(() => {
      renderer.root.findByType(ContinueSheet).props.onGiveUp();
    });
    expect(trackMock).toHaveBeenCalledWith('continue_declined', {
      level: 11,
      price: D.continue_price_1,
      balance: 50_000,
    });
    expect(renderer.root.findAllByType(ContinueSheet).length).toBe(0);
    expect(renderer.root.findAllByType(FailScreen).length).toBe(1);
  });
});

describe('levelRunSeed stability across a continue', () => {
  it('a continue never mints a new attempt/runKey — the same run stays alive', async () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    await toFailScreen(renderer);
    await act(async () => {
      renderer.root.findByType(ContinueSheet).props.onContinue();
      await flushAsync();
    });
    // `level_start` fired exactly once (the initial mount) — a continue is
    // not a new run, so §0 v1.17's attempt counter never advances for it.
    expect(trackMock.mock.calls.filter(([name]) => name === 'level_start')).toEqual([
      ['level_start', { id: 11, attempt: 1 }],
    ]);
    expect(levelRunSeed(11, 1)).toBe('level-11-a1');
  });
});
