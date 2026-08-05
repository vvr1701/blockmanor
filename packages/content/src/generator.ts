/**
 * Parameterized level generator — PRD §5 (Stage-0 tooling), §7.7 (output shape),
 * level-authoring skill (the dials).
 *
 * Generates CANDIDATES only. A candidate is not a level until the harness has
 * measured it against its §7.9 win-rate target — "never hand-guess difficulty".
 *
 * Dials, weakest → strongest effect (level-authoring skill):
 *   goal tightness → prefill density → prefill placement → obstacle
 *   compounding → piece-weight overrides
 * Placement patterns are separate from density on purpose: 20% density as
 * mid-board fragments is far more punishing than 20% hugging the edges, and
 * that difference is the generator's main lever.
 */

import { createRng, nextInt, type PieceId, type Rng } from '@blockmanor/engine';
import { levelSchema, type LevelJson } from './schema';

export type PatternClass = 'edges' | 'bands' | 'scatter' | 'mid-fragments';
export type ObstacleType = 'crate' | 'crate2' | 'chain' | 'ivy' | 'heirloom';

export interface GeneratorParams {
  id: number;
  chapter: number;
  seedSalt: string;
  /** Fraction of the 64 cells to prefill, 0–1. */
  density: number;
  pattern: PatternClass;
  /** How many of the prefilled cells become each obstacle. Rest stay plain blocks. */
  obstacles?: Partial<Record<ObstacleType, number>>;
  goals?: { type: 'crate' | 'chain' | 'ivy' | 'heirloom'; count: number }[];
  pieceWeightOverrides?: Partial<Record<PieceId, number>>;
  mercy?: boolean;
  ivySpreadInterval?: number;
  ivyMaxTiles?: number;
  /** Provisional; the harness replaces these from measured bot scores. */
  stars?: { s2: number; s3: number };
  difficultyTier?: string;
}

const SIZE = 8;
const key = (r: number, c: number): string => `${r},${c}`;

/**
 * Cells a pattern is allowed to use, most-preferred first. The generator takes
 * the first `n` after a seeded shuffle WITHIN each band, so density and pattern
 * stay independent: raising density extends into the same ordered pool rather
 * than changing the shape.
 */
function candidateCells(pattern: PatternClass, rng: Rng): { r: number; c: number }[] {
  const all: { r: number; c: number }[] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) all.push({ r, c });

  const shuffle = (cells: { r: number; c: number }[]): { r: number; c: number }[] => {
    const out = [...cells];
    for (let i = out.length - 1; i > 0; i--) {
      const j = nextInt(rng, i + 1);
      [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
    }
    return out;
  };

  const edgeDist = ({ r, c }: { r: number; c: number }): number =>
    Math.min(r, SIZE - 1 - r, c, SIZE - 1 - c);

  switch (pattern) {
    // Hugs the border: leaves the middle open, the gentlest shape.
    case 'edges':
      return [0, 1, 2, 3].flatMap((d) => shuffle(all.filter((cell) => edgeDist(cell) === d)));
    // Full horizontal rows from the top: predictable, easy to clear into.
    case 'bands':
      return [0, 2, 4, 6, 1, 3, 5, 7].flatMap((r) => shuffle(all.filter((cell) => cell.r === r)));
    // Uniform noise across the board.
    case 'scatter':
      return shuffle(all);
    // Centre-out: fragments the open space, the most punishing shape.
    case 'mid-fragments':
      return [3, 2, 1, 0].flatMap((d) => shuffle(all.filter((cell) => edgeDist(cell) === d)));
  }
}

/** Build a §7.7 level candidate. Fully deterministic in `seedSalt`. */
export function generateLevel(params: GeneratorParams): LevelJson {
  const rng = createRng(`gen|${params.seedSalt}`);
  const count = Math.round(Math.min(Math.max(params.density, 0), 1) * SIZE * SIZE);
  const cells = candidateCells(params.pattern, rng).slice(0, count);

  // Obstacles are assigned to the LAST cells of the pattern order, so the
  // strongest dial (obstacle compounding) lands where the pattern is weakest —
  // otherwise a dense edge pattern would bury every crate behind plain blocks.
  const assignments = new Map<string, ObstacleType | 'filled'>();
  for (const cell of cells) assignments.set(key(cell.r, cell.c), 'filled');

  let cursor = cells.length - 1;
  for (const [type, n] of Object.entries(params.obstacles ?? {})) {
    for (let i = 0; i < (n ?? 0); i++) {
      const cell = cells[cursor--];
      if (!cell)
        throw new Error(`density too low for the requested obstacle mix (level ${params.id})`);
      assignments.set(key(cell.r, cell.c), type as ObstacleType);
    }
  }

  const prefill = cells.map((cell) => ({
    r: cell.r,
    c: cell.c,
    type: assignments.get(key(cell.r, cell.c)) ?? 'filled',
  }));

  return levelSchema.parse({
    id: params.id,
    chapter: params.chapter,
    seedSalt: params.seedSalt,
    prefill,
    goals: params.goals ?? [],
    pieceWeightOverrides: params.pieceWeightOverrides ?? {},
    mercy: params.mercy ?? true,
    ivySpreadInterval: params.ivySpreadInterval ?? 3,
    ivyMaxTiles: params.ivyMaxTiles ?? 16,
    // Provisional until the harness measures real bot scores.
    stars: params.stars ?? { s2: 0, s3: 0 },
    ...(params.difficultyTier === undefined ? {} : { difficultyTier: params.difficultyTier }),
  }) as LevelJson;
}
