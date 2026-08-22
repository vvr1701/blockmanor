/**
 * `FailScreen` — PRD §7.5: "'Out of space!' + goal progress shown ('Crates
 * 9/12 — so close!') + Retry (free, unlimited in Stage 1) + 'Level map'
 * ghost. NO monetization yet, but layout MUST reserve the continue-button
 * slot (§9.4 drops in without redesign)."
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { colors } from '../../src/components/tokens';
import type { GoalBarEntry } from '../../src/game/goalBar';
import { FailScreen } from '../../src/screens/FailScreen';
import { CONTINUE_SLOT_RESERVED_HEIGHT } from '../../src/screens/FailScreen/failTokens';

/**
 * WCAG sRGB relative-luminance contrast, `rgba(r,g,b,a)` or `#rrggbb`
 * composited over an opaque background (§7.5 re-audit item 2 — a literal
 * color-string assertion caught the exact shipped bug but would pass any
 * other under-contrast tint, e.g. `rgba(240,230,210,…)`).
 */
function parseColor(c: string): [number, number, number, number] {
  const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(c);
  if (rgba) {
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] ? Number(rgba[4]) : 1];
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  throw new Error(`unparseable color: ${c}`);
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast of `fg` (composited over `bg` if `fg` carries alpha) against `bg`. */
function contrastAgainst(fg: string, bg: string): number {
  const [fr, fg_, fb, fa] = parseColor(fg);
  const [br, bgG, bb] = parseColor(bg);
  const composited: [number, number, number] = [
    fr * fa + br * (1 - fa),
    fg_ * fa + bgG * (1 - fa),
    fb * fa + bb * (1 - fa),
  ];
  const l1 = relLuminance(composited);
  const l2 = relLuminance([br, bgG, bb]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it('gates "So close!" on real progress — not shown at 0% (§7.5 audit mn-3)', () => {
    const noProgress: GoalBarEntry = {
      type: 'crate',
      remaining: 12,
      total: 12,
      icon: 'crossPlank',
    };
    const renderer = render(
      <FailScreen levelId={24} goals={[noProgress]} onRetry={vi.fn()} onLevelMap={vi.fn()} />,
    );
    const texts = renderer.root
      .findAllByType('RNText' as never)
      .map((n) => n.props.children)
      .join(' ');
    expect(texts).toContain('Crates 0/12');
    expect(texts).not.toContain('So close!');
  });

  it('the "Level map" ghost has REAL contrast against the cream card, not cream-on-cream (§7.5 audit M-3)', () => {
    const renderer = render(
      <FailScreen levelId={24} goals={[CRATE_GOAL]} onRetry={vi.fn()} onLevelMap={vi.fn()} />,
    );
    const levelMap = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === 'Level map' && n.props.accessibilityRole === 'button',
    )[0]!;

    // `Pressable.style` is a render-prop (`({pressed}) => [...]`) — resolve
    // it the same way RN itself would for the un-pressed state.
    const resolvedStyle = (
      levelMap.props.style as (state: { pressed: boolean }) => Array<Record<string, unknown> | null>
    )({ pressed: false });
    const borderColor = resolvedStyle.find((s) => s?.borderColor)?.borderColor as
      string | undefined;
    expect(borderColor).toBeDefined();
    // The bug: `GhostButton`'s only palette was `colors.cream` at reduced
    // opacity — invisible on this screen's `colors.cream` card. Assert real
    // contrast, not a literal color string (§7.5 re-audit item 2) — a
    // string check catches only the exact shipped bug and lets any other
    // under-contrast tint (e.g. `rgba(240,230,210,…)`) through. Border is
    // non-text: WCAG minimum is 3:1.
    expect(contrastAgainst(borderColor!, colors.cream)).toBeGreaterThanOrEqual(3);

    const label = levelMap.findByType('RNText' as never);
    const labelStyle = label.props.style as Array<Record<string, unknown>>;
    const labelColor = labelStyle.find((s) => s?.color)?.color as string;
    expect(labelColor).toBeDefined();
    // Label is text: WCAG minimum is 4.5:1.
    expect(contrastAgainst(labelColor, colors.cream)).toBeGreaterThanOrEqual(4.5);
  });
});
