/**
 * Level schema — PRD §7.7, as the engine consumes it.
 *
 * The authoritative zod schema lives outside the engine (PRD §16 "content is
 * data"; the engine is zero-dep per §4.2), so this file carries the TYPES plus a
 * dependency-free `validateLevel` for the trust boundary: level JSON and
 * server-side re-simulation both hand the engine data it did not author.
 */

import { BOARD_SIZE, type CellKind } from './board';
import { PIECE_BY_ID, type PieceId, type PieceWeightOverrides } from './pieces';
import { IVY_MAX_TILES, IVY_SPREAD_EVERY, isGoalType, type GoalType } from './obstacles';

/** Prefilled cell: a plain block or any §7.8 obstacle. */
export interface LevelPrefillCell {
  r: number;
  c: number;
  type: Exclude<CellKind, 'empty'>;
  /** Block color (§6.1). For `chain`, the color of the block it overlays. */
  color?: number;
}

export interface LevelGoal {
  type: GoalType;
  count: number;
}

export interface LevelStars {
  s2: number;
  s3: number;
}

export interface LevelConfig {
  id: number;
  chapter: number;
  seedSalt: string;
  prefill: LevelPrefillCell[];
  goals: LevelGoal[];
  pieceWeightOverrides: PieceWeightOverrides;
  /** §6.4 mercy RNG on/off for this level. */
  mercy: boolean;
  stars: LevelStars;
  /** §7.8 ivy cadence — level-scoped, NOT [RC], so a mid-flight change cannot break replay. */
  ivySpreadInterval: number;
  /** §7.8 ivy hard cap — level-scoped for the same reason. */
  ivyMaxTiles: number;
  /**
   * §7.7 harness-written metadata. Optional, and the engine NEVER reads either:
   * the §7.9 balance harness writes them back into the level file from its bot runs.
   */
  estMoves?: number;
  difficultyTier?: string;
}

export class LevelSchemaError extends Error {
  constructor(message: string) {
    super(`Invalid level (PRD §7.7): ${message}`);
    this.name = 'LevelSchemaError';
  }
}

const PREFILL_TYPES: readonly string[] = ['filled', 'crate', 'crate2', 'chain', 'ivy', 'heirloom'];

function rec(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LevelSchemaError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LevelSchemaError(`${what} must be a finite number`);
  }
  return value;
}

function arr(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new LevelSchemaError(`${what} must be an array`);
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new LevelSchemaError(`${what} must be a string`);
  return value;
}

/** Optional positive-integer field with a §7.8 default. */
function positiveInt(value: unknown, fallback: number, what: string): number {
  if (value === undefined) return fallback;
  const n = num(value, what);
  if (!Number.isInteger(n) || n <= 0) {
    throw new LevelSchemaError(`${what} must be a positive integer`);
  }
  return n;
}

/** Validates and normalizes §7.7 level JSON. Throws `LevelSchemaError` on bad input. */
export function validateLevel(input: unknown): LevelConfig {
  const raw = rec(input, 'level');

  const seedSalt = raw.seedSalt;
  if (typeof seedSalt !== 'string' || seedSalt.length === 0) {
    throw new LevelSchemaError('seedSalt must be a non-empty string');
  }

  const prefill: LevelPrefillCell[] = arr(raw.prefill ?? [], 'prefill').map((entry, i) => {
    const cell = rec(entry, `prefill[${i}]`);
    const r = num(cell.r, `prefill[${i}].r`);
    const c = num(cell.c, `prefill[${i}].c`);
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      throw new LevelSchemaError(`prefill[${i}] is off-board`);
    }
    if (typeof cell.type !== 'string' || !PREFILL_TYPES.includes(cell.type)) {
      throw new LevelSchemaError(`prefill[${i}].type must be one of ${PREFILL_TYPES.join(', ')}`);
    }
    const type = cell.type as Exclude<CellKind, 'empty'>;
    return cell.color === undefined
      ? { r, c, type }
      : { r, c, type, color: num(cell.color, `prefill[${i}].color`) };
  });

  const goals: LevelGoal[] = arr(raw.goals ?? [], 'goals').map((entry, i) => {
    const goal = rec(entry, `goals[${i}]`);
    if (!isGoalType(goal.type)) {
      // `crate2` is intentionally not a goal type: its 2nd hit destroys a `crate`
      // and counts there (§7.8 + the §7.7 example level).
      throw new LevelSchemaError(`goals[${i}].type must be crate, chain, ivy or heirloom`);
    }
    const count = num(goal.count, `goals[${i}].count`);
    if (count <= 0 || !Number.isInteger(count)) {
      throw new LevelSchemaError(`goals[${i}].count must be a positive integer`);
    }
    return { type: goal.type, count };
  });

  const overrides: Record<string, number> = {};
  for (const [id, weight] of Object.entries(rec(raw.pieceWeightOverrides ?? {}, 'overrides'))) {
    if (!(id in PIECE_BY_ID)) throw new LevelSchemaError(`unknown piece id "${id}" in overrides`);
    const w = num(weight, `pieceWeightOverrides.${id}`);
    if (w < 0) throw new LevelSchemaError(`pieceWeightOverrides.${id} must be >= 0`);
    overrides[id] = w;
  }

  // §7.7: `stars` is REQUIRED — an unscored level cannot award the 2nd/3rd star (§7.5).
  if (raw.stars === undefined) throw new LevelSchemaError('stars is required');
  const starsRaw = rec(raw.stars, 'stars');

  return {
    id: num(raw.id, 'id'),
    // §7.7: `chapter` is REQUIRED — the level map (§7.10) groups by it.
    chapter: num(raw.chapter, 'chapter'),
    seedSalt,
    prefill,
    goals,
    pieceWeightOverrides: overrides as Partial<Record<PieceId, number>>,
    mercy: raw.mercy === undefined ? true : raw.mercy === true,
    stars: { s2: num(starsRaw.s2, 'stars.s2'), s3: num(starsRaw.s3, 'stars.s3') },
    ivySpreadInterval: positiveInt(raw.ivySpreadInterval, IVY_SPREAD_EVERY, 'ivySpreadInterval'),
    ivyMaxTiles: positiveInt(raw.ivyMaxTiles, IVY_MAX_TILES, 'ivyMaxTiles'),
    // §7.7: optional harness metadata — omitted rather than defaulted, so a level
    // the harness has not measured yet is distinguishable from one it scored as 0.
    ...(raw.estMoves === undefined ? {} : { estMoves: num(raw.estMoves, 'estMoves') }),
    ...(raw.difficultyTier === undefined
      ? {}
      : { difficultyTier: str(raw.difficultyTier, 'difficultyTier') }),
  };
}
