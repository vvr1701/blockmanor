/**
 * Pure drag/snap math — PRD §7.3. No RN/Skia/Reanimated imports, so this is
 * unit-testable directly (vitest, no mocks) AND safe to call from inside a
 * Reanimated worklet on the UI thread: every function here is marked
 * `'worklet'` (a no-op string literal outside the app's babel pipeline —
 * tests just call them as plain functions) and touches only numbers/plain
 * objects, never engine `Board`/`GameState` — see DragLayer.tsx for why (the
 * legal-anchor LIST is computed once on the JS thread from the engine's
 * public `getLegalPlacements`, then handed to the worklet as plain data; the
 * worklet only ever does arithmetic against that list, never re-derives
 * legality itself — CLAUDE.md rule "never reimplement engine rules").
 */

export interface AnchorPoint {
  r: number;
  c: number;
}

/**
 * Nearest anchor (in board cells) to a raw pixel position, if any is within
 * the §7.3 snap radius. `x`/`y` are the piece's top-left in the same
 * board-local pixel space as the anchors (both measured from the board's
 * cell-grid origin, in units of `cellStep` = cellSize + gap). Ties keep the
 * first (lowest-index) anchor within radius.
 */
export function nearestAnchor(
  anchors: readonly AnchorPoint[],
  x: number,
  y: number,
  cellStep: number,
  radiusCells: number,
): AnchorPoint | null {
  'worklet';
  const radiusPx = radiusCells * cellStep;
  let best: AnchorPoint | null = null;
  let bestDist = radiusPx;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (!a) continue;
    const dx = a.c * cellStep - x;
    const dy = a.r * cellStep - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= bestDist) {
      bestDist = dist;
      best = a;
    }
  }
  return best;
}

/** Rounds a raw pixel position to the nearest on-board cell, clamped so an
 * `rows`x`cols` piece never rounds off the `boardSize`x`boardSize` grid. Used
 * only for the illegal-hover (red) ghost, which still has to render
 * SOMEWHERE sensible even though nothing will actually place there. */
export function clampToGrid(
  x: number,
  y: number,
  cellStep: number,
  pieceRows: number,
  pieceCols: number,
  boardSize: number,
): AnchorPoint {
  'worklet';
  const maxR = boardSize - pieceRows;
  const maxC = boardSize - pieceCols;
  const r = Math.min(Math.max(0, Math.round(y / cellStep)), Math.max(0, maxR));
  const c = Math.min(Math.max(0, Math.round(x / cellStep)), Math.max(0, maxC));
  return { r, c };
}

/** True while a raw board-local pixel position is close enough to the board
 * that the ghost should render at all (hides it while still hovering over
 * the tray or off to the side — §7.3 doesn't specify this, see juice.ts
 * `GHOST_HIDE_MARGIN_CELLS`). */
export function isNearBoard(
  x: number,
  y: number,
  gridSize: number,
  cellStep: number,
  marginCells: number,
): boolean {
  'worklet';
  const margin = marginCells * cellStep;
  return x > -margin && y > -margin && x < gridSize + margin && y < gridSize + margin;
}
