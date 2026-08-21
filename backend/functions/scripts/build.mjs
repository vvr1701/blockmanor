/**
 * Deploy bundle for `backend/functions` — the other half of PRD §8.2's deploy path.
 *
 * The problem this solves: Firebase uploads the functions source directory, runs
 * `npm install` in it, and `require`s its `main`. This package's real
 * `package.json` says `"main": "./src/index.ts"` and depends on
 * `@blockmanor/{engine,content,shared}` as `workspace:*` — Node cannot load
 * TypeScript and npm cannot resolve `workspace:*` outside pnpm, so a raw upload
 * fails on both counts.
 *
 * So: esbuild the entrypoint into ONE `dist/index.js` with the workspace
 * packages (and zod) inlined, and generate a `dist/package.json` carrying only
 * the registry dependencies. `firebase.json` points `functions.source` at
 * `dist/`, so that generated manifest — not this one — is what deploys.
 *
 * `firebase-admin` and `firebase-functions` stay EXTERNAL: they are large, do
 * dynamic/native requires that do not survive bundling, and the Functions
 * runtime expects to install them itself. Their versions are copied verbatim
 * from the real manifest, so they cannot drift from what CI tests against.
 */

import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Bundle everything the workspace owns; let the runtime install the rest. */
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@blockmanor/'));

mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(dist, 'index.js'),
  bundle: true,
  platform: 'node',
  // Matches `firebase.json`'s `"runtime": "nodejs22"`.
  target: 'node22',
  format: 'esm',
  external: external.flatMap((d) => [d, `${d}/*`]),
  sourcemap: true,
  logLevel: 'info',
});

writeFileSync(
  join(dist, 'package.json'),
  `${JSON.stringify(
    {
      name: 'blockmanor-functions',
      version: pkg.version,
      private: true,
      type: 'module',
      main: 'index.js',
      engines: { node: '22' },
      dependencies: Object.fromEntries(external.map((d) => [d, pkg.dependencies[d]])),
    },
    null,
    2,
  )}\n`,
);

console.log(`built ${dist}/index.js (external: ${external.join(', ') || 'none'})`);
