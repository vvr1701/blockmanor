/**
 * Minimal `@shopify/react-native-skia` stand-in for render-tree tests — see
 * vitest.config.ts. The real mock ships by the library itself
 * (`jestSetup.js`/`jestEnv.js`) needs `canvaskit-wasm` loaded into a jest
 * environment; that's real device-fidelity infra this session doesn't need —
 * every board/tray/drag component here only builds a Skia *scene graph*
 * (React elements), never touches a GPU surface in a unit test, so plain
 * string host tags are enough to prove the tree builds without throwing.
 */

import { createElement, isValidElement, type ReactNode } from 'react';

export const Canvas = 'SkCanvas';
export const Circle = 'SkCircle';
export const Path = 'SkPath';
export const RoundedRect = 'SkRoundedRect';
export const Rect = 'SkRect';
export const Text = 'SkText';
export const LinearGradient = 'SkLinearGradient';
export const Shadow = 'SkShadow';
export const Paint = 'SkPaint';
export const ColorMatrix = 'SkColorMatrix';

/**
 * The real `Group`'s `layer` prop accepts EITHER a plain paint value or a
 * React element (`<Paint><ColorMatrix .../></Paint>`) — when it's an
 * element, real react-native-skia wraps it as `<skLayer>{layer}<skGroup/>
 * </skLayer>` so the paint (and any color filter inside it) actually shows
 * up as a node in the tree (§7.4 board-desaturate depends on exactly this —
 * `BoardCanvas`'s own `<Group layer={<Paint><ColorMatrix/></Paint>}>`).
 * Mirrors `Group.tsx`'s own `isValidElement` branch; every OTHER caller
 * (no `layer`, the overwhelming majority — every `DragLayer`/`BoardCanvas`
 * `transform`/`opacity` group) still resolves to a single plain `SkGroup`
 * host node, unchanged from before.
 */
export function Group({
  layer,
  ...props
}: { layer?: ReactNode } & Record<string, unknown>): ReactNode {
  if (isValidElement(layer)) {
    return createElement('SkLayer', null, layer, createElement('SkGroup', props));
  }
  return createElement('SkGroup', { layer, ...props });
}

export interface SkFont {
  measureText(text: string): { width: number; height: number };
}

export function vec(x: number, y: number): { x: number; y: number } {
  return { x, y };
}

export function matchFont(): SkFont {
  return { measureText: () => ({ width: 8, height: 10 }) };
}
