/**
 * `DailyBoardTile` — PRD §7.11(c): "countdown or 'LIVE' state, red badge dot
 * if unplayed today, streak flame chip 🔥N" — and the tile's own contribution
 * to §7.11's three Stage-1 states (default / daily-unplayed / daily-complete,
 * see `homeScreen.states.render.test.tsx` for how `HomeScreen` derives all
 * three from `badges.dailyUnplayed` + `streak`). This file covers the
 * component in isolation: which pieces render in which combination, the
 * §7.11 "max 1 pulse/session" cap (mutation-tested, not just asserted), and
 * WCAG contrast read off the rendered tree for every text/state combination.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';
import { colors } from '../../src/components/tokens';
import { collectTextContrast } from '../contrast';
import { DailyBoardTile } from '../../src/screens/HomeScreen/DailyBoardTile';
import {
  mockAnimationCalls,
  resetMockAnimationCalls,
  setMockReducedMotion,
} from '../mocks/react-native-reanimated';

const TEXT_MIN = 4.5;
/** `HomeScreen`'s screen background — the one thing NOT rendered by this
 * component, matching `endlessCard.render.test.tsx`'s own convention. */
const SCREEN = colors.night;

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

beforeEach(() => {
  resetMockAnimationCalls();
  setMockReducedMotion(false);
});

describe('DailyBoardTile (PRD §7.11(c))', () => {
  it('unplayed: shows the red badge dot and the "New today" seam copy', () => {
    const renderer = render(<DailyBoardTile unplayed streak={0} pulseOnMount={false} />);
    const texts = collectTextContrast(renderer.root, SCREEN).map((c) => c.text);
    expect(texts).toContain('New today');
    // The badge dot is a plain View with an a11y label, not text — assert
    // via the label directly rather than through the text-contrast walk.
    expect(
      renderer.root.findAll((n) => n.props.accessibilityLabel === 'Unplayed today').length,
    ).toBe(1);
  });

  it('complete (not unplayed): no badge dot, "Played today" copy instead', () => {
    const renderer = render(<DailyBoardTile unplayed={false} streak={0} pulseOnMount={false} />);
    const texts = collectTextContrast(renderer.root, SCREEN).map((c) => c.text);
    expect(texts).toContain('Played today');
    expect(texts).not.toContain('New today');
    expect(
      renderer.root.findAll((n) => n.props.accessibilityLabel === 'Unplayed today').length,
    ).toBe(0);
  });

  it('streak chip renders independently of `unplayed` — nonzero streak shows 🔥N either way', () => {
    for (const unplayed of [true, false]) {
      const renderer = render(
        <DailyBoardTile unplayed={unplayed} streak={12} pulseOnMount={false} />,
      );
      const texts = collectTextContrast(renderer.root, SCREEN).map((c) => c.text);
      expect(texts).toContain('🔥12');
    }
  });

  it('streak 0: no flame chip at all (not even an empty one)', () => {
    const renderer = render(<DailyBoardTile unplayed streak={0} pulseOnMount={false} />);
    const texts = collectTextContrast(renderer.root, SCREEN).map((c) => c.text);
    expect(texts.some((t) => t.startsWith('🔥'))).toBe(false);
  });

  it('every text clears the WCAG 4.5:1 normal-text floor, in every state combination', () => {
    for (const unplayed of [true, false]) {
      for (const streak of [0, 5]) {
        const renderer = render(
          <DailyBoardTile unplayed={unplayed} streak={streak} pulseOnMount={false} />,
        );
        const failing = collectTextContrast(renderer.root, SCREEN).filter(
          (c) => c.ratio < TEXT_MIN,
        );
        expect(failing, JSON.stringify({ unplayed, streak, failing })).toEqual([]);
      }
    }
  });

  describe('the mount pulse (mutation-tested)', () => {
    it('unplayed + pulseOnMount: fires the withSequence/withTiming pulse to PULSE_PEAK_SCALE', () => {
      render(<DailyBoardTile unplayed streak={0} pulseOnMount />);
      const pulseCalls = mockAnimationCalls.filter((c) => c.fn === 'withTiming');
      expect(pulseCalls.length).toBeGreaterThan(0);
      expect(pulseCalls[0]!.toValue).toBeGreaterThan(1);
    });

    it('unplayed + pulseOnMount=false: no animation call at all', () => {
      render(<DailyBoardTile unplayed streak={0} pulseOnMount={false} />);
      expect(mockAnimationCalls.length).toBe(0);
    });

    it('NOT unplayed, even with pulseOnMount=true: no pulse — a played tile never draws attention to itself', () => {
      render(<DailyBoardTile unplayed={false} streak={0} pulseOnMount />);
      expect(mockAnimationCalls.length).toBe(0);
    });

    it('OS reduce-motion: no pulse even when unplayed + pulseOnMount', () => {
      setMockReducedMotion(true);
      render(<DailyBoardTile unplayed streak={0} pulseOnMount />);
      expect(mockAnimationCalls.length).toBe(0);
    });
  });
});
