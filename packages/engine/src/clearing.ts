/**
 * Line clearing — PRD §6.5.
 *
 * "After each placement: find ALL simultaneously full rows + columns → clear
 * their union atomically (a cell at a row/col intersection clears once).
 * Obstacles react per §7.8. No gravity — remaining blocks never move."
 *
 * Atomic = full lines are computed from the pre-clear board, then the union is
 * resolved once. That matters because §7.8 leaves cells occupied after a clear
 * (`crate2`→`crate`, `chain`→`filled`): resolving line-by-line would let those
 * survivors un-fill a line that was full at the moment of placement.
 */

import { BOARD_SIZE, FULL_ROW_MASK, cellColor, cellKind, setCell, type Board } from './board';
import { resolveOnClear, type GoalType } from './obstacles';
import type { CellRef, ObstacleKind } from './board';

export interface ObstacleHit {
  obstacle: ObstacleKind;
  r: number;
  c: number;
  /** false for the survivors: `crate2`→`crate` and `chain`→`filled`. */
  destroyed: boolean;
  /** Whether this hit decremented a goal (§7.8 "goal-countable"). */
  counted: boolean;
}

export interface ClearResult {
  rows: number[];
  cols: number[];
  /** The cleared union, row-major; an intersection cell appears exactly once (§6.5). */
  cells: CellRef[];
  hits: ObstacleHit[];
  counts: Partial<Record<GoalType, number>>;
  ivyDestroyed: boolean;
}

export function findFullLines(board: Board): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  let colsMask = FULL_ROW_MASK;
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = board.occ[r] ?? 0;
    if (row === FULL_ROW_MASK) rows.push(r);
    colsMask &= row;
  }
  const cols: number[] = [];
  for (let c = 0; c < BOARD_SIZE; c++) if ((colsMask & (1 << c)) !== 0) cols.push(c);
  return { rows, cols };
}

/** Mutates `board`. Returns the clear description, or null when nothing was full. */
export function applyClears(board: Board): ClearResult | null {
  const { rows, cols } = findFullLines(board);
  if (rows.length === 0 && cols.length === 0) return null;

  const rowSet = new Set(rows);
  const colSet = new Set(cols);
  const cells: CellRef[] = [];
  const hits: ObstacleHit[] = [];
  const counts: Partial<Record<GoalType, number>> = {};
  let ivyDestroyed = false;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (!rowSet.has(r) && !colSet.has(c)) continue;
      cells.push({ r, c });

      const kind = cellKind(board, r, c);
      const { next, counts: goal } = resolveOnClear(kind);
      if (kind !== 'empty' && kind !== 'filled') {
        hits.push({ obstacle: kind, r, c, destroyed: next === 'empty', counted: goal !== null });
        if (kind === 'ivy') ivyDestroyed = true;
      }
      if (goal !== null) counts[goal] = (counts[goal] ?? 0) + 1;
      // `chain` breaks into the block it overlaid — keep that block's color.
      setCell(board, r, c, next, next === 'empty' ? 0 : cellColor(board, r, c));
    }
  }

  return { rows, cols, cells, hits, counts, ivyDestroyed };
}
