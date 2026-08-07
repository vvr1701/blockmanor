/**
 * Minimal `react-native` stand-in for render-tree tests — see vitest.config.ts.
 * Host components collapse to plain string tags (a valid React element `type`
 * that `react-test-renderer` records as a host node without trying to call it
 * as a component), which is all a structural smoke test needs.
 */
export const View = 'RNView';
export const Text = 'RNText';
export const Pressable = 'RNPressable';
export const SafeAreaView = 'RNSafeAreaView';

export const StyleSheet = {
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles;
  },
};

export function useWindowDimensions(): {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
} {
  return { width: 390, height: 844, scale: 2, fontScale: 1 };
}

export interface LayoutRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LayoutChangeEvent {
  nativeEvent: { layout: LayoutRectangle };
}

export const AccessibilityInfo = {
  isReduceMotionEnabled: (): Promise<boolean> => Promise.resolve(false),
  addEventListener: (): { remove: () => void } => ({ remove: () => undefined }),
};
