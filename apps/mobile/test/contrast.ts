/**
 * Contrast assertions that read the RENDERED TREE (PRD §15 accessibility).
 *
 * The point of this file, per the §7.6 audit: a contrast test that re-types a
 * hex literal and asserts a token pair it merely ASSUMES the component uses is
 * not a regression guard — it survives the two mutations that matter (change
 * the component's text color, change the component's background). So nothing
 * here takes a color as input: `collectTextContrast` walks the actual
 * react-test-renderer tree, composites every translucent `backgroundColor` it
 * passes through, and reports the effective ratio for every `RNText` it finds.
 *
 * WCAG 2.1 relative luminance / contrast ratio, computed — never a literal
 * ratio number.
 */

import type { ReactTestInstance } from 'react-test-renderer';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `#RRGGBB`, `rgb(r,g,b)`, `rgba(r,g,b,a)`. Anything else is a bug in the
 * style under test (or an unsupported format) and throws rather than silently
 * scoring a color nobody checked. */
export function parseColor(css: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const h = hex[1]!;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(css.trim());
  if (fn) {
    const parts = fn[1]!.split(',').map((p) => Number(p.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts.length > 3 ? parts[3]! : 1 };
    }
  }
  throw new Error(`unsupported color in rendered style: ${css}`);
}

function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Source-over composite of `fg` (possibly translucent) onto an OPAQUE `bg`.
 *
 * `extraAlpha` is the accumulated `style.opacity` of the ancestor chain. RN's
 * `opacity` dims a view AND its whole subtree, so it multiplies into the
 * source alpha rather than replacing it. A walker that ignores it reports the
 * undimmed ratio — which is how two sub-floor `FailScreen` texts scored a fake
 * 14.62:1 while the device rendered 4.34:1 and 3.76:1 (§12.2 audit).
 */
export function composite(fg: string, bg: string, extraAlpha = 1): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const a = f.a * extraAlpha;
  return toHex({
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
    a: 1,
  });
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = parseColor(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** Both arguments must already be opaque (`composite` them first). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

type Style = Record<string, unknown>;

/**
 * RN accepts a style object, an array, or nested arrays with falsy holes —
 * and, on `Pressable`, a `({ pressed }) => style` FUNCTION.
 *
 * This file is FORKED: an older copy without the function case lives on other
 * feature branches, and that copy is not wrong on them — nothing they render
 * uses a function style (`GoldButton`/`GhostButton`, which set their fill
 * inside one, arrive with §7.5). Nor does the older walker skip silently: an
 * unresolved function style yields `{}`, the label is scored against the
 * surface BEHIND the button, and the suite fails loudly with an impossible
 * 1.00:1. The hazard is that the walker and the components it walks drift on
 * either branch, so the resolution belongs in whichever copy merges last —
 * this one — rather than being re-derived from a red run later. Resolved in
 * the resting (`pressed: false`) state, which is the state a contrast check
 * is about.
 */
export function flattenStyle(style: unknown): Style {
  if (typeof style === 'function') {
    return flattenStyle((style as (s: { pressed: boolean }) => unknown)({ pressed: false }));
  }
  if (Array.isArray(style)) {
    return style.reduce<Style>((acc, s) => Object.assign(acc, flattenStyle(s)), {});
  }
  if (style && typeof style === 'object') return style as Style;
  return {};
}

export interface TextContrast {
  /** The rendered string, for readable failure messages. */
  text: string;
  /** Effective (composited) text color. */
  color: string;
  /** Effective (composited) background behind that text. */
  background: string;
  ratio: number;
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
}

/**
 * Every `RNText` under `node` that sets a color, with the ratio against the
 * real background stack: each ancestor's `backgroundColor` is composited in
 * order, starting from `backdrop` (the opaque screen background).
 */
export function collectTextContrast(node: ReactTestInstance, backdrop: string): TextContrast[] {
  const out: TextContrast[] = [];
  // `opacity` accumulates DOWN the tree: nested opacities multiply, and a
  // container's opacity dims everything it contains, not just its own paint.
  const visit = (n: ReactTestInstance, bg: string, opacity: number): void => {
    const style = flattenStyle((n.props as { style?: unknown }).style);
    const alpha = typeof style.opacity === 'number' ? opacity * style.opacity : opacity;
    const own =
      typeof style.backgroundColor === 'string' ? composite(style.backgroundColor, bg, alpha) : bg;
    if (String(n.type) === 'RNText' && typeof style.color === 'string') {
      const color = composite(style.color, own, alpha);
      out.push({ text: textOf(n), color, background: own, ratio: contrastRatio(color, own) });
    }
    for (const child of n.children) {
      if (typeof child !== 'string') visit(child, own, alpha);
    }
  };
  visit(node, backdrop, 1);
  return out;
}

/**
 * The composited background of the first host node under `node` that paints
 * one — i.e. the surface a card/sheet actually draws, read off the tree.
 */
export function surfaceBackground(node: ReactTestInstance, backdrop: string): string {
  const hosts = node.findAll(
    (n) =>
      typeof n.type === 'string' && typeof flattenStyle(n.props.style).backgroundColor === 'string',
  );
  const first = hosts[0];
  if (!first) throw new Error('no host node with a backgroundColor found');
  return composite(String(flattenStyle(first.props.style).backgroundColor), backdrop);
}
