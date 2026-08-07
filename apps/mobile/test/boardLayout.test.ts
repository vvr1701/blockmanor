import { BOARD_SIZE, PIECES } from '@blockmanor/engine';
import { describe, expect, it } from 'vitest';
import {
  cellRect,
  computeBoardLayout,
  computeTrayLayout,
  computeTrayRowLayout,
  pieceBounds,
  trayCellRect,
} from '../src/game/boardLayout';
import { BOARD_CELL_GAP, BOARD_PANEL_PADDING, TRAY_SCALE } from '../src/game/boardTokens';

describe('computeBoardLayout (PRD §7.2 board sizing)', () => {
  it('fits exactly 8 cells + 7 gaps + 2×padding inside the container width', () => {
    const layout = computeBoardLayout(400);
    expect(layout.gridSize).toBe(layout.cellSize * BOARD_SIZE + layout.gap * (BOARD_SIZE - 1));
    expect(layout.canvasSize).toBe(layout.gridSize + layout.padding * 2);
    expect(layout.canvasSize).toBeLessThanOrEqual(400);
    expect(layout.gap).toBe(BOARD_CELL_GAP);
    expect(layout.padding).toBe(BOARD_PANEL_PADDING);
  });

  it('cell size is deterministic and floors to an integer pixel', () => {
    const layout = computeBoardLayout(390);
    expect(Number.isInteger(layout.cellSize)).toBe(true);
    expect(layout.cellSize).toBeGreaterThan(0);
  });

  it('scales cell size up with a wider container', () => {
    const narrow = computeBoardLayout(320);
    const wide = computeBoardLayout(500);
    expect(wide.cellSize).toBeGreaterThan(narrow.cellSize);
  });

  it('degrades to a zero-size board rather than negative/NaN on a too-narrow container', () => {
    const layout = computeBoardLayout(10);
    expect(layout.cellSize).toBe(0);
    expect(Number.isNaN(layout.cellSize)).toBe(false);
  });

  // §4.5 v1.8 prereq regression: a 360×640-class device clips a width-only
  // board when the flex-shrunk slot below the HUD/goal bar is short.
  describe('height constraint (§4.5 v1.8 prereq: size from height too)', () => {
    it('is unaffected by an unconstrained (default) maxHeight', () => {
      const unconstrained = computeBoardLayout(400);
      const explicit = computeBoardLayout(400, Infinity);
      expect(explicit).toEqual(unconstrained);
    });

    it('shrinks the cell size when height is the tighter constraint', () => {
      const wide = computeBoardLayout(400);
      const short = computeBoardLayout(400, 200);
      expect(short.cellSize).toBeLessThan(wide.cellSize);
      expect(short.canvasSize).toBeLessThanOrEqual(200);
    });

    it('is a no-op when width is still the tighter constraint', () => {
      const widthOnly = computeBoardLayout(320);
      const generousHeight = computeBoardLayout(320, 900);
      expect(generousHeight).toEqual(widthOnly);
    });

    it('degrades to a zero-size board on a too-short height, not negative/NaN', () => {
      const layout = computeBoardLayout(400, 10);
      expect(layout.cellSize).toBe(0);
      expect(Number.isNaN(layout.cellSize)).toBe(false);
    });
  });
});

describe('cellRect (board cell → canvas-local pixel rect)', () => {
  it('places (0,0) at the panel padding origin', () => {
    const layout = computeBoardLayout(400);
    const rect = cellRect(0, 0, layout);
    expect(rect.x).toBe(layout.padding);
    expect(rect.y).toBe(layout.padding);
    expect(rect.size).toBe(layout.cellSize);
  });

  it('places the last cell (7,7) flush with the grid end (within one cell+gap of the panel edge)', () => {
    const layout = computeBoardLayout(400);
    const rect = cellRect(BOARD_SIZE - 1, BOARD_SIZE - 1, layout);
    expect(rect.x + rect.size).toBe(layout.padding + layout.gridSize);
    expect(rect.y + rect.size).toBe(layout.padding + layout.gridSize);
  });

  it('advances by exactly (cellSize + gap) per row/col step', () => {
    const layout = computeBoardLayout(400);
    const a = cellRect(2, 3, layout);
    const b = cellRect(2, 4, layout);
    const c = cellRect(3, 3, layout);
    expect(b.x - a.x).toBe(layout.cellSize + layout.gap);
    expect(c.y - a.y).toBe(layout.cellSize + layout.gap);
    expect(b.y).toBe(a.y);
    expect(c.x).toBe(a.x);
  });
});

