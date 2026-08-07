import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * §7.3 prereq: "add tests that actually render the tree" — until now every
 * mobile test was pure-module (no React import at all), which is how the
 * §7.2 tray-overflow bug reached QA. RN/Skia/Reanimated/gesture-handler ship
 * as native modules (or Flow-syntax source Metro's babel preset transforms,
 * which plain esbuild/Vite can't parse) — neither runs under vitest as-is,
 * and pulling in the real native/jest toolchain (canvaskit-wasm, a jest
 * environment, @testing-library/react-native) is a much bigger lift than
 * this session's scope. These aliases point every native import at a small
 * hand-written stand-in (`test/mocks/`) — real host components collapse to
 * plain string tags, so `react-test-renderer` (below) builds an ACTUAL
 * reconciled React tree: hooks run, JSX resolves, conditional rendering
 * executes — exactly the class of bug (wrong child count, crash on a given
 * state, wrong prop math) a pure-module test can't catch.
 */
const mocks = path.resolve(__dirname, 'test/mocks');

export default defineConfig({
  test: {
    setupFiles: [path.resolve(__dirname, 'test/setup.ts')],
  },
  resolve: {
    alias: {
      'react-native': path.resolve(mocks, 'react-native.ts'),
      '@shopify/react-native-skia': path.resolve(mocks, 'react-native-skia.ts'),
      'react-native-reanimated': path.resolve(mocks, 'react-native-reanimated.ts'),
      'react-native-gesture-handler': path.resolve(mocks, 'react-native-gesture-handler.ts'),
      'react-native-safe-area-context': path.resolve(mocks, 'react-native-safe-area-context.ts'),
      'expo-haptics': path.resolve(mocks, 'expo-haptics.ts'),
      'expo-status-bar': path.resolve(mocks, 'expo-status-bar.ts'),
    },
  },
});
