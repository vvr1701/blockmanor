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
  TRAY_ROW_PADDING_V,
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
 * Fits an 8×8 board + its panel padding into an available square-ish box.
 * The board is always square: `cellSize` is derived from whichever of width
 * or height is tighter. `maxHeight` defaults to unconstrained (old
 * width-only behavior) — §4.5 v1.8 / the §7.3 prereq audit: a 360×640-class
 * 2019 Android clips the ~666–730px stack when sizing from width alone, so
 * the caller (`GameplayScreen`) measures its flex-shrunk board slot and
 * passes that height in.
 */
export function computeBoardLayout(containerWidth: number, maxHeight = Infinity): BoardLayout {
  const padding = BOARD_PANEL_PADDING;
  const gap = BOARD_CELL_GAP;
  const availableW = Math.max(0, containerWidth - padding * 2);
  const availableH = Math.max(0, maxHeight - padding * 2);
  const cellFromWidth = Math.floor((availableW - gap * (BOARD_SIZE - 1)) / BOARD_SIZE);
  const cellFromHeight = Math.floor((availableH - gap * (BOARD_SIZE - 1)) / BOARD_SIZE);
  const cellSize = Math.max(0, Math.min(cellFromWidth, cellFromHeight));
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
  /** §7.2 v1.8 exact: 50% of the board's cell scale. */
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

export interface TraySlotShape {
  used: boolean;
  cells: readonly (readonly [number, number])[];
}

/** One tray slot's piece footprint, positioned within the tray row (canvas-local px). */
export interface TraySlotLayout {
  originX: number;
  originY: number;
  pieceW: number;
  pieceH: number;
}

export interface TrayRowLayout {
  /** Same length/order as the input slots; `null` for a used slot. */
  slots: readonly (TraySlotLayout | null)[];
  canvasHeight: number;
}

/**
 * Single source of truth for "where does each tray piece sit" — `TrayCanvas`
 * (§7.2, static render) and `DragLayer` (§7.3, gesture hitboxes + the
 * return-to-tray animation target) both need the exact same numbers; computing
 * them twice is exactly the kind of drift that caused the §7.2 tray-overflow
 * bug this file's own regression test guards against.
 */
export function computeTrayRowLayout(
  slots: readonly TraySlotShape[],
  trayLayout: TrayLayout,
  containerWidth: number,
): TrayRowLayout {
  const slotWidth = slots.length > 0 ? containerWidth / slots.length : containerWidth;
  let tallest = trayLayout.pieceCellSize;
  const dims = slots.map((slot) => {
    if (slot.used) return null;
    const bounds = pieceBounds(slot.cells);
    const pieceW = bounds.cols * trayLayout.pieceCellSize + (bounds.cols - 1) * trayLayout.gap;
    const pieceH = bounds.rows * trayLayout.pieceCellSize + (bounds.rows - 1) * trayLayout.gap;
    if (pieceH > tallest) tallest = pieceH;
    return { pieceW, pieceH };
  });
  const canvasHeight = tallest + TRAY_ROW_PADDING_V * 2;
  const built = dims.map((d, i) => {
    if (!d) return null;
    return {
      originX: i * slotWidth + (slotWidth - d.pieceW) / 2,
      originY: TRAY_ROW_PADDING_V + (canvasHeight - TRAY_ROW_PADDING_V * 2 - d.pieceH) / 2,
      pieceW: d.pieceW,
      pieceH: d.pieceH,
    };
  });
  return { slots: built, canvasHeight };
}
