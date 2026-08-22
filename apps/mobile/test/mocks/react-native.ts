import { Fragment, createElement, type ReactElement, type ReactNode } from 'react';

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
export const TextInput = 'RNTextInput';
export const ScrollView = 'RNScrollView';

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

/**
 * Minimal `AppState` stand-in — the §14 analytics queue's lifecycle flush
 * (audit MINOR finding) subscribes to `'change'`. Real RN's shape is
 * `addEventListener(event, cb) -> { remove }`; `__emit` is test-only, used
 * to simulate a foreground/background transition without a real app host.
 */
export type AppStateStatus = 'active' | 'background' | 'inactive';
type AppStateListener = (state: AppStateStatus) => void;
const appStateListeners = new Set<AppStateListener>();
export const AppState = {
  currentState: 'active' as AppStateStatus,
  addEventListener(_event: 'change', cb: AppStateListener): { remove: () => void } {
    appStateListeners.add(cb);
    return { remove: () => appStateListeners.delete(cb) };
  },
  /** Test-only: fire a state transition to every current subscriber. */
  __emit(state: AppStateStatus): void {
    AppState.currentState = state;
    for (const cb of appStateListeners) cb(state);
  },
};

/**
 * Minimal `FlatList` stand-in — §7.10's `LevelMapScreen` is the first screen
 * to use one. Real `FlatList` windows its rows; this renders every item, on
 * purpose: a render-tree test needs to be able to FIND a row (the L60 chest,
 * the locked medallions) without simulating scroll. The windowing props
 * (`getItemLayout`, `initialScrollIndex`, `windowSize`) are passed straight
 * through onto the host node so a test can assert the values the component
 * actually handed to the list — which is what makes §7.10's "map scrolls to
 * current level on open" checkable here at all.
 */
interface FlatListLikeProps<T> {
  data: readonly T[] | null | undefined;
  renderItem: (info: { item: T; index: number; separators: unknown }) => ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  [key: string]: unknown;
}

export function FlatList<T>(props: FlatListLikeProps<T>): ReactElement {
  const { data, renderItem, keyExtractor, ...rest } = props;
  const items = (data ?? []).map((item, index) =>
    createElement(
      Fragment,
      { key: keyExtractor ? keyExtractor(item, index) : String(index) },
      renderItem({ item, index, separators: {} }),
    ),
  );
  return createElement('RNFlatList', rest, ...items);
}