describe('tray scaling (§7.2 v1.8 exact: pieces render at 50% board-cell scale)', () => {
  it('tray cell size is exactly 50% of the board cell size, floored', () => {
    const layout = computeBoardLayout(400);
    const tray = computeTrayLayout(layout.cellSize);
    expect(TRAY_SCALE).toBe(0.5);
    expect(tray.pieceCellSize).toBe(Math.floor(layout.cellSize * 0.5));
  });

  it('trayCellRect lays out a piece cell relative to its own bounding box, not the board', () => {
    const tray = computeTrayLayout(40);
    const rect = trayCellRect(1, 2, tray);
    expect(rect.x).toBe(2 * (tray.pieceCellSize + tray.gap));
    expect(rect.y).toBe(1 * (tray.pieceCellSize + tray.gap));
    expect(rect.size).toBe(tray.pieceCellSize);
  });

  // Regression test for the qa-prd-auditor Blocker 3 finding: at the old 60%
  // scale, 3 copies of the widest (5-wide) piece needed 0.375×width but each
  // tray slot is only containerWidth/3 ≈ 0.333×width — pieces overlapped and
  // clipped. This checks the real arithmetic `TrayCanvas` uses, across
  // realistic Android/iOS device widths, so a future scale change can't
  // silently reintroduce the overflow.
  it('3 copies of the widest piece fit side-by-side across realistic device widths', () => {
    const widestCols = Math.max(...PIECES.map((p) => pieceBounds(p.cells).cols));
    for (const containerWidth of [360, 390, 412]) {
      const board = computeBoardLayout(containerWidth);
      const tray = computeTrayLayout(board.cellSize);
      const widestPieceWidth = widestCols * tray.pieceCellSize + (widestCols - 1) * tray.gap;
      expect(widestPieceWidth * 3).toBeLessThanOrEqual(containerWidth);
    }
  });
});

describe('computeTrayRowLayout (single source of truth for TrayCanvas + DragLayer)', () => {
  const DOT: readonly (readonly [number, number])[] = [[0, 0]];
  const DUO_V: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 0],
  ];

  it('gives a used slot a null layout', () => {
    const tray = computeTrayLayout(40);
    const row = computeTrayRowLayout([{ used: true, cells: DOT }], tray, 300);
    expect(row.slots).toEqual([null]);
  });

  it('centers each slot within its own containerWidth/N share', () => {
    const tray = computeTrayLayout(40); // pieceCellSize 20
    const row = computeTrayRowLayout(
      [
        { used: false, cells: DOT },
        { used: false, cells: DOT },
        { used: false, cells: DOT },
      ],
      tray,
      300,
    );
    const slotWidth = 100;
    row.slots.forEach((slot, i) => {
      expect(slot).not.toBeNull();
      const pieceW = tray.pieceCellSize;
      expect(slot?.originX).toBeCloseTo(i * slotWidth + (slotWidth - pieceW) / 2);
    });
  });

  it('sizes canvasHeight off the tallest piece in the row, not a fixed piece', () => {
    const tray = computeTrayLayout(40); // pieceCellSize 20, gap 2
    const shortRow = computeTrayRowLayout([{ used: false, cells: DOT }], tray, 300);
    const tallRow = computeTrayRowLayout([{ used: false, cells: DUO_V }], tray, 300);
    expect(tallRow.canvasHeight).toBeGreaterThan(shortRow.canvasHeight);
  });

  it('TrayCanvas and DragLayer calling this with identical inputs get identical layouts (no drift)', () => {
    const tray = computeTrayLayout(38);
    const shapes = [
      { used: false, cells: DOT },
      { used: true, cells: DOT },
      { used: false, cells: DUO_V },
    ];
    const a = computeTrayRowLayout(shapes, tray, 360);
    const b = computeTrayRowLayout(shapes, tray, 360);
    expect(a).toEqual(b);
  });
});

describe('pieceBounds', () => {
  it('reads a 1×1 dot piece as a single cell', () => {
    expect(pieceBounds([[0, 0]])).toEqual({ rows: 1, cols: 1 });
  });

  it('reads an L-shaped piece bounding box correctly', () => {
    // P16 ell4-0: (0,0)(1,0)(2,0)(2,1)
    expect(
      pieceBounds([
        [0, 0],
        [1, 0],
        [2, 0],
        [2, 1],
      ]),
    ).toEqual({ rows: 3, cols: 2 });
  });

  it('reads a 3×3 square piece bounding box correctly', () => {
    expect(
      pieceBounds([
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [1, 2],
        [2, 0],
        [2, 1],
        [2, 2],
      ]),
    ).toEqual({ rows: 3, cols: 3 });
  });
});
