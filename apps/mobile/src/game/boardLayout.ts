/**
 * Board-to-screen layout math — PRD §7.2. Pure functions, no RN/Skia imports,
 * so they're unit-testable without a device or a native runtime.
 *
 * Coordinates follow the engine's convention (§6.1): `[row, col]`, zero-indexed,
 * row 0 = top. All outputs are canvas-LOCAL pixels (origin = the Skia canvas's
 * own top-left), not screen pixels — the caller positions the canvas itself.
 */

import { BOARD_SIZE } from '@blockmanor/engine';
import {
  BOARD_CELL_GAP,
  BOARD_PANEL_PADDING,
  TRAY_PIECE_CELL_GAP,
  TRAY_SCALE,
} from './boardTokens';

export interface BoardLayout {
  /** Side length of one cell, px. 0 if the container is too narrow to fit a board. */
  cellSize: number;
  gap: number;
  padding: number;
  /** Side length of the 8×8 grid itself (cells + internal gaps), px. */
  gridSize: number;
  /** Side length the Skia board canvas should be sized to (grid + padding both sides). */
  canvasSize: number;
}

/**
 * Fits an 8×8 board + its panel padding into an available square-ish width.
 * The board is always square, so height is derived from width.
 */
export function computeBoardLayout(containerWidth: number): BoardLayout {
  const padding = BOARD_PANEL_PADDING;
  const gap = BOARD_CELL_GAP;
  const available = Math.max(0, containerWidth - padding * 2);
  const cellSize = Math.max(0, Math.floor((available - gap * (BOARD_SIZE - 1)) / BOARD_SIZE));
  const gridSize = cellSize * BOARD_SIZE + gap * (BOARD_SIZE - 1);
  const canvasSize = gridSize + padding * 2;
  return { cellSize, gap, padding, gridSize, canvasSize };
}

export interface CellRect {
  x: number;
  y: number;
  size: number;
}

/** Board cell (r, c) → its canvas-local pixel rect. */
export function cellRect(r: number, c: number, layout: BoardLayout): CellRect {
  return {
    x: layout.padding + c * (layout.cellSize + layout.gap),
    y: layout.padding + r * (layout.cellSize + layout.gap),
    size: layout.cellSize,
  };
}

export interface TrayLayout {
  /** §7.2 exact: 60% of the board's cell scale. */
  pieceCellSize: number;
  gap: number;
}

export function computeTrayLayout(boardCellSize: number): TrayLayout {
  return { pieceCellSize: Math.floor(boardCellSize * TRAY_SCALE), gap: TRAY_PIECE_CELL_GAP };
}

export interface PieceBounds {
  rows: number;
  cols: number;
}

/** Bounding box of a piece's (row, col) cell offsets — centers it in its tray slot. */
export function pieceBounds(cells: readonly (readonly [number, number])[]): PieceBounds {
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of cells) {
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  return { rows: maxR + 1, cols: maxC + 1 };
}

/** A tray piece cell's rect, local to that piece's own bounding box (not the slot). */
export function trayCellRect(r: number, c: number, tray: TrayLayout): CellRect {
  return {
    x: c * (tray.pieceCellSize + tray.gap),
    y: r * (tray.pieceCellSize + tray.gap),
    size: tray.pieceCellSize,
  };
}
