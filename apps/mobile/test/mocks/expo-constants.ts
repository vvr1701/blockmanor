/**
 * Minimal `expo-constants` stand-in for render-tree tests — see
 * vitest.config.ts. `expo-constants` transitively pulls in
 * `expo-modules-core`'s native `EventEmitter`, which throws outside a real
 * Expo runtime.
 *
 * `expoConfig.version`/`expoConfig.android.package` mirror `app.config.ts`'s
 * real values (§12.5 version-gate, §12.1 footer, §12.5 store link-out) — a
 * plain mutable object (same pattern as the RN mock's `AppState.currentState`
 * / `Platform.OS`) so a test can overwrite `.version` directly and restore it
 * in `afterEach`.
 */
export default {
  expoConfig: { extra: {}, version: '0.1.0', android: { package: 'com.vvr1701.blockmanor' } },
};
