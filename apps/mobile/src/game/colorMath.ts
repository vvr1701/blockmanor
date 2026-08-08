/**
 * Tiny hex-color helper — derives the glossy top-highlight / dark-bottom-bevel
 * gradient stops (§15 "Blocks: glossy top highlight, dark bottom bevel") from
 * the single flat hex each §15 block/obstacle color is defined as, instead of
 * hand-authoring 3 stops per color.
 */

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

/** Blends `hex` toward white (`amount` > 0) or black (`amount` < 0), amount in [-1, 1]. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  return toHex([r + (target - r) * t, g + (target - g) * t, b + (target - b) * t]);
}

/** The §15 glossy block look: light top → base color → dark bottom. */
export function glossyGradient(baseHex: string): readonly [string, string, string] {
  return [shade(baseHex, 0.45), baseHex, shade(baseHex, -0.4)];
}

/** Rec. 709 luma coefficients — standard perceptual R/G/B weights for a
 * saturation matrix (used below, not a §15 design token). */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * A Skia `ColorMatrix` (row-major, [R,G,B,A,offset] × 4 rows — same layout as
 * `@shopify/react-native-skia`'s own `OpacityMatrix` helper) that blends
 * toward grayscale. `amount` 0 = original colors (identity), 1 = fully
 * desaturated — PRD §7.4 "desaturate board 400ms" animates this 0 -> 1.
 */
export function desaturationMatrix(amount: number): number[] {
  const s = 1 - Math.max(0, Math.min(1, amount));
  const sr = (1 - s) * LUMA_R;
  const sg = (1 - s) * LUMA_G;
  const sb = (1 - s) * LUMA_B;
  return [sr + s, sg, sb, 0, 0, sr, sg + s, sb, 0, 0, sr, sg, sb + s, 0, 0, 0, 0, 0, 1, 0];
}
