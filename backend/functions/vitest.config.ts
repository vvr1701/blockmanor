import { defineConfig } from 'vitest/config';

/**
 * The default suite: everything that runs on a plain dev box with no JRE and no
 * Firebase CLI. `*.emulator.test.ts` needs the Firestore emulator and is run by
 * `test:emulator` under `firebase emulators:exec` (CI job `emulator`), the same
 * split `packages/content` uses for its balance sweep.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.emulator.test.ts'],
  },
});
