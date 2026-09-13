/**
 * §12.10 / §12.3 store rules that the screens and LevelSession rely on.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FAIL_HEAVY_WINDOW_MS } from '../src/services/reviewPrompt';
import { useMetaStore } from '../src/state/useMetaStore';

const T0 = 1_700_000_000_000;

beforeEach(() => {
  useMetaStore.setState({
    winStreak: 0,
    recentFails: 0,
    lastFailAt: 0,
    streak: 0,
    longestStreak: 0,
  });
});

describe('§12.10 fail-heavy window', () => {
  it('fails within 24h of each other accumulate', () => {
    const { recordLevelFail } = useMetaStore.getState();
    recordLevelFail(T0);
    recordLevelFail(T0 + 1000);
    recordLevelFail(T0 + 2000);
    expect(useMetaStore.getState().recentFails).toBe(3);
  });

  it('a fail 24h or more after the previous one starts a fresh count', () => {
    // Without this, three fails last week plus one today reads as
    // fail-heavy today and suppresses the prompt for a player now winning.
    const { recordLevelFail } = useMetaStore.getState();
    recordLevelFail(T0);
    recordLevelFail(T0 + 1);
    recordLevelFail(T0 + 2);
    recordLevelFail(T0 + 2 + FAIL_HEAVY_WINDOW_MS);
    expect(useMetaStore.getState().recentFails).toBe(1);
  });

  it('a fail resets winStreak', () => {
    useMetaStore.setState({ winStreak: 5 });
    useMetaStore.getState().recordLevelFail(T0);
    expect(useMetaStore.getState().winStreak).toBe(0);
  });
});

describe('§12.3 longest streak rides on setStreak', () => {
  it('raises longestStreak and never lowers it', () => {
    const { setStreak } = useMetaStore.getState();
    setStreak(9);
    setStreak(3);
    expect(useMetaStore.getState()).toMatchObject({ streak: 3, longestStreak: 9 });
  });
});
