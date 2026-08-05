/**
 * The five throwaway validation levels (BUILD_GUIDE S0.3).
 *
 * These are NOT shipped content — levels 1–60 are Stage 1 (§7.9). They exist to
 * prove the Stage-0 pipeline end to end: generate from dials → measure with the
 * bot → accept only within ±10pp of target. Between them they exercise all four
 * pattern classes, three obstacle types, and the piece-weight-override dial, so
 * a regression in any one of those dials fails the balance job.
 *
 * Targets are the §7.9 curve slots: ~90% tutorial, ~70% breather, ~50%
 * sustained, ~35% spike. Dials were chosen by sweeping, never guessed, and every
 * fixture clears medianMoves ≥ 8 — a level the bot finishes in one placement has
 * a meaningless win-rate.
 */

import type { GeneratorParams } from '../src/generator';

export interface Fixture {
  params: GeneratorParams;
  /** §7.9 slot target as a fraction. */
  target: number;
  /** What this fixture is here to defend. */
  covers: string;
}

export const FIXTURES: readonly Fixture[] = [
  {
    target: 0.9,
    covers: 'bands pattern + ivy obstacle + ivy spread cadence',
    params: {
      id: 901,
      chapter: 1,
      seedSalt: 'T01-bands-ivy',
      density: 0.3,
      pattern: 'bands',
      obstacles: { ivy: 3 },
      goals: [{ type: 'ivy', count: 3 }],
      difficultyTier: 'tutorial',
    },
  },
  {
    target: 0.7,
    covers: 'mid-fragments pattern (the harshest placement class)',
    params: {
      id: 902,
      chapter: 1,
      seedSalt: 'T02-midfrag-crate',
      density: 0.25,
      pattern: 'mid-fragments',
      obstacles: { crate: 2 },
      goals: [{ type: 'crate', count: 2 }],
      difficultyTier: 'breather',
    },
  },
  {
    target: 0.7,
    covers: 'pieceWeightOverrides dial — P11 (3x3) removed from the draw',
    params: {
      id: 903,
      chapter: 1,
      seedSalt: 'T03-bands-noP11',
      density: 0.2,
      pattern: 'bands',
      obstacles: { crate: 4 },
      goals: [{ type: 'crate', count: 4 }],
      pieceWeightOverrides: { P11: 0 },
      difficultyTier: 'breather',
    },
  },
  {
    target: 0.5,
    covers: 'edges pattern + a longer run (median ~19 moves)',
    params: {
      id: 904,
      chapter: 1,
      seedSalt: 'T04-edges-crate',
      density: 0.15,
      pattern: 'edges',
      obstacles: { crate: 2 },
      goals: [{ type: 'crate', count: 2 }],
      difficultyTier: 'sustained',
    },
  },
  {
    target: 0.35,
    covers: 'scatter pattern at spike difficulty',
    params: {
      id: 905,
      chapter: 1,
      seedSalt: 'T05-scatter-spike',
      density: 0.25,
      pattern: 'scatter',
      obstacles: { crate: 2 },
      goals: [{ type: 'crate', count: 2 }],
      difficultyTier: 'spike',
    },
  },
];
