/**
 * `OutOfCoinsSheet` — PRD §9.4 step 3 / §16.1. §0 v1.45(e): §10.3's IAP isn't
 * built, so the two bundles are read-only info, and Cancel is the only real
 * control — these tests pin exactly that shape.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { OutOfCoinsSheet } from '../../src/screens/OutOfCoinsSheet';

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

describe('OutOfCoinsSheet (PRD §9.4 step 3)', () => {
  it('shows both bundles with their coin amount and INR price', () => {
    const renderer = render(<OutOfCoinsSheet price={900} onCancel={vi.fn()} />);
    const texts = textsOf(renderer);
    expect(texts).toContain('1,100 🪙');
    expect(texts).toContain('₹89');
    expect(texts).toContain('3,600 🪙');
    expect(texts).toContain('₹269');
  });

  it('highlights the SMALLEST bundle that covers the price — not always the cheapest', () => {
    // 900 ≤ 1,100: the small bundle alone covers it.
    const small = render(<OutOfCoinsSheet price={900} onCancel={vi.fn()} />);
    const smallTags = small.root.findAll(
      (n) => String(n.type) === 'RNText' && n.props.children === 'Covers your continue',
    );
    expect(smallTags).toHaveLength(1);

    // 1,200 > 1,100: only the mid bundle covers it.
    const mid = render(<OutOfCoinsSheet price={1200} onCancel={vi.fn()} />);
    const tags = mid.root.findAll(
      (n) => String(n.type) === 'RNText' && n.props.children === 'Covers your continue',
    );
    expect(tags).toHaveLength(1);
    // The tag sits inside the 3,600-coin card, not the 1,100 one.
    const bundleView = tags[0]!.parent!;
    const bundleTexts = bundleView
      .findAllByType('RNText' as never)
      .map((n) => n.props.children)
      .join(' ');
    expect(bundleTexts).toContain('3,600 🪙');
  });

  it('prices the body copy from the price prop — never a literal', () => {
    const renderer = render(<OutOfCoinsSheet price={1600} onCancel={vi.fn()} />);
    expect(textsOf(renderer)).toContain('You need 1,600 🪙 to continue — grab a bundle to top up.');
  });

  it('a caller can override the body/covers copy (§0 v1.47(c): OutOfLivesSheet reuses this sheet with its own wording)', () => {
    const renderer = render(
      <OutOfCoinsSheet
        price={900}
        onCancel={vi.fn()}
        body="You need 900 🪙 to refill a life — grab a bundle to top up."
        coversLabel="Covers your refill"
      />,
    );
    const texts = textsOf(renderer);
    expect(texts).toContain('You need 900 🪙 to refill a life — grab a bundle to top up.');
    expect(texts).not.toContain('to continue');
    expect(texts).toContain('Covers your refill');
    expect(texts).not.toContain('Covers your continue');
  });

  it('Cancel is the ONLY interactive control, and it fires onCancel', () => {
    const onCancel = vi.fn();
    const renderer = render(<OutOfCoinsSheet price={900} onCancel={onCancel} />);
    const buttons = renderer.root.findAll((n) => n.props.accessibilityRole === 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.props.accessibilityLabel).toBe('Cancel');
    act(() => {
      (buttons[0]!.props as { onPress: () => void }).onPress();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
