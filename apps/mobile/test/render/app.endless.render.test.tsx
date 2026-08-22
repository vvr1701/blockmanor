/**
 * `App`'s Home -> Endless local-state seam (PRD §7.6 entry point). No router
 * exists yet (§7.11 builds the real hub/nav); this only proves tapping the
 * Home Endless card actually reaches `EndlessScreen` and that "Home" comes
 * back, the same way `app.render.test.tsx` proves the FTUE skip logic.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

import App from '../../src/App';
import { EndlessScreen } from '../../src/screens/EndlessScreen';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useMetaStore } from '../../src/state/useMetaStore';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

beforeEach(() => {
  useMetaStore.setState({
    currentLevel: 11,
    endlessBest: 0,
    ftueComplete: true,
    playerName: null,
    avatarId: null,
  });
  useConfigStore.setState((s) => ({ snapshot: { ...s.snapshot, flag_endless: true } }));
});

describe('App Home <-> Endless (PRD §7.6)', () => {
  it('tapping the Endless card on Home mounts EndlessScreen, hiding Home', () => {
    const renderer = render(<App />);
    const pressable = renderer.root.findByType('RNPressable' as never);
    act(() => {
      (pressable.props as { onPress: () => void }).onPress();
    });
    expect(renderer.root.findAllByType(EndlessScreen).length).toBe(1);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(0);
  });

  it("EndlessScreen's onExit returns to Home", () => {
    const renderer = render(<App />);
    act(() => {
      (renderer.root.findByType('RNPressable' as never).props as { onPress: () => void }).onPress();
    });
    const endless = renderer.root.findByType(EndlessScreen);
    act(() => {
      (endless.props as { onExit: () => void }).onExit();
    });
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
    expect(renderer.root.findAllByType(EndlessScreen).length).toBe(0);
  });
});
