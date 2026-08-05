/**
 * Obstacle behaviors — PRD §7.8 (table is implemented verbatim).
 *
 * | type      | occupies | placeable on | on line-clear through it            | goal-countable |
 * | crate     | yes      | no           | destroyed → empty                   | yes            |
 * | crate2    | yes      | no           | becomes `crate` (hit 1 of 2)        | on 2nd hit     |
 * | chain     | overlays | no           | breaks → filled block remains       | chain-break    |
 * | ivy       | yes      | no           | destroyed                           | yes            |
 * | heirloom  | yes      | no           | collected → empty                   | yes            |
 *
 * "placeable on: no" needs no special case: every obstacle occupies its cell and
 * §6.3 legality already requires an *empty* cell.
 *
 * A `crate2` that has taken its first hit is a `crate`; destroying it then counts
 * toward a `crate` goal — which is exactly the §7.7 example level (prefill has a
 * crate + a crate2, the single goal is `crate: 12`). So goal types are the four
 * below and `crate2` is not a goal type of its own.
 */

import {
  BOARD_SIZE,
  cellIndex,
  isOccupied,
  setCell,
  type Board,
  type CellKind,
  type CellRef,
} from './board';
import { nextInt, type Rng } from './rng';

export type GoalType = 'crate' | 'chain' | 'ivy' | 'heirloom';
export const GOAL_TYPES: readonly GoalType[] = ['crate', 'chain', 'ivy', 'heirloom'];

export const isGoalType = (v: unknown): v is GoalType =>
  typeof v === 'string' && (GOAL_TYPES as readonly string[]).includes(v);

/** §7.8: what an occupied cell becomes when a line clears through it, and what it counts as. */
export function resolveOnClear(kind: CellKind): { next: CellKind; counts: GoalType | null } {
  switch (kind) {
    case 'crate':
      return { next: 'empty', counts: 'crate' };
    case 'crate2':
      return { next: 'crate', counts: null }; // hit 1 of 2
    case 'chain':
      return { next: 'filled', counts: 'chain' }; // block survives, clears on a later line
    case 'ivy':
      return { next: 'empty', counts: 'ivy' };
    case 'heirloom':
      return { next: 'empty', counts: 'heirloom' };
    case 'filled':
    case 'empty':
      return { next: 'empty', counts: null };
  }
}

/**
 * §7.8 ivy spread cadence and hard cap — DEFAULTS for the §7.7 level fields
 * `ivySpreadInterval` / `ivyMaxTiles`. Deliberately not [RC] (§7.8): an RC change
 * mid-run would alter the draw sequence and break `simulate()` re-verification.
 */
export const IVY_SPREAD_EVERY = 3;
export const IVY_MAX_TILES = 16;

export function ivyCount(board: Board): number {
  let n = 0;
  for (const k of board.kinds) if (k === 'ivy') n++;
  return n;
}

const ORTHOGONAL: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * §7.8: "ONE random (seeded) ivy tile grows into a random orthogonally-adjacent
 * empty cell. Ivy never grows past 16 total tiles."
 *
 * §7.8 candidate set (PRD v1.6, now explicit and REPLAY-AFFECTING): the source is
 * drawn only from ivy tiles with ≥1 empty orthogonal neighbour. When none exist —
 * every tile boxed in, or the cap reached — there is no growth and NO RNG IS
 * CONSUMED. That last clause is what makes the golden fixtures byte-stable, so
 * this early return must stay above the draws. Both picks use the seeded RNG
 * (2 draws max).
 */
// `maxTiles` is required, not defaulted: the cap is per-level (§7.7) and a
// forgotten argument silently reinstating 16 is exactly the drift to prevent.
export function spreadIvy(
  board: Board,
  rng: Rng,
  maxTiles: number,
): { from: CellRef; to: CellRef } | null {
  if (ivyCount(board) >= maxTiles) return null;

  const candidates: { from: CellRef; targets: CellRef[] }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board.kinds[cellIndex(r, c)] !== 'ivy') continue;
      const targets: CellRef[] = [];
      for (const [dr, dc] of ORTHOGONAL) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
        if (!isOccupied(board, nr, nc)) targets.push({ r: nr, c: nc });
      }
      if (targets.length > 0) candidates.push({ from: { r, c }, targets });
    }
  }
  if (candidates.length === 0) return null;

  const source = candidates[nextInt(rng, candidates.length)] as (typeof candidates)[number];
  const target = source.targets[nextInt(rng, source.targets.length)] as CellRef;
  setCell(board, target.r, target.c, 'ivy');
  return { from: source.from, to: target };
}
