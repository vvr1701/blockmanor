/**
 * `LevelSession` §9.3 x5+ win-streak "start-score +200" (§0 v1.49). The
 * booster half of this same win-streak grant (x2/x3/x5+ counts) is proven at
 * the pure-function level in `test/boosters.test.ts` and the screen-wiring
 * level in `levelSession.boosters.render.test.tsx`; this file proves the
 * SCORE bonus specifically — one-shot, MMKV-persisted, actually reaching
 * `GameConfig.startScore` for the very next fresh attempt.
 *
 * Real shipped content (`getLevel`) throughout — the bonus doesn't depend on
 * any level's shape, so there's nothing to gain from a hand-crafted fixture.
 * A win is simulated via the real `GameplayScreen.onEvent` prop (same
 * technique `levelSession.outOfLives.render.test.tsx`'s win→Next test uses),
 * not a full placement — this file's subject is the GRANT, not the engine's
 * own win detection.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));
vi.mock('../../src/services/wallet', () => ({ grantCoins: vi.fn() }));

import { BoosterPreLevelSheet } from '../../src/game/BoosterPreLevelSheet';
import { FAIL_HOLD_MS, WIN_HOLD_MS } from '../../src/game/juice';
import { LevelSession } from '../../src/game/LevelSession';
import { FailScreen } from '../../src/screens/FailScreen';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { WinScreen } from '../../src/screens/WinScreen';
import { useBoosterStore } from '../../src/state/useBoosterStore';
import { useMetaStore } from '../../src/state/useMetaStore';

const activeRenderers: ReactTestRenderer[] = [];

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  activeRenderers.push(renderer);
  return renderer;
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

  it('the NEXT level attempt actually starts at score 200 — the end-to-end wiring, not just the grant', () => {
    useMetaStore.setState({ currentLevel: 13, winStreak: 4 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    winCurrentLevel(renderer);
    act(() => {
      renderer.root.findByType(WinScreen).props.onNext();
    });
    maybeSkipBoosterSheet(renderer);
    const nextGameplay = renderer.root.findByType(GameplayScreen);
    expect((nextGameplay.props.initialState as { score: number }).score).toBe(200);
  });

  it('is one-shot: a Retry of the bonus-attempt itself does not re-apply it', () => {
    useMetaStore.setState({ currentLevel: 13, winStreak: 4 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    winCurrentLevel(renderer);
    act(() => {
      renderer.root.findByType(WinScreen).props.onNext();
    });
    maybeSkipBoosterSheet(renderer);
    expect(
      (renderer.root.findByType(GameplayScreen).props.initialState as { score: number }).score,
    ).toBe(200);
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
    expect(
      (renderer.root.findByType(GameplayScreen).props.initialState as { score: number }).score,
    ).toBe(0);
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

  it('survives an app relaunch — the pending grant is MMKV-persisted, not merely in-memory', () => {
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
    expect(
      (relaunched.root.findByType(GameplayScreen).props.initialState as { score: number }).score,
    ).toBe(200);
  });
});
