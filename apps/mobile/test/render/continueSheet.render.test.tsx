/**
 * `ContinueSheet` — PRD §9.4 step 1/4. Pure component tests: pricing display,
 * the second-chance affordance's visibility, the streak flame/give-up-confirm
 * gating on `streakAtDeath`, and that every button fires exactly the callback
 * it owns. `LevelSession`'s wiring (the dry run, the caps, analytics) is
 * covered in `levelSession.continue.render.test.tsx`.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ContinueSheet } from '../../src/screens/ContinueSheet';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

/** Plain `Text` renders as `RNText`; the streak flame uses `Animated.Text`
 * (the mocked reanimated's `'AnimatedText'` tag, see `juiceLayer.render.test.tsx`
 * for the same pattern) — both carry visible copy this file asserts on. */
function textsOf(renderer: ReactTestRenderer): string {
  return [
    ...renderer.root.findAllByType('RNText' as never),
    ...renderer.root.findAllByType('AnimatedText' as never),
  ]
    .map((n) => n.props.children)
    .join(' ');
}

function pressByLabel(renderer: ReactTestRenderer, label: string): void {
  const node = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === label && n.props.accessibilityRole === 'button',
  )[0];
  if (!node) throw new Error(`no button labelled "${label}"`);
  act(() => {
    (node.props as { onPress: () => void }).onPress();
  });
}

const BASE = {
  streakAtDeath: 0,
  price: 900,
  secondChanceOffered: false,
  busy: false,
  onContinue: vi.fn(),
  onSecondChance: vi.fn(),
  onGiveUp: vi.fn(),
};

describe('ContinueSheet (PRD §9.4)', () => {
  it('prices the Continue CTA from the price prop — never a literal elsewhere', () => {
    const renderer = render(<ContinueSheet {...BASE} price={1200} />);
    expect(textsOf(renderer)).toContain('Continue — 1,200 🪙');
  });

  it('Continue fires onContinue; disabled while busy', () => {
    const onContinue = vi.fn();
    const renderer = render(<ContinueSheet {...BASE} onContinue={onContinue} />);
    pressByLabel(renderer, 'Continue — 900 🪙');
    expect(onContinue).toHaveBeenCalledTimes(1);

    const busyRenderer = render(<ContinueSheet {...BASE} onContinue={onContinue} busy />);
    const button = busyRenderer.root.findAll(
      (n) => n.props.accessibilityLabel === 'Continue — 900 🪙',
    )[0]!;
    expect(button.props.accessibilityState.disabled).toBe(true);
  });

  it('Second chance is omitted when not offered, shown and wired when it is', () => {
    const noOffer = render(<ContinueSheet {...BASE} secondChanceOffered={false} />);
    expect(textsOf(noOffer)).not.toContain('Second chance');

    const onSecondChance = vi.fn();
    const offered = render(
      <ContinueSheet {...BASE} secondChanceOffered onSecondChance={onSecondChance} />,
    );
    expect(textsOf(offered)).toContain('Second chance 📺 free');
    pressByLabel(offered, 'Second chance 📺 free');
    expect(onSecondChance).toHaveBeenCalledTimes(1);
  });

  it('no flame and no confirm below win-streak 2 — Give up fires immediately', () => {
    const onGiveUp = vi.fn();
    const renderer = render(<ContinueSheet {...BASE} streakAtDeath={1} onGiveUp={onGiveUp} />);
    expect(textsOf(renderer)).not.toContain('streak');
    pressByLabel(renderer, 'Give up');
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('win-streak ≥2 shows the flame and gates Give up behind a confirm, default keep-trying', () => {
    const onGiveUp = vi.fn();
    const renderer = render(<ContinueSheet {...BASE} streakAtDeath={4} onGiveUp={onGiveUp} />);
    expect(textsOf(renderer)).toContain('🔥 x4 streak');

    pressByLabel(renderer, 'Give up');
    expect(onGiveUp).not.toHaveBeenCalled(); // confirm first, not immediate
    // §0 v1.46(b): never worded as if paying for a continue would save it —
    // the streak is already gone by the time this dialog can show.
    expect(textsOf(renderer)).toContain(
      'Your x4 streak is already gone — give up on this run too?',
    );

    // Default action is "keep trying" — confirming does NOT call onGiveUp.
    pressByLabel(renderer, 'Keep trying');
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(textsOf(renderer)).not.toContain('Give up?');

    // Re-open the confirm and actually leave.
    pressByLabel(renderer, 'Give up');
    pressByLabel(renderer, 'Leave anyway');
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });
});
