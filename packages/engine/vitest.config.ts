import { defineConfig } from 'vitest/config';

// PRD §6.8: engine coverage ≥90% lines — enforced here so `pnpm test` is the gate.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 90 },
    },
  },
});
