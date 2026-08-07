/**
 * Minimal `@shopify/react-native-skia` stand-in for render-tree tests — see
 * vitest.config.ts. The real mock ships by the library itself
 * (`jestSetup.js`/`jestEnv.js`) needs `canvaskit-wasm` loaded into a jest
 * environment; that's real device-fidelity infra this session doesn't need —
 * every board/tray/drag component here only builds a Skia *scene graph*
 * (React elements), never touches a GPU surface in a unit test, so plain
 * string host tags are enough to prove the tree builds without throwing.
 */

export const Canvas = 'SkCanvas';
export const Group = 'SkGroup';
export const Circle = 'SkCircle';
export const Path = 'SkPath';
export const RoundedRect = 'SkRoundedRect';
export const Text = 'SkText';
export const LinearGradient = 'SkLinearGradient';
export const Shadow = 'SkShadow';

export interface SkFont {
  measureText(text: string): { width: number; height: number };
}

export function vec(x: number, y: number): { x: number; y: number } {
  return { x, y };
}

export function matchFont(): SkFont {
  return { measureText: () => ({ width: 8, height: 10 }) };
}
