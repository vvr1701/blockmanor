/**
 * `FailScreen`'s §9.4 `continueOffer` prop — separate from
 * `failScreen.render.test.tsx` (which pins the Stage-1 byte-identical
 * default, `continueOffer` omitted) so that file's existing assertions never
 * need to change for this PR.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { GoalBarEntry } from '../../src/game/goalBar';
import { FailScreen } from '../../src/screens/FailScreen';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function textsOf(renderer: ReactTestRenderer): string {
  return [
    ...renderer.root.findAllByType('RNText' as never),
    ...renderer.root.findAllByType('AnimatedText' as never),
  ]
    .map((n) => n.props.children)
    .join(' ');
}

const CRATE_GOAL: GoalBarEntry = { type: 'crate', remaining: 3, total: 12, icon: 'crossPlank' };

const OFFER = {
  streakAtDeath: 0,
  price: 900,
  secondChanceOffered: false,
  busy: false,
  onContinue: vi.fn(),
  onSecondChance: vi.fn(),
  onGiveUp: vi.fn(),
};

describe('FailScreen §9.4 continueOffer', () => {
  it('renders ContinueSheet content and steps Retry/"Level map" aside while it stands', () => {
    const renderer = render(
      <FailScreen
        levelId={24}
        goals={[CRATE_GOAL]}
        onRetry={vi.fn()}
        onLevelMap={vi.fn()}
        continueOffer={OFFER}
      />,
    );
    const texts = textsOf(renderer);
    expect(texts).toContain('Continue — 900 🪙');
    expect(texts).not.toContain('Retry');
    expect(texts).not.toContain('Level map');
    // The goal progress line is still there — §9.4 step 1 keeps it.
    expect(texts).toContain('Crates 9/12');
  });

  it('Give up (via the offer) takes the player back to Retry/Level map on the NEXT render', () => {
    // Simulates `LevelSession`'s own offerDeclined transition: a re-render
    // with `continueOffer` omitted restores Stage-1 content.
    const renderer = render(
      <FailScreen
        levelId={24}
        goals={[CRATE_GOAL]}
        onRetry={vi.fn()}
        onLevelMap={vi.fn()}
        continueOffer={OFFER}
      />,
    );
    act(() => {
      renderer.update(
        <FailScreen levelId={24} goals={[CRATE_GOAL]} onRetry={vi.fn()} onLevelMap={vi.fn()} />,
      );
    });
    const texts = textsOf(renderer);
    expect(texts).toContain('Retry');
    expect(texts).toContain('Level map');
    expect(texts).not.toContain('Continue —');
  });
});
