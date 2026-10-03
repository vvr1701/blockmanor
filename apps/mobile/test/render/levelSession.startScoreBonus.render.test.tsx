/**
 * `LevelSession` §9.3 x5+ win-streak "start-score +200" (§0 v1.49/v1.50). The
 * booster half of this same win-streak grant (x2/x3/x5+ counts) is proven at
 * the pure-function level in `test/boosters.test.ts` and the screen-wiring
 * level in `levelSession.boosters.render.test.tsx`; this file proves the
 * SCORE bonus specifically — one-shot, MMKV-persisted (the real persist/
 * rehydrate round-trip itself is in `test/boosters.test.ts`), actually
 * reaching `GameConfig.startScore` for the very next fresh attempt.
 *
 * Real shipped content (`getLevel`) throughout — the bonus doesn't depend on
 * any level's shape, so there's nothing to gain from a hand-crafted fixture.
 * A win is simulated via the real `GameplayScreen.onEvent` prop (same
 * technique `levelSession.outOfLives.render.test.tsx`'s win→Next test uses),
 * not a full placement — this file's subject is the GRANT, not the engine's
 * own win detection.
 *
 * qa-prd-auditor MAJOR (§0 v1.50(g)): every assertion here checks the
 * RENDERED score text inside `GameplayScreen`, never just its `initialState`
 * PROP. `GameplayScreen` seeds its own internal engine state from that prop
 * with a plain `useState(initialState)` (not a lazy initializer keyed to
 * anything) — React uses the prop's value only on the component's OWN first
 * render and ignores it on every later one. A one-frame-late fix (the exact
 * class of bug v1.48(e) already fixed for the lives gate) can leave the PROP
 * eventually correct while the board the player actually sees and plays
 * stays seeded wrong — invisible to a test that only reads `.props`.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));
vi.mock('../../src/services/wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/wallet')>();
  return { ...actual, grantCoins: vi.fn() };
});
// §9.2: proven in test/lives.test.ts; here only the call — the one test below
// that turns `flag_economy` on (to exercise a continue) must not also wake up
// the real lives gate, which this file never tests.
vi.mock('../../src/services/lives', () => ({
  forfeitLife: vi.fn(),
  lifeOnWin: vi.fn(),
  canStartLevel: vi.fn(() => true),
  hasLifeFor: vi.fn(() => true),
  buyLifeRefill: vi.fn(),
  livesRules: vi.fn(() => ({ max: 5, regenMs: 1_800_000 })),
}));
// The "a continued run doesn't double-apply the bonus" test needs a
// deterministic revive — `reliefClear`'s own cell-selection accuracy is the
// engine's own audited territory (packages/engine/test/reliefClear.test.ts),
// same stub shape `levelSession.continue.render.test.tsx` already uses.
vi.mock('@blockmanor/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blockmanor/engine')>();
  return {
    ...actual,
    reliefClear: vi.fn((state: import('@blockmanor/engine').GameState) => ({
      state: {
        ...state,
        status: 'playing' as const,
        tray: state.tray.map((s) => ({ ...s, used: false })),
      },
      events: [],
    })),
  };
});

import { REMOTE_CONFIG_DEFAULTS, type WalletResult } from '@blockmanor/shared';
import { BoosterPreLevelSheet } from '../../src/game/BoosterPreLevelSheet';
import { FAIL_HOLD_MS, WIN_HOLD_MS } from '../../src/game/juice';
import { LevelSession } from '../../src/game/LevelSession';
import { ContinueSheet } from '../../src/screens/ContinueSheet';
import { FailScreen } from '../../src/screens/FailScreen';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { WinScreen } from '../../src/screens/WinScreen';
import { resetConnectivity } from '../../src/services/connectivity';
import { resetTrustedClock } from '../../src/services/trustedClock';
import { resetMockUptime } from '../mocks/device-uptime';
import { useBoosterStore } from '../../src/state/useBoosterStore';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useContinueStore } from '../../src/state/useContinueStore';
import { useMetaStore } from '../../src/state/useMetaStore';
import { useWalletStore } from '../../src/state/useWalletStore';
import { firebaseMock, resetFirebaseMock } from '../mocks/react-native-firebase';

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

/** The joined text of every rendered `Text` node — what the player actually
 * sees, as opposed to any component's props. */
function allText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('RNText' as never)
    .map((n) => n.props.children)
    .join(' ');
}

/** Drives the mounted level's `GameplayScreen` to a win via the real
 * `onEvent` prop, with a plausible `LEVEL_WON` event `handleEvent` requires. */
