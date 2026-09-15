/**
 * Sign-off audit B2: a QA build with EXPO_PUBLIC_FTUE_FORCE_REPLAY replays FTUE
 * on launch, but finishing it must reach Home — before, App kept rendering
 * FtueScreen forever, so Home, Daily, Settings and push were unreachable.
 */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../../src/game/devFlag');
  vi.resetModules();
});

describe('App with a forced FTUE replay', () => {
  it('replays FTUE for a returning player, then lands on Home once it completes', async () => {
    vi.resetModules();
    vi.doMock('../../src/game/devFlag', () => ({
      DEV_BOARD_ENABLED: false,
      FTUE_FORCE_REPLAY: true,
    }));
    const { default: App } = await import('../../src/App');
    const { FtueScreen } = await import('../../src/screens/FtueScreen');
    const { HomeScreen } = await import('../../src/screens/HomeScreen');
    const { useMetaStore } = await import('../../src/state/useMetaStore');
    act(() => {
      useMetaStore.setState({ ftueComplete: true, currentLevel: 6 });
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });
    expect(renderer.root.findAllByType(FtueScreen)).toHaveLength(1);

    act(() => {
      (renderer.root.findByType(FtueScreen).props.onComplete as () => void)();
    });
    expect(renderer.root.findAllByType(FtueScreen)).toHaveLength(0);
    expect(renderer.root.findAllByType(HomeScreen)).toHaveLength(1);
    act(() => {
      renderer.unmount();
    });
  });
});
