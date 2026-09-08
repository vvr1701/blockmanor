/**
 * PRD §12.5 — the remote kill switch, exercised through the real `App` root
 * (not the screens in isolation): the gate has to actually WIN over every
 * other branch `App.tsx` can render, which is only provable by mounting the
 * whole tree. §0 rule 6a: each acceptance clause below gets ITS OWN
 * assertion, never borrowed from a neighbour.
 *
 *  - "a build below min_supported_version is blocked with a working store
 *    button and cannot be dismissed into the game"
 *  - "maintenance_mode shows the butler screen"
 *  - "both read live Remote Config, so this remains a working remote kill
 *    switch when the installed build is otherwise broken"
 */
import Constants from 'expo-constants';
import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import React from 'react';
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

import App from '../../src/App';
import { EndlessScreen } from '../../src/screens/EndlessScreen';
import { ForceUpdateScreen } from '../../src/screens/ForceUpdateScreen';
import { FtueScreen } from '../../src/screens/FtueScreen';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { MaintenanceScreen } from '../../src/screens/MaintenanceScreen';
import { getStoreUrl } from '../../src/services/appInfo';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useMetaStore } from '../../src/state/useMetaStore';
// Imported through the MOCK path, not the package: `tsc` doesn't apply
// vitest.config.ts's aliases, so the real `react-native` types don't carry
// these test-only helpers (`BackHandler.__press`, `Linking.__calls`) — same
// reason `pauseSheet.render.test.tsx` does it.
import { BackHandler, Linking } from '../mocks/react-native';
import { firebaseMock, resetFirebaseMock } from '../mocks/react-native-firebase';

/** A rendered `RNPressable` host node with a live `onPress`. */
function pressableButtons(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (n) => String(n.type) === 'RNPressable' && typeof n.props.onPress === 'function',
  );
}

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function press(node: { props: { onPress?: () => void } }): void {
  act(() => {
    node.props.onPress?.();
  });
}

beforeEach(() => {
  resetFirebaseMock();
  Linking.__reset();
  Constants.expoConfig!.version = REMOTE_CONFIG_DEFAULTS.min_supported_version;
  useConfigStore.setState({ snapshot: { ...REMOTE_CONFIG_DEFAULTS }, fetchedAt: null });
  // A "returning user" save — the state most likely to reach Home/FTUE if
  // the gate below did NOT run first, which is exactly what makes it a good
  // fixture for proving the gate wins.
  useMetaStore.setState({
    currentLevel: 12,
    ftueComplete: true,
    playerName: null,
    avatarId: null,
    attempts: {},
    stars: {},
    chestsClaimed: {},
    ownedFrames: [],
  });
});

describe('§12.5 — neither trigger active (control case)', () => {
  it('boots straight through to Home; neither blocking screen renders', () => {
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(0);
    expect(renderer.root.findAllByType(MaintenanceScreen).length).toBe(0);
  });
});

describe('§12.5 — min_supported_version gate (numeric compare, the named "1.10"/"1.9" trap)', () => {
  it('installed 1.9, min 1.10 (installed truly older) — BLOCKED', () => {
    Constants.expoConfig!.version = '1.9';
    useConfigStore.setState((s) => ({
      snapshot: { ...s.snapshot, min_supported_version: '1.10' },
    }));
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(1);
  });

  it('installed 1.10, min 1.9 (installed truly newer) — NOT blocked, despite "1.10" < "1.9" as strings', () => {
    Constants.expoConfig!.version = '1.10';
    useConfigStore.setState((s) => ({ snapshot: { ...s.snapshot, min_supported_version: '1.9' } }));
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(0);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
  });

  it('installed exactly equals the minimum — NOT blocked (the floor is inclusive)', () => {
    Constants.expoConfig!.version = '2.3.0';
    useConfigStore.setState((s) => ({
      snapshot: { ...s.snapshot, min_supported_version: '2.3.0' },
    }));
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(0);
  });

  it('wins over EVERY other branch: FTUE, Home, and the map/endless/gameplay routes never mount', () => {
    Constants.expoConfig!.version = '0.0.1';
    useConfigStore.setState((s) => ({
      snapshot: { ...s.snapshot, min_supported_version: '9.9.9' },
    }));
    // A fresh-install state, which would otherwise land on FtueScreen —
    // the very next branch after the §12.5 gate in App.tsx.
    useMetaStore.setState({ currentLevel: 1, ftueComplete: false });
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(1);
    expect(renderer.root.findAllByType(FtueScreen).length).toBe(0);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(0);
    expect(renderer.root.findAllByType(EndlessScreen).length).toBe(0);
  });

  it('is a LIVE read: an RC push landing after mount (no relaunch) flips the gate on', async () => {
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(0);
    // Let Home's own unrelated mount-time async work (e.g. the reduced-motion
    // check) settle before the next `act`, so the RC-push assertion below is
    // the only state update under test.
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      useConfigStore.getState().applySnapshot({ min_supported_version: '999.0.0' }, Date.now());
    });
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(1);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(0);
  });

  it('CANNOT be dismissed into the game: an Android hardware back press is unconsumed, and the blocking screen is still all that renders', () => {
    Constants.expoConfig!.version = '0.0.1';
    useConfigStore.setState((s) => ({
      snapshot: { ...s.snapshot, min_supported_version: '9.9.9' },
    }));
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(1);
    const consumed = BackHandler.__press();
    // Nothing on this screen (or App, while it is showing) registers a
    // BackHandler — the OS default (exit the app) is what "unconsumed"
    // means, never a silent pop back into Home.
    expect(consumed).toBe(false);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(1);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(0);
  });

  it('the store button opens the real store URL via Linking.openURL, and the screen is unchanged afterwards', () => {
    Constants.expoConfig!.version = '0.0.1';
    useConfigStore.setState((s) => ({
      snapshot: { ...s.snapshot, min_supported_version: '9.9.9' },
    }));
    const renderer = render(<App />);
    const button = pressableButtons(renderer)[0]!;
    press(button);
    expect(Linking.__calls).toEqual([getStoreUrl()]);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(1);
  });
});

