/**
 * Board bitmask + placement legality — PRD §6.1, §6.3, §6.8.
 *
 * The memoized `occ` bitmask is the perf mechanism of §6.8; every test here that
 * touches it also checks it against the naive per-cell scan, so an incremental
 * update bug cannot hide behind fast-but-wrong legality answers.
 */

import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  cellIndex,
  computeOcc,
  createBoard,
  fillCount,
  fillRatio,
  isOccupied,
  occupies,
  setCell,
  type Board,
} from '../src/board';
import { canPlace, hasAnyLegalAnchor, legalAnchorsFor, placementCells } from '../src/placement';
import { PIECES, PIECE_BY_ID } from '../src/pieces';
import { createRng, nextInt } from '../src/rng';
import { boardFrom, config, setTray, TUNING } from './helpers';
import { createGame, getLegalPlacements } from '../src/simulate';

/** The oracle: legality by reading every cell, ignoring the bitmask. */
function naiveAnchors(board: Board, pieceId: keyof typeof PIECE_BY_ID): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const ok = PIECE_BY_ID[pieceId].cells.every(([dr, dc]) => {
        const rr = r + dr;
        const cc = c + dc;
        return (
          rr >= 0 &&
          rr < BOARD_SIZE &&
          cc >= 0 &&
          cc < BOARD_SIZE &&
          !occupies(board.kinds[cellIndex(rr, cc)] ?? 'empty')
        );
      });
      if (ok) out.push({ r, c });
    }
  }
  return out;
}

describe('empty-cell bitmask (PRD §6.8)', () => {
  it('stays in sync with the cells under random mutation', () => {
    const rng = createRng('bitmask');
    const board = createBoard();
    for (let i = 0; i < 5000; i++) {
      const r = nextInt(rng, BOARD_SIZE);
      const c = nextInt(rng, BOARD_SIZE);
      const kinds = ['empty', 'filled', 'crate', 'crate2', 'chain', 'ivy', 'heirloom'] as const;
      const kind = kinds[nextInt(rng, kinds.length)] ?? 'empty';
      setCell(board, r, c, kind, 3);
      expect(isOccupied(board, r, c)).toBe(kind !== 'empty');
    }
    expect(board.occ).toEqual(computeOcc(board));
  });

  it('counts fill and ratio off the mask', () => {
    const board = boardFrom([
      '########',
      '####....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    expect(fillCount(board)).toBe(12);
    expect(fillRatio(board)).toBeCloseTo(12 / 64);
  });

  it('agrees with the naive scan for every piece on random boards', () => {
    const rng = createRng('agree');
    for (let trial = 0; trial < 40; trial++) {
      const board = createBoard();
      for (let i = 0; i < 30; i++) {
        setCell(board, nextInt(rng, BOARD_SIZE), nextInt(rng, BOARD_SIZE), 'filled', 0);
      }
      for (const piece of PIECES) {
        expect(legalAnchorsFor(board, piece.id), piece.id).toEqual(naiveAnchors(board, piece.id));
        expect(hasAnyLegalAnchor(board, piece.id), piece.id).toBe(
          naiveAnchors(board, piece.id).length > 0,
        );
      }
    }
  });

  it('scans all legal placements well inside the 2ms budget (§6.8)', () => {
    const rng = createRng('perf');
    const board = createBoard();
    for (let i = 0; i < 24; i++) {
      setCell(board, nextInt(rng, BOARD_SIZE), nextInt(rng, BOARD_SIZE), 'filled', 0);
    }
    const state = createGame(config('endless', { tuning: { ...TUNING } }), 'perf');
    state.board = board;
    setTray(state, ['P11', 'P08', 'P16']);

    // Warm up, then measure the average of a full 3-slot scan.
    for (let i = 0; i < 200; i++) for (let s = 0; s < 3; s++) getLegalPlacements(state, s);
    const iterations = 2000;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      for (let s = 0; s < 3; s++) getLegalPlacements(state, s);
    }
    const perScan = (performance.now() - t0) / iterations;
    // Budget is 2ms on a mid Android; CI runners are faster, so this asserts the
    // algorithm is bitmask-class (sub-100µs), not that CI hardware is fast.
    expect(perScan).toBeLessThan(0.1);
  });
});

describe('placement legality (PRD §6.3)', () => {
  const board = boardFrom([
    '.......#',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ]);

  it('anchors the piece (0,0) offset at the target cell', () => {
    expect(placementCells('P12', 3, 4)).toEqual([
      { r: 3, c: 4 },
      { r: 4, c: 4 },
      { r: 4, c: 5 },
    ]);
    // P21 has no (0,0) cell — the anchor is the offset origin, not a cell.
    expect(placementCells('P21', 0, 0)).toEqual([
      { r: 0, c: 1 },
      { r: 0, c: 2 },
      { r: 1, c: 0 },
      { r: 1, c: 1 },
    ]);
  });

  it('rejects out-of-bounds and occupied targets', () => {
    expect(canPlace(board, 'P01', 0, 7)).toBe(false); // occupied
    expect(canPlace(board, 'P01', 0, 6)).toBe(true);
    expect(canPlace(board, 'P06', 0, 5)).toBe(false); // runs off the right edge
    expect(canPlace(board, 'P09', 4, 0)).toBe(false); // 5 tall from row 4
    expect(canPlace(board, 'P09', 3, 0)).toBe(true);
    expect(canPlace(board, 'P01', -1, 0)).toBe(false);
    expect(canPlace(board, 'P01', 0, -1)).toBe(false);
  });

  it('returns no placements for a used slot, a bad index, or a finished game', () => {
    const state = createGame(config('endless'), 'slots');
    expect(getLegalPlacements(state, 5)).toEqual([]);
    state.tray = state.tray.map((s) => ({ ...s, used: true }));
    expect(getLegalPlacements(state, 0)).toEqual([]);
    state.tray = state.tray.map((s) => ({ ...s, used: false }));
    state.status = 'lost';
    expect(getLegalPlacements(state, 0)).toEqual([]);
  });
});
