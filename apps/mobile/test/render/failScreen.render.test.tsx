/**
 * `FailScreen` — PRD §7.5: "'Out of space!' + goal progress shown ('Crates
 * 9/12 — so close!') + Retry (free, unlimited in Stage 1) + 'Level map'
 * ghost. NO monetization yet, but layout MUST reserve the continue-button
 * slot (§9.4 drops in without redesign)."
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { GoalBarEntry } from '../../src/game/goalBar';
import { FailScreen } from '../../src/screens/FailScreen';
import { CONTINUE_SLOT_RESERVED_HEIGHT } from '../../src/screens/FailScreen/failTokens';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

const CRATE_GOAL: GoalBarEntry = { type: 'crate', remaining: 3, total: 12, icon: 'crossPlank' };

describe('FailScreen (PRD §7.5)', () => {
  it('renders the PRD\'s exact-spirit goal progress line ("Crates 9/12")', () => {
    const renderer = render(
      <FailScreen levelId={24} goals={[CRATE_GOAL]} onRetry={vi.fn()} onLevelMap={vi.fn()} />,
    );
    const texts = renderer.root
      .findAllByType('RNText' as never)
      .map((n) => n.props.children)
      .join(' ');
    expect(texts).toContain('Crates 9/12');
    expect(texts).toContain('So close!');
  });

  it('Retry fires onRetry, "Level map" fires onLevelMap', () => {
    const onRetry = vi.fn();
    const onLevelMap = vi.fn();
    const renderer = render(
      <FailScreen levelId={24} goals={[CRATE_GOAL]} onRetry={onRetry} onLevelMap={onLevelMap} />,
    );
    const retry = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === 'Retry' && n.props.accessibilityRole === 'button',
    )[0];
    act(() => {
      (retry!.props as { onPress: () => void }).onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onLevelMap).not.toHaveBeenCalled();

    const levelMap = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === 'Level map' && n.props.accessibilityRole === 'button',
    )[0];
    act(() => {
      (levelMap!.props as { onPress: () => void }).onPress();
    });
    expect(onLevelMap).toHaveBeenCalledTimes(1);
  });

  it('reserves the §9.4 continue slot — a fixed-height gap with no content, no "Continue" anywhere', () => {
    const renderer = render(
      <FailScreen levelId={24} goals={[CRATE_GOAL]} onRetry={vi.fn()} onLevelMap={vi.fn()} />,
    );
    const texts = renderer.root
      .findAllByType('RNText' as never)
      .map((n) => n.props.children)
      .join(' ');
    expect(texts).not.toContain('Continue');

    const slot = renderer.root
      .findAllByType('RNView' as never)
      .find((n) => n.props.style?.height === CONTINUE_SLOT_RESERVED_HEIGHT);
    expect(slot).toBeDefined();
    expect(slot!.children.length).toBe(0);
  });

  it('renders with no goals (goal-less config) without a goal block', () => {
    const renderer = render(
      <FailScreen levelId={1} goals={[]} onRetry={vi.fn()} onLevelMap={vi.fn()} />,
    );
    const texts = renderer.root
      .findAllByType('RNText' as never)
      .map((n) => n.props.children)
      .join(' ');
    expect(texts).not.toContain('So close!');
  });
});
