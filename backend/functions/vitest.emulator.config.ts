import { defineConfig } from 'vitest/config';

/**
 * Emulator-only suite. Must be launched inside `firebase emulators:exec --only
 * firestore`, which exports FIRESTORE_EMULATOR_HOST; the tests fail loudly if it
 * is missing rather than silently passing against nothing.
 *
 * Single-threaded: the rules suite calls `clearFirestore()` between tests, so
 * parallel files sharing one emulator would race.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.emulator.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
