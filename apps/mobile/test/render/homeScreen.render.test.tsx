/**
 * `HomeScreen`'s §7.6 Endless entry card — flag gating, the unlock-gate
 * boundary (below/at/above Level 10 — the exact three points this PR's brief
 * calls out), and the tap wiring to `onPlayEndless`.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { EndlessCard } from '../../src/screens/HomeScreen/EndlessCard';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useMetaStore } from '../../src/state/useMetaStore';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

/** `RemoteConfigSnapshot`'s per-key type is each key's OWN default literal
 * (`(typeof REMOTE_CONFIG_DEFAULTS)[K]`, from an `as const` object) rather
 * than its widened primitive type — a pre-existing `packages/shared`
 * quirk unrelated to §7.6, not something to fix from this PR. This helper
 * is the one narrow cast that works around it for tests. */
function setFlagEndless(on: boolean): void {
  useConfigStore.setState((s) => ({
    snapshot: { ...s.snapshot, flag_endless: on } as typeof s.snapshot,
  }));
}

beforeEach(() => {
  useMetaStore.setState({ currentLevel: 1, endlessBest: 0 });
  setFlagEndless(true);
});

describe('HomeScreen Endless entry (PRD §7.6 / §7.11(e))', () => {
  it('flag_endless off: the card is not rendered at all (not even locked)', () => {
    setFlagEndless(false);
    const renderer = render(<HomeScreen onPlay={() => {}} />);
    expect(renderer.root.findAllByType(EndlessCard).length).toBe(0);
  });

  it.each([
    [5, false],
    [10, false],
    [11, true],
  ])('currentLevel %i -> unlocked=%s (below/at/above the Level-10 gate)', (level, unlocked) => {
    useMetaStore.setState({ currentLevel: level });
    const renderer = render(<HomeScreen onPlay={() => {}} />);
    const card = renderer.root.findByType(EndlessCard);
    expect(card.props.unlocked).toBe(unlocked);
  });

  it('tapping the unlocked card calls onPlayEndless', () => {
    useMetaStore.setState({ currentLevel: 11 });
    const onPlayEndless = vi.fn();
    const renderer = render(<HomeScreen onPlay={() => {}} onPlayEndless={onPlayEndless} />);
    const pressable = renderer.root.findByType(EndlessCard).findByType('RNPressable' as never);
    act(() => {
      (pressable.props as { onPress: () => void }).onPress();
    });
    expect(onPlayEndless).toHaveBeenCalledTimes(1);
  });
});
