/**
 * Minimal `expo-constants` stand-in for render-tree tests — see
 * vitest.config.ts. `expo-constants` transitively pulls in
 * `expo-modules-core`'s native `EventEmitter`, which throws outside a real
 * Expo runtime; `services/firebase.ts` only ever reads `expoConfig.extra`,
 * so that's all this needs to provide.
 */
export default {
  expoConfig: { extra: {} },
};