function winCurrentLevel(renderer: ReactTestRenderer): void {
  const gameplay = renderer.root.findByType(GameplayScreen);
  const initialState = gameplay.props.initialState as { score: number };
  const won = { ...(gameplay.props.initialState as object), status: 'won' };
  act(() => {
    (gameplay.props.onEvent as (e: unknown[], s: unknown) => void)(
      [{ type: 'LEVEL_WON', score: initialState.score + 50, stars: 1 }],
      won,
    );
  });
  act(() => {
    vi.advanceTimersByTime(WIN_HOLD_MS);
  });
}

/** A x5+ win-streak grants 2 boosters alongside the score bonus (§9.3) — a
 * SEPARATE concern this file isn't testing, but one that otherwise intercepts
 * `GameplayScreen` behind `BoosterPreLevelSheet` on the very next level. Skip
 * it, exactly as a player declining would, so each test can look straight at
 * the score wiring. */
function maybeSkipBoosterSheet(renderer: ReactTestRenderer): void {
  const sheets = renderer.root.findAllByType(BoosterPreLevelSheet);
  if (sheets.length === 0) return;
  act(() => {
    sheets[0]!.props.onConfirm(null);
  });
}

const RESET_META = {
  attempts: {},
  stars: {},
  chestsClaimed: {},
  winStreak: 0,
  recentFails: 0,
  lastFailAt: 0,
  reviewPromptedVersion: '',
  totalLines: 0,
} as const;

const RESET_BOOSTERS = {
  counts: { hammer: 0, broom: 0, hourglass: 0 },
  showcaseGranted: { hammer: true, broom: true, hourglass: true },
  tooltip: null,
  preSelected: null,
  pendingStartScore: 0,
} as const;

beforeEach(() => {
  vi.useFakeTimers();
  useMetaStore.setState({ currentLevel: 13, ...RESET_META });
  useBoosterStore.setState(RESET_BOOSTERS);
  useConfigStore.setState({ snapshot: { ...D }, fetchedAt: null });
  resetFirebaseMock();
  resetConnectivity();
  resetTrustedClock();
  resetMockUptime();
});

afterEach(() => {
  while (activeRenderers.length > 0) {
    const renderer = activeRenderers.pop()!;
    act(() => renderer.unmount());
  }
  vi.useRealTimers();
});

