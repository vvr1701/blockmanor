/**
 * `OutOfLivesSheet` — PRD §9.2 / §16.1 (§0 v1.47(a)). Pure component tests:
 * the countdown display, the priced Refill CTA, busy-disables-both-controls,
 * and that each control fires exactly the callback it owns. `LevelSession`'s
 * wiring (the gate itself, the refill spend, auto-unblock) is covered in
 * `levelSession.outOfLives.render.test.tsx`.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { OutOfLivesSheet } from '../../src/screens/OutOfLivesSheet';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function textsOf(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAllByType('RNText' as never)
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
  now: 1_000,
  nextLifeAt: 1_000 + 299_000,
  price: 900,
  busy: false,
  onRefill: vi.fn(),
  onCancel: vi.fn(),
};

describe('OutOfLivesSheet (PRD §9.2)', () => {
  it('prices the Refill CTA from the price prop — never a literal', () => {
    const renderer = render(<OutOfLivesSheet {...BASE} price={1234} />);
    expect(textsOf(renderer)).toContain('Refill — 1,234 🪙');
  });

  it('shows a mm:ss countdown to nextLifeAt, derived from now — never a literal', () => {
    const renderer = render(<OutOfLivesSheet {...BASE} now={1_000} nextLifeAt={1_000 + 65_000} />);
    expect(textsOf(renderer)).toContain('Next life in 1:05');
  });

  it('rounds up to the second rather than showing 0:00 while time remains', () => {
    const renderer = render(<OutOfLivesSheet {...BASE} now={1_000} nextLifeAt={1_500} />);
    expect(textsOf(renderer)).toContain('Next life in 0:01');
  });

  it('shows no countdown line when nextLifeAt is null', () => {
    const renderer = render(<OutOfLivesSheet {...BASE} nextLifeAt={null} />);
    expect(textsOf(renderer)).not.toContain('Next life');
  });

  it('Refill fires onRefill; Cancel fires onCancel', () => {
    const onRefill = vi.fn();
    const onCancel = vi.fn();
    const renderer = render(<OutOfLivesSheet {...BASE} onRefill={onRefill} onCancel={onCancel} />);
    pressByLabel(renderer, 'Refill — 900 🪙');
    expect(onRefill).toHaveBeenCalledTimes(1);
    pressByLabel(renderer, 'Cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('busy disables BOTH controls', () => {
    const renderer = render(<OutOfLivesSheet {...BASE} busy />);
    const refill = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === 'Refill — 900 🪙',
    )[0]!;
    const cancel = renderer.root.findAll((n) => n.props.accessibilityLabel === 'Cancel')[0]!;
    expect(refill.props.accessibilityState.disabled).toBe(true);
    expect(cancel.props.accessibilityState.disabled).toBe(true);
  });
});
