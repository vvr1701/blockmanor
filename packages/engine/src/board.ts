/**
 * Board model — PRD §6.1.
 *
 * 8×8 grid, `[row, col]` zero-indexed, row 0 = top. Cell states: empty,
 * filled(colorId), or an obstacle (§7.8).
 *
 * Occupancy is mirrored into `occ` — one 8-bit mask per row, bit `c` set when
 * (r,c) is occupied. This is the memoized bitmask of PRD §6.8: it is maintained
 * incrementally by `setCell` so `getLegalPlacements` never rescans cells, and
 * full-row / full-col detection is a mask compare.
 */

export const BOARD_SIZE = 8;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
export const FULL_ROW_MASK = 0xff;
/** §15 block set: 7 colors. Used for `filled(colorId)`. */
export const BLOCK_COLOR_COUNT = 7;

export type ObstacleKind = 'crate' | 'crate2' | 'chain' | 'ivy' | 'heirloom';
export type CellKind = 'empty' | 'filled' | ObstacleKind;

export interface CellRef {
  r: number;
  c: number;
}

export interface Board {
  /** Cell kind per index, length 64. */
  kinds: CellKind[];
  /** colorId per index (0 where the kind carries no color). */
  colors: number[];
  /** Memoized occupancy: one column bitmask per row (PRD §6.8). */
  occ: number[];
}

export const cellIndex = (r: number, c: number): number => r * BOARD_SIZE + c;

export const inBounds = (r: number, c: number): boolean =>
  r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;

/** §7.8: every non-empty kind fills its cell — obstacles included, `chain` overlays a filled block. */
export const occupies = (kind: CellKind): boolean => kind !== 'empty';

export function createBoard(): Board {
  return {
    kinds: new Array<CellKind>(CELL_COUNT).fill('empty'),
    colors: new Array<number>(CELL_COUNT).fill(0),
    occ: new Array<number>(BOARD_SIZE).fill(0),
  };
}

export function cloneBoard(board: Board): Board {
  return { kinds: board.kinds.slice(), colors: board.colors.slice(), occ: board.occ.slice() };
}

export function cellKind(board: Board, r: number, c: number): CellKind {
  return board.kinds[cellIndex(r, c)] ?? 'empty';
}

export function cellColor(board: Board, r: number, c: number): number {
  return board.colors[cellIndex(r, c)] ?? 0;
}

/** O(1) occupancy read straight off the memoized bitmask. */
export function isOccupied(board: Board, r: number, c: number): boolean {
  return ((board.occ[r] ?? 0) & (1 << c)) !== 0;
}

export function setCell(board: Board, r: number, c: number, kind: CellKind, color = 0): void {
  const i = cellIndex(r, c);
  board.kinds[i] = kind;
  board.colors[i] = kind === 'empty' ? 0 : color;
  const row = board.occ[r] ?? 0;
  board.occ[r] = occupies(kind) ? row | (1 << c) : row & ~(1 << c);
}

function popcount8(v: number): number {
  let n = 0;
  for (let b = 0; b < BOARD_SIZE; b++) if ((v & (1 << b)) !== 0) n++;
  return n;
}

export function fillCount(board: Board): number {
  let n = 0;
  for (let r = 0; r < BOARD_SIZE; r++) n += popcount8(board.occ[r] ?? 0);
  return n;
}

/** §6.4 mercy input: occupied cells / 64. */
export function fillRatio(board: Board): number {
  return fillCount(board) / CELL_COUNT;
}

/** Naive recompute from `kinds` — used when loading a prefill and as the test oracle for `occ`. */
export function computeOcc(board: Board): number[] {
  const occ = new Array<number>(BOARD_SIZE).fill(0);
  for (let r = 0; r < BOARD_SIZE; r++) {
    let mask = 0;
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (occupies(board.kinds[cellIndex(r, c)] ?? 'empty')) mask |= 1 << c;
    }
    occ[r] = mask;
  }
  return occ;
}
