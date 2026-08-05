/**
 * Placement legality — PRD §6.3, §6.8.
 *
 * "A placement anchors the piece's (0,0) offset at target cell; legal iff every
 * cell is in-bounds and empty."
 *
 * Perf (§6.8, ≤2ms full scan): each piece is precomputed once into per-row column
 * masks, so testing an anchor is one shift + AND per occupied piece row against
 * the memoized `board.occ` bitmask — no per-cell reads, no allocation.
 */

import { BOARD_SIZE, type Board } from './board';
import { PIECE_BY_ID, PIECES, type PieceId } from './pieces';

export interface Placement {
  /** Tray slot index (0–2). */
  pieceIndex: number;
  r: number;
  c: number;
}

/** A move in a replay log is a placement (§4.3 `simulate(config, seed, moves)`). */
export type Move = Placement;

interface PieceMask {
  /** One entry per occupied piece row: `dr` offset + column bitmask relative to the anchor. */
  rows: readonly { dr: number; mask: number }[];
  /** Rows/cols spanned below-right of the anchor, for the bounds check. */
  height: number;
  width: number;
}

const MASKS: Readonly<Record<PieceId, PieceMask>> = (() => {
  const masks = {} as Record<PieceId, PieceMask>;
  for (const piece of PIECES) {
    const byRow = new Map<number, number>();
    let height = 0;
    let width = 0;
    for (const [dr, dc] of piece.cells) {
      byRow.set(dr, (byRow.get(dr) ?? 0) | (1 << dc));
      height = Math.max(height, dr + 1);
      width = Math.max(width, dc + 1);
    }
    masks[piece.id] = {
      rows: [...byRow.entries()].map(([dr, mask]) => ({ dr, mask })),
      height,
      width,
    };
  }
  return masks;
})();

/** Legal iff every cell is in-bounds and empty (§6.3). */
export function canPlace(board: Board, pieceId: PieceId, r: number, c: number): boolean {
  const m = MASKS[pieceId];
  if (r < 0 || c < 0 || r + m.height > BOARD_SIZE || c + m.width > BOARD_SIZE) return false;
  for (const row of m.rows) {
    if (((board.occ[r + row.dr] ?? 0) & (row.mask << c)) !== 0) return false;
  }
  return true;
}

/** Every legal anchor for a piece on a board. */
export function legalAnchorsFor(board: Board, pieceId: PieceId): { r: number; c: number }[] {
  const m = MASKS[pieceId];
  const out: { r: number; c: number }[] = [];
  const maxR = BOARD_SIZE - m.height;
  const maxC = BOARD_SIZE - m.width;
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      let ok = true;
      for (const row of m.rows) {
        if (((board.occ[r + row.dr] ?? 0) & (row.mask << c)) !== 0) {
          ok = false;
          break;
        }
      }
      if (ok) out.push({ r, c });
    }
  }
  return out;
}

export function hasAnyLegalAnchor(board: Board, pieceId: PieceId): boolean {
  const m = MASKS[pieceId];
  const maxR = BOARD_SIZE - m.height;
  const maxC = BOARD_SIZE - m.width;
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      let ok = true;
      for (const row of m.rows) {
        if (((board.occ[r + row.dr] ?? 0) & (row.mask << c)) !== 0) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

/** Absolute cells a placement occupies. */
export function placementCells(pieceId: PieceId, r: number, c: number): { r: number; c: number }[] {
  return PIECE_BY_ID[pieceId].cells.map(([dr, dc]) => ({ r: r + dr, c: c + dc }));
}