describe('§12.5 — maintenance_mode gate', () => {
  it('true (version fine) — shows MaintenanceScreen, not Home', () => {
    useConfigStore.setState((s) => ({ snapshot: { ...s.snapshot, maintenance_mode: true } }));
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(MaintenanceScreen).length).toBe(1);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(0);
  });

  it('false — Home renders normally', () => {
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(MaintenanceScreen).length).toBe(0);
  });

  it('below-minimum-version wins over maintenance when both trigger: ForceUpdateScreen, not MaintenanceScreen', () => {
    Constants.expoConfig!.version = '0.0.1';
    useConfigStore.setState((s) => ({
      snapshot: { ...s.snapshot, min_supported_version: '9.9.9', maintenance_mode: true },
    }));
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(ForceUpdateScreen).length).toBe(1);
    expect(renderer.root.findAllByType(MaintenanceScreen).length).toBe(0);
  });

  it('is a LIVE read too: an RC push after mount flips it on with no relaunch', async () => {
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(MaintenanceScreen).length).toBe(0);
    // Let Home's own unrelated mount-time async work (e.g. the reduced-motion
    // check) settle before the next `act`, so the RC-push assertion below is
    // the only state update under test.
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      useConfigStore.getState().applySnapshot({ maintenance_mode: true }, Date.now());
    });
    expect(renderer.root.findAllByType(MaintenanceScreen).length).toBe(1);
  });

  it('Retry re-fetches live Remote Config; once ops flips the flag off, the SAME mount clears without a relaunch', async () => {
    useConfigStore.setState((s) => ({ snapshot: { ...s.snapshot, maintenance_mode: true } }));
    firebaseMock.configured = true;
    firebaseMock.remote = { maintenance_mode: { value: 'false' } };
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(MaintenanceScreen).length).toBe(1);

    const retryButton = pressableButtons(renderer)[0]!;
    await act(async () => {
      retryButton.props.onPress!();
      // A real macrotask flush, not a fixed count of microtask ticks —
      // `syncRemoteConfig`'s async chain (fetch, then MaintenanceScreen's
      // own `.finally`) is deeper than any hand-counted number of
      // `Promise.resolve()` awaits reliably drains.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renderer.root.findAllByType(MaintenanceScreen).length).toBe(0);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
  });

  it('the retry button disables itself while checking, so it cannot be double-fired', async () => {
    useConfigStore.setState((s) => ({ snapshot: { ...s.snapshot, maintenance_mode: true } }));
    firebaseMock.configured = true;
    // Still under maintenance after the fetch — proves the "checking" flag
    // is driven by the promise settling, not by a side effect of unmounting.
    firebaseMock.remote = { maintenance_mode: { value: 'true' } };
    const renderer = render(<App />);

    let retryButton = pressableButtons(renderer)[0]!;
    expect(retryButton.props.disabled).not.toBe(true);

    act(() => {
      retryButton.props.onPress!();
    });
    retryButton = pressableButtons(renderer)[0]!;
    expect(retryButton.props.disabled).toBe(true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    retryButton = pressableButtons(renderer)[0]!;
    expect(retryButton.props.disabled).not.toBe(true);
  });
});

afterEach(() => {
  Constants.expoConfig!.version = '0.1.0';
});