describe('§9.3 x5+ win-streak start-score bonus', () => {
  it('a win reaching streak 5 grants pendingStartScore 200 (the RC-default tier bonus)', () => {
    useMetaStore.setState({ currentLevel: 13, winStreak: 4 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    winCurrentLevel(renderer);
    expect(useBoosterStore.getState().pendingStartScore).toBe(200);
  });

  it('the NEXT level attempt actually RENDERS starting at score 200 — not just the prop', () => {
    useMetaStore.setState({ currentLevel: 13, winStreak: 4 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    winCurrentLevel(renderer);
    act(() => {
      renderer.root.findByType(WinScreen).props.onNext();
    });
    maybeSkipBoosterSheet(renderer);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(allText(renderer)).toContain('200');
  });

  it("a cold mount with NO boosters owned renders the pending bonus for real (qa-prd-auditor MAJOR — the booster pre-level sheet above otherwise masks a one-frame-late bug by delaying GameplayScreen's mount)", () => {
    // Simulates relaunching straight into a level that owes a +200 bonus but
    // granted no boosters this time (e.g. an RC tier like "5:0+200", or
    // boosters already spent) — nothing stands between mount and
    // `GameplayScreen` committing with its FIRST-EVER render.
    useBoosterStore.setState({ ...RESET_BOOSTERS, pendingStartScore: 200 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(renderer.root.findAllByType(BoosterPreLevelSheet).length).toBe(0);
    expect(allText(renderer)).toContain('200');
  });

  it('is one-shot: a Retry of the bonus-attempt itself does not re-apply it', () => {
    useMetaStore.setState({ currentLevel: 13, winStreak: 4 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    winCurrentLevel(renderer);
    act(() => {
      renderer.root.findByType(WinScreen).props.onNext();
    });
    maybeSkipBoosterSheet(renderer);
    expect(allText(renderer)).toContain('200');
    expect(useBoosterStore.getState().pendingStartScore).toBe(0);

    // Fail the bonus level and Retry — a SECOND fresh attempt at the SAME
    // level must not see the bonus again; it was already consumed the moment
    // the first one started.
    const gameplay = renderer.root.findByType(GameplayScreen);
    const lost = { ...(gameplay.props.initialState as object), status: 'lost' };
    act(() => {
      (gameplay.props.onEvent as (e: unknown[], s: unknown) => void)([], lost);
    });
    act(() => {
      vi.advanceTimersByTime(FAIL_HOLD_MS);
    });
    act(() => {
      renderer.root.findByType(FailScreen).props.onRetry();
    });
    expect(allText(renderer)).not.toContain('200');
  });

  it('a corrupt pendingStartScore never crashes the level — sanitizes to 0 instead (qa-prd-auditor MAJOR — a §12.9 dead end, not a "quietly wrecked run")', () => {
    // Realistic routes in: a `winstreak_thresholds` RC typo overflowing past
    // a safe integer, or a truncated/hand-edited MMKV blob — same class of
    // corruption `nextAttempt` already guards against for `attempts`.
    const badValues: readonly number[] = [
      1e17,
      200.5,
      Number.NaN,
      -50,
      Number.POSITIVE_INFINITY,
      '200' as unknown as number, // a truncated/corrupted MMKV blob
    ];
    for (const bad of badValues) {
      useBoosterStore.setState({ ...RESET_BOOSTERS, pendingStartScore: bad });
      expect(() => {
        const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
        expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
      }).not.toThrow();
    }
  });

  it('streak 3 (below x5) grants boosters but no score bonus', () => {
    useMetaStore.setState({ currentLevel: 13, winStreak: 2 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    winCurrentLevel(renderer);
    expect(useBoosterStore.getState().pendingStartScore).toBe(0);
    // The booster half of this same tier still fires (proven in depth
    // elsewhere; spot-checked here so this file can't silently stop testing
    // the right grant if the tier logic ever changes).
    const counts = useBoosterStore.getState().counts;
    expect(counts.hammer + counts.broom + counts.hourglass).toBeGreaterThan(0);
  });

  it('survives an app relaunch — the pending grant is read correctly by a brand new LevelSession mount (the real MMKV round-trip is in test/boosters.test.ts)', () => {
    useMetaStore.setState({ currentLevel: 13, winStreak: 4 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    winCurrentLevel(renderer);
    expect(useBoosterStore.getState().pendingStartScore).toBe(200);
    // Simulate the app closing before "Next" is ever tapped, then relaunching
    // straight onto the next level (currentLevel already advanced to it by
    // some other persisted path) — a fresh `LevelSession` mount, not a
    // continuation of the same component instance.
    act(() => renderer.unmount());
    activeRenderers.pop();
    useMetaStore.setState({ currentLevel: 14 });
    const relaunched = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    maybeSkipBoosterSheet(relaunched);
    expect(allText(relaunched)).toContain('200');
  });

  it('a continue on the SAME bonus-attempt does not double-apply the bonus (qa-prd-auditor MAJOR — §9.3 acceptance "never re-applied to a continued run")', async () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true }, fetchedAt: null });
    useWalletStore.setState({ coins: 50_000, rev: 0, pending: {}, held: 0 });
    useContinueStore.setState({ secondChance: { day: '', count: 0 }, pendingContinue: null });
    firebaseMock.configured = true;
    firebaseMock.currentUser = { uid: 'alice' };
    const served = (amount: number): WalletResult => ({
      coins: 50_000 - amount,
      rev: 1,
      amount,
      applied: true,
    });
    firebaseMock.callables['spendCoins'] = () => served(D.continue_price_1);

    useMetaStore.setState({ currentLevel: 13, winStreak: 4 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    winCurrentLevel(renderer);
    act(() => {
      renderer.root.findByType(WinScreen).props.onNext();
    });
    maybeSkipBoosterSheet(renderer);
    expect(allText(renderer)).toContain('200');
    // `startScoreBonus` (local state) is NOT reset back to 0 until the NEXT
    // `[json.id, attempt]` transition — it is still 200 in this component's
    // state for the rest of THIS attempt, which is exactly why a continue on
    // this same attempt is the real adversarial case, not a vacuous one.

    // Fail with goals unmet and accept the offered paid Continue.
    const gameplay = renderer.root.findByType(GameplayScreen);
    const preDeathState = gameplay.props.initialState as { score: number };
    const lost = { ...preDeathState, status: 'lost' };
    act(() => {
      (gameplay.props.onEvent as (e: unknown[], s: unknown) => void)([], lost);
    });
    act(() => {
      vi.advanceTimersByTime(FAIL_HOLD_MS);
    });
    await act(async () => {
      renderer.root.findByType(ContinueSheet).props.onContinue();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Back on GameplayScreen, revived by the (stubbed) reliefClear — its
    // score must be exactly the pre-death score, never that plus another 200.
    const revived = renderer.root.findByType(GameplayScreen);
    const revivedScore = (revived.props.initialState as { score: number }).score;
    expect(revivedScore).toBe(preDeathState.score);
    expect(revivedScore).not.toBe(preDeathState.score + 200);
  });
});
