import { defineConfig } from 'vitest/config';

// PRD §7.9: the 500-seed balance sweep. Split from `pnpm test` because it is
// minutes of CPU, not seconds — it runs as its own CI job.
export default defineConfig({
  test: { include: ['balance/*.bal.ts', 'balance/**/*.bal.ts'], testTimeout: 600_000 },
});
