/**
 * §12.4 acceptance, clause by clause:
 *   - with the network fully absent the app boots, plays a level, plays Endless
 *   - the Daily tile shows "Needs connection" with a working retry, never a dead end
 *   - events queued offline flush exactly once on reconnect, no duplicates, no loss
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { AnalyticsQueue, defaultSender } from '../../src/services/analyticsQueue';
import { reportNetworkResult, resetConnectivity } from '../../src/services/connectivity';
import { DailyBoardTile } from '../../src/screens/HomeScreen/DailyBoardTile';
import { EndlessScreen } from '../../src/screens/EndlessScreen';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useMetaStore } from '../../src/state/useMetaStore';
import { firebaseMock, resetFirebaseMock } from '../mocks/react-native-firebase';

function render(el: React.ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(el);
  });
  return r;
}

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
}

let queueId = 0;
const freshMmkvId = (): string => `offline-${(queueId += 1)}`;
const tick = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  resetFirebaseMock();
  resetConnectivity();
  useMetaStore.setState({ currentLevel: 12, ftueComplete: true, endlessBest: 0 });
});

describe('§12.4 offline', () => {
  it('boots with Firebase entirely absent — no throw, no blank tree', () => {
    firebaseMock.configured = false;
    const r = render(<App />);
    expect(r.root.findAllByType(HomeScreen)).toHaveLength(1);
  });

  it('Endless is fully playable offline (it reads bundled content, not the network)', () => {
    firebaseMock.configured = false;
    const r = render(<EndlessScreen onExit={() => {}} />);
    // Assert the Endless HUD specifically — "something rendered" would pass
    // for an error state too, which is exactly what this case must rule out.
    expect(texts(r).some((x) => /^0$|Score/i.test(x))).toBe(true);
    expect(r.root.findAllByType(GameplayScreen)).toHaveLength(1);
  });

  it('the Daily tile shows "Needs connection" and NOT the play affordance', () => {
    const r = render(<DailyBoardTile unplayed offline streak={0} onRetry={() => {}} />);
    expect(texts(r)).toContain('Needs connection');
    // The unplayed badge must be gone: a tile that still invites a tap it
    // cannot honour is the dead end §12.9 forbids.
    expect(r.root.findAllByProps({ accessibilityLabel: 'Unplayed today' } as never)).toHaveLength(
      0,
    );
  });

  it('the offline tile has a working retry — never a dead end', () => {
    const onRetry = vi.fn();
    const r = render(<DailyBoardTile unplayed offline streak={0} onRetry={onRetry} />);
    const pressables = r.root.findAllByType('RNPressable' as never);
    expect(pressables).toHaveLength(1);
    // Calling onPress directly bypasses `disabled`, so assert it explicitly —
    // a disabled retry IS the dead end this clause forbids.
    expect((pressables[0]!.props as { disabled?: boolean }).disabled).toBeFalsy();
    act(() => {
      (pressables[0]!.props as { onPress: () => void }).onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Home flips the tile to offline when a network round trip fails', () => {
    useConfigStore.setState((s) => ({
      snapshot: { ...s.snapshot, flag_daily_board: true } as typeof s.snapshot,
    }));
    act(() => {
      reportNetworkResult(false);
    });
    const r = render(<HomeScreen onPlay={() => {}} onOpenMap={() => {}} />);
    expect(texts(r)).toContain('Needs connection');
  });

  it('events queued offline flush EXACTLY once on reconnect — no duplicates, no loss', async () => {
    firebaseMock.configured = false;
    const queue = new AnalyticsQueue({
      sender: defaultSender,
      getCap: () => 500,
      mmkvId: freshMmkvId(),
    });
    queue.track('level_start', { id: 4, attempt: 1 });
    queue.track('level_complete', {
      id: 4,
      score: 900,
      stars: 3,
      duration_s: 40,
      continues: 0,
      boosters_used: 0,
    });
    await queue.flush();
    await tick();
    // Offline: nothing delivered, nothing lost.
    expect(firebaseMock.logged).toHaveLength(0);
    expect(queue.getSnapshot().queued).toBe(2);

    firebaseMock.configured = true;
    void queue.flush();
    await tick();
    await tick();
    await tick();
    expect(firebaseMock.logged.map((e) => e.name)).toEqual(['level_start', 'level_complete']);
    expect(queue.getSnapshot().queued).toBe(0);

    // A second flush must not resend — that is the "no duplicates" half.
    void queue.flush();
    await tick();
    expect(firebaseMock.logged).toHaveLength(2);
  });
});
