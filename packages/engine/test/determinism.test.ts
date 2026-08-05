/**
 * Determinism — PRD §4.3, §6.8, and the Stage-0 DoD (§5):
 * "simulate() reproduces 1,000 fuzzed games identically across two runs".
 *
 * This is the anti-cheat foundation (§8.5): the client submits its move log and
 * the server re-simulates. Anything non-deterministic in the engine fails here.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOARD_SIZE } from '../src/board';
import { validateLevel } from '../src/levels';
import type { Move } from '../src/placement';
import { createRng, fnv1a, nextInt } from '../src/rng';
import { simulate, type FinalResult, type GameConfig, type GameMode } from '../src/simulate';
import { config, randomPlaythrough, TUNING } from './helpers';

interface GoldenCase {
  name: string;
  seed: string;
  config: GameConfig;
  moves: Move[];
  result: FinalResult;
}

const GOLDEN_PATH = fileURLToPath(new URL('./fixtures/golden.json', import.meta.url));
const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenCase[];

const MODES: readonly GameMode[] = ['level', 'endless', 'daily'];
const OBSTACLES = ['crate', 'crate2', 'chain', 'ivy', 'heirloom'] as const;

/** Deterministic per-game config: mode, obstacle prefill, goals and star thresholds from `i`. */
function fuzzConfig(i: number): GameConfig {
  const mode = MODES[i % MODES.length] ?? 'endless';
  if (mode === 'endless') return config('endless');

  const rng = createRng(`cfg-${i}`);
  const cells = new Map<string, string>();
  const prefillCount = nextInt(rng, 13);
  for (let n = 0; n < prefillCount; n++) {
    const r = nextInt(rng, BOARD_SIZE);
    const c = nextInt(rng, BOARD_SIZE);
    cells.set(`${r},${c}`, OBSTACLES[nextInt(rng, OBSTACLES.length)] ?? 'crate');
  }
  const prefill = [...cells].map(([key, type]) => {
    const [r, c] = key.split(',').map(Number);
    return { r, c, type };
  });

  const goalType = OBSTACLES[nextInt(rng, OBSTACLES.length)] ?? 'crate';
  const goals =
    mode === 'level' && goalType !== 'crate2'
      ? [{ type: goalType, count: 1 + nextInt(rng, 4) }]
      : [];

  return config(mode, {
    level: validateLevel({
      id: i,
      chapter: 1,
      seedSalt: `F${i}`,
      prefill,
      goals,
      stars: { s2: 400, s3: 900 },
      pieceWeightOverrides: i % 7 === 0 ? { P11: 0 } : {},
      mercy: i % 5 !== 0,
    }),
  });
}

interface FuzzGame {
  config: GameConfig;
  seed: string;
  moves: Move[];
  result: FinalResult;
}

function fuzzRun(games: number): FuzzGame[] {
  return Array.from({ length: games }, (_, i) => {
    const cfg = fuzzConfig(i);
    const seed = `fuzz-${i}`;
    const { moves, result } = randomPlaythrough(cfg, seed, `bot-${i}`);
    return { config: cfg, seed, moves, result };
  });
}

describe('determinism fuzz (Stage-0 DoD, PRD §5 + §6.8)', () => {
  it('reproduces 1,000 fuzzed games identically across two runs', () => {
    const runA = fuzzRun(1000);
    const runB = fuzzRun(1000);

    const serialize = (games: FuzzGame[]): string => JSON.stringify(games);
    expect(serialize(runB)).toBe(serialize(runA));

    // And replaying each move log through simulate() must land on the same result.
    for (const game of runA) {
      expect(simulate(game.config, game.seed, game.moves), game.seed).toEqual(game.result);
    }

    const moves = runA.reduce((sum, g) => sum + g.moves.length, 0);
    const won = runA.filter((g) => g.result.status === 'won').length;
    const corpusHash = fnv1a(serialize(runA)).toString(16);
    console.log(`[fuzz] games=1000 moves=${moves} won=${won} corpusHash=${corpusHash}`);

    // Pinned, not merely logged. The two runs above are same-process, so they
    // cannot catch a cross-runtime regression — but §5's Stage-0 DoD and §8.5
    // (device vs Cloud Function) are exactly about cross-runtime reproduction.
    // This constant is what makes a different Node, OS or engine build fail.
    // Regenerate ONLY under a PRD amendment, like the golden fixtures.
    expect({ corpusHash, moves, won }).toEqual({
      corpusHash: '392ad7a4',
      moves: 20659,
      won: 38,
    });
  });

  it('never depends on ambient state — a fresh process order does not matter', () => {
    const cfg = fuzzConfig(1);
    const { moves } = randomPlaythrough(cfg, 'order', 'order-bot');
    const forwards = simulate(cfg, 'order', moves);
    // Interleave an unrelated game; the second replay must be unaffected.
    randomPlaythrough(fuzzConfig(2), 'noise', 'noise-bot');
    expect(simulate(cfg, 'order', moves)).toEqual(forwards);
  });
});

describe('golden replay fixtures (PRD §4.3)', () => {
  it('replays byte-identically to the committed fixtures', () => {
    const cases = golden;

    // Regenerate after a *PRD-amended* rule change: UPDATE_GOLDEN=1 pnpm --filter @blockmanor/engine test
    if (process.env.UPDATE_GOLDEN === '1') {
      // Belt and braces: regeneration is a local, deliberate act. If this ever
      // ran in CI the suite would rewrite the spec it is supposed to enforce
      // and still report green.
      expect(process.env.CI, 'UPDATE_GOLDEN must never run in CI').toBeFalsy();
      const regenerated = cases.map((c) => ({ ...c, result: simulate(c.config, c.seed, c.moves) }));
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(regenerated, null, 2)}\n`);
    }

    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const result = simulate(c.config, c.seed, c.moves);
      // Byte-stable, not merely deep-equal: key order and number formatting are locked.
      expect(JSON.stringify(result), c.name).toBe(JSON.stringify(c.result));
    }
  });

  it('rejects a tampered move log (§8.5 anti-cheat)', () => {
    const [first] = golden;
    if (!first) throw new Error('no fixtures');
    const tampered = first.moves.map((m, i) => (i === first.moves.length - 1 ? { ...m, r: 7 } : m));

    // Either the tampered move is illegal, or it replays to a different result —
    // both are a rejection on the server (§8.5).
    let mismatch = false;
    try {
      mismatch =
        JSON.stringify(simulate(first.config, first.seed, tampered)) !==
        JSON.stringify(first.result);
    } catch {
      mismatch = true;
    }
    expect(mismatch).toBe(true);
  });
});

describe('tuning is data, not code (§13)', () => {
  it('produces a different game when an [RC] engine value changes', () => {
    const base = config('endless');
    const { moves } = randomPlaythrough(base, 'rc-plumb', 'rc-bot');
    const baseline = simulate(base, 'rc-plumb', moves);
    const tuned = simulate(
      config('endless', { tuning: { ...TUNING, score_clear_base: 25 } }),
      'rc-plumb',
      moves,
    );
    expect(tuned.score).not.toBe(baseline.score);
  });
});
