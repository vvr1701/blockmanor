/**
 * `App`'s Home -> LevelMap local-state seam (PRD §0 v1.18's §7.11(a) map
 * affordance). Same shape as `app.endless.render.test.tsx`: no router exists
 * yet, so this proves tapping Home's HUD map icon actually reaches
 * `LevelMapScreen` through the SAME `mapOpen` seam §7.5's FailScreen ghost
 * already used, and that its exit returns to Home.
 */
import { MAX_LEVEL_ID } from '@blockmanor/content';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

import App from '../../src/App';
import en from '../../src/i18n/en.json';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { LevelMapScreen } from '../../src/screens/LevelMapScreen';
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
    currentLevel: 12,
    ftueComplete: true,
    playerName: null,
    avatarId: null,
    chestsClaimed: {},
    stars: {},
  });
});

describe('App Home <-> LevelMap via the HUD map affordance (PRD §0 v1.18)', () => {
  it('tapping the HUD map icon on Home mounts LevelMapScreen, hiding Home', () => {
    const renderer = render(<App />);
    const map = renderer.root.findByProps({
      accessibilityLabel: 'Level map, a chest is ready to open',
    });
    act(() => {
      (map.props as { onPress: () => void }).onPress();
    });
    expect(renderer.root.findAllByType(LevelMapScreen).length).toBe(1);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(0);
  });

  it("LevelMapScreen's onExit returns to Home (§12.9 — never a dead end)", () => {
    const renderer = render(<App />);
    act(() => {
      (
        renderer.root.findByProps({ accessibilityLabel: 'Level map, a chest is ready to open' })
          .props as { onPress: () => void }
      ).onPress();
    });
    act(() => {
      (renderer.root.findByType(LevelMapScreen).props as { onExit: () => void }).onExit();
    });
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
    expect(renderer.root.findAllByType(LevelMapScreen).length).toBe(0);
  });
});

describe('App Home content-ceiling CTA (PRD §0 v1.23 — qa-prd-auditor blocker fix)', () => {
  it('past MAX_LEVEL_ID, pressing the primary CTA reaches the map, not a no-op level mount', () => {
    // Real store state a win at L60 actually persists (§7.10 fix) —
    // MAX_LEVEL_ID + 1, driven through the real <App/> tree, not a mocked
    // onPress spy: the bug this guards was that `getLevel(61)` is
    // `undefined`, so mounting LevelSession for it silently bounced back to
    // Home — a press that visibly did nothing.
    useMetaStore.setState({ currentLevel: MAX_LEVEL_ID + 1 });
    const renderer = render(<App />);
    const cta = renderer.root.findByProps({ accessibilityLabel: en['map.allShippedLine'] });
    act(() => {
      (cta.props as { onPress: () => void }).onPress();
    });
    expect(renderer.root.findAllByType(LevelMapScreen).length).toBe(1);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(0);
  });
});
