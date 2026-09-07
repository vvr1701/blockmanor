/**
 * Minimal `expo-constants` stand-in for render-tree tests — see
 * vitest.config.ts. `expo-constants` transitively pulls in
 * `expo-modules-core`'s native `EventEmitter`, which throws outside a real
 * Expo runtime. Nothing in `src/` imports it today (Firebase moved to the
 * native `@react-native-firebase/*` config), but the alias stays so a
 * transitive import can't drag the native module into a test run.
 */
export default {
  expoConfig: { extra: {} },
};
