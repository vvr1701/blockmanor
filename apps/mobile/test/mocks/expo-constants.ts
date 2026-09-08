/**
 * Minimal `expo-constants` stand-in for render-tree tests — see
 * vitest.config.ts. `expo-constants` transitively pulls in
 * `expo-modules-core`'s native `EventEmitter`, which throws outside a real
 * Expo runtime.
 *
 * `expoConfig.version`/`expoConfig.android.{package,versionCode}`/
 * `expoConfig.ios.buildNumber` mirror `app.config.ts`'s real fields (§12.5
 * version-gate, §12.1 footer, §12.5 store link-out) — a plain mutable object
 * (same pattern as the RN mock's `AppState.currentState` / `Platform.OS`) so
 * a test can overwrite a field directly and restore it in `afterEach`.
 * `versionCode`/`buildNumber` are typed `| undefined` (not omitted) so a
 * test can assign them without a cast, per `exactOptionalPropertyTypes`.
 */
export default {
  expoConfig: {
    extra: {},
    version: '0.1.0',
    android: {
      package: 'com.vvr1701.blockmanor',
      versionCode: undefined as number | undefined,
    },
    ios: { buildNumber: undefined as string | undefined },
  },
};
