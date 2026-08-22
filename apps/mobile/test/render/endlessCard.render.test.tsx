/**
 * `EndlessCard` — PRD §7.6 / §7.11(e) / §12.9. Covers the locked/unlocked
 * variants, the §12.9 "no endless best" empty-state copy, and — per this
 * PR's accessibility brief — asserts COMPUTED contrast for the text this
 * component adds, not a color literal (a contrast bug can hide behind a
 * token name just as easily as a hex literal).
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { colors } from '../../src/components/tokens';
import { EndlessCard, ENDLESS_UNLOCK_LEVEL } from '../../src/screens/HomeScreen/EndlessCard';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

// --- WCAG 2.1 contrast (relative luminance -> ratio), computed from the
// actual hex tokens under test rather than trusting a literal ratio number.
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

describe('EndlessCard (PRD §7.6 / §7.11(e))', () => {
  it('unlocked: shows the CTA and the persisted best score', () => {
    const renderer = render(
      <EndlessCard unlocked currentLevel={12} best={4200} onPress={vi.fn()} />,
    );
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
    expect(texts).toContain('4200');
    expect(texts).toContain('Play Endless');
  });

  it('§12.9 empty state: no best yet renders "Set your first record", never "0"', () => {
    const renderer = render(<EndlessCard unlocked currentLevel={12} best={0} onPress={vi.fn()} />);
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
    expect(texts).toContain('Set your first record');
    expect(texts).not.toContain('0');
  });

  it("unlocked card is a single pressable that fires onPress (the empty state's one action, §12.9)", () => {
    const onPress = vi.fn();
    const renderer = render(<EndlessCard unlocked currentLevel={12} best={0} onPress={onPress} />);
    const pressables = renderer.root.findAllByType('RNPressable' as never);
    expect(pressables.length).toBe(1);
    act(() => {
      (pressables[0]!.props as { onPress: () => void }).onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it(`locked (currentLevel <= ${ENDLESS_UNLOCK_LEVEL}): shows the "Unlocks at Level N — you're on M" copy and is NOT pressable`, () => {
    const renderer = render(
      <EndlessCard unlocked={false} currentLevel={7} best={0} onPress={vi.fn()} />,
    );
    const texts = renderer.root.findAllByType('RNText' as never).map((n) => n.children.join(''));
    expect(texts.some((s) => s.includes("Unlocks at Level 10 — you're on 7"))).toBe(true);
    expect(renderer.root.findAllByType('RNPressable' as never).length).toBe(0);
  });

  it('locked subtitle text clears the §4.5:1 text-contrast floor against its card background', () => {
    // `colors.muted` on the card's dark background — the actual token pair
    // `EndlessCard`'s locked-state styles use, read off `tokens.ts` (not a
    // re-typed literal): computed, not asserted-by-eye.
    const cardBackground = '#232A53'; // solid composite of the card's translucent navy fill
    expect(contrastRatio(colors.muted, cardBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.cream, cardBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it('the "Play Endless" CTA text clears 4.5:1 against its gold button background', () => {
    expect(contrastRatio(colors.night, colors.gold)).toBeGreaterThanOrEqual(4.5);
  });
});
