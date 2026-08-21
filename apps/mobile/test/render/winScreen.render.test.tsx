/**
 * `WinScreen` — PRD §7.5: "stars ..., score, 'Next level' CTA." Pure
 * presentational component tests (star fill count, score display, the
 * "Next level" CTA firing `onNext`) — the star COMPUTATION itself (engine
 * `starsFor` at/around the `s2`/`s3` thresholds, including the §7.1 FTUE
 * `{s2:0,s3:0}` unconditional-3-star case) is covered in
 * `test/scoring.stars.test.ts`, since that's a property of the engine's
 * public contract, not of this screen.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { WinScreen } from '../../src/screens/WinScreen';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

describe('WinScreen (PRD §7.5)', () => {
  it('fills exactly `stars` of the 3 star glyphs', () => {
    const renderer = render(<WinScreen score={1234} stars={2} onNext={vi.fn()} />);
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.props.children);
    expect(texts.filter((c) => c === '★').length).toBe(2);
    expect(texts.filter((c) => c === '☆').length).toBe(1);
  });

  it('shows the score with tabular numerals', () => {
    const renderer = render(<WinScreen score={9180} stars={3} onNext={vi.fn()} />);
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.props.children);
    expect(texts).toContain(9180);
  });

  it('"Next level" fires onNext', () => {
    const onNext = vi.fn();
    const renderer = render(<WinScreen score={100} stars={1} onNext={onNext} />);
    const button = renderer.root.findAll((n) => n.props.accessibilityRole === 'button')[0];
    act(() => {
      (button!.props as { onPress: () => void }).onPress();
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('§7.1 FTUE unconditional-3-star case renders all 3 filled', () => {
    const renderer = render(<WinScreen score={1} stars={3} onNext={vi.fn()} />);
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.props.children);
    expect(texts.filter((c) => c === '★').length).toBe(3);
    expect(texts.filter((c) => c === '☆').length).toBe(0);
  });
});
