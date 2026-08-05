/** Piece table integrity — PRD §6.2. The IDs, cells and weights are permanent API. */

import { describe, expect, it } from 'vitest';
import {
  PIECES,
  PIECE_BY_ID,
  PIECE_IDS,
  SMALL_POOL,
  drawPiece,
  pieceColor,
  pieceWeight,
  type Piece,
  type PieceId,
} from '../src/pieces';
import { BLOCK_COLOR_COUNT } from '../src/board';
import { createRng } from '../src/rng';

const key = (cells: Piece['cells']): string =>
  [...cells]
    .map(([r, c]) => `${r},${c}`)
    .sort()
    .join(' ');

/** 90° clockwise about the bounding box, then normalized to the top-left corner. */
function rotateCW(cells: Piece['cells']): [number, number][] {
  const maxR = Math.max(...cells.map(([r]) => r));
  const rotated = cells.map(([r, c]): [number, number] => [c, maxR - r]);
  const minR = Math.min(...rotated.map(([r]) => r));
  const minC = Math.min(...rotated.map(([, c]) => c));
  return rotated.map(([r, c]): [number, number] => [r - minR, c - minC]);
}

describe('piece table (PRD §6.2)', () => {
  it('has all 22 canonical ids exactly once', () => {
    expect(PIECES).toHaveLength(22);
    expect(PIECE_IDS).toEqual([
      'P01',
      'P02',
      'P03',
      'P04',
      'P05',
      'P06',
      'P07',
      'P08',
      'P09',
      'P10',
      'P11',
      'P12',
      'P13',
      'P14',
      'P15',
      'P16',
      'P17',
      'P18',
      'P19',
      'P20',
      'P21',
      'P22',
    ]);
  });

  it('matches the PRD weights verbatim', () => {
    const weights: Record<PieceId, number> = {
      P01: 6,
      P02: 8,
      P03: 8,
      P04: 8,
      P05: 8,
      P06: 6,
      P07: 6,
      P08: 3,
      P09: 3,
      P10: 8,
      P11: 3,
      P12: 5,
      P13: 5,
      P14: 5,
      P15: 5,
      P16: 4,
      P17: 4,
      P18: 4,
      P19: 4,
      P20: 4,
      P21: 3,
      P22: 3,
    };
    for (const piece of PIECES) expect(piece.weight, piece.id).toBe(weights[piece.id]);
  });

  it('matches the PRD cell lists verbatim for the explicitly-tabled pieces', () => {
    expect(key(PIECE_BY_ID.P01.cells)).toBe(key([[0, 0]]));
    expect(key(PIECE_BY_ID.P02.cells)).toBe(
      key([
        [0, 0],
        [0, 1],
      ]),
    );
    expect(key(PIECE_BY_ID.P05.cells)).toBe(
      key([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    );
    expect(key(PIECE_BY_ID.P08.cells)).toBe(
      key([
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
      ]),
    );
    expect(PIECE_BY_ID.P11.cells).toHaveLength(9); // 3×3 all cells
    expect(key(PIECE_BY_ID.P20.cells)).toBe(
      key([
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 1],
      ]),
    );
    expect(key(PIECE_BY_ID.P21.cells)).toBe(
      key([
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
      ]),
    );
    expect(key(PIECE_BY_ID.P22.cells)).toBe(
      key([
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 2],
      ]),
    );
  });

  it('expands P12–P15 into the four distinct rotations of (0,0)(1,0)(1,1)', () => {
    const base: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const expected = [base];
    for (let i = 1; i < 4; i++) expected.push(rotateCW(expected[i - 1] as [number, number][]));

    const actual = ['P12', 'P13', 'P14', 'P15'].map((id) => key(PIECE_BY_ID[id as PieceId].cells));
    expect(new Set(actual).size).toBe(4);
    expect(actual).toEqual(expected.map(key));
  });

  it('expands P16–P19 into the four distinct rotations of (0,0)(1,0)(2,0)(2,1)', () => {
    const base: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ];
    const expected = [base];
    for (let i = 1; i < 4; i++) expected.push(rotateCW(expected[i - 1] as [number, number][]));

    const actual = ['P16', 'P17', 'P18', 'P19'].map((id) => key(PIECE_BY_ID[id as PieceId].cells));
    expect(new Set(actual).size).toBe(4);
    expect(actual).toEqual(expected.map(key));
  });

  it('keeps every piece inside a 5×5 bounding box with normalized offsets', () => {
    for (const piece of PIECES) {
      const rs = piece.cells.map(([r]) => r);
      const cs = piece.cells.map(([, c]) => c);
      expect(Math.min(...rs), piece.id).toBe(0);
      expect(Math.min(...cs), piece.id).toBe(0);
      expect(Math.max(...rs), piece.id).toBeLessThan(5);
      expect(Math.max(...cs), piece.id).toBeLessThan(5);
      expect(new Set(piece.cells.map(([r, c]) => `${r},${c}`)).size, piece.id).toBe(
        piece.cells.length,
      );
    }
  });

  it('defines SMALL_POOL as {P01..P05, P12..P15} (§6.2)', () => {
    expect(SMALL_POOL).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P12', 'P13', 'P14', 'P15']);
  });

  it('assigns every piece a color in the §15 block set, derived from the id alone', () => {
    for (const id of PIECE_IDS) {
      expect(pieceColor(id)).toBeGreaterThanOrEqual(0);
      expect(pieceColor(id)).toBeLessThan(BLOCK_COLOR_COUNT);
    }
    expect(pieceColor('P07')).toBe(pieceColor('P07'));
  });
});

describe('weighted draw (PRD §6.2, §7.7 overrides)', () => {
  it('draws roughly in proportion to weight', () => {
    const rng = createRng('weights');
    const counts = new Map<PieceId, number>();
    const n = 40000;
    for (let i = 0; i < n; i++) {
      const id = drawPiece(rng);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = PIECES.reduce((sum, p) => sum + p.weight, 0);
    for (const piece of PIECES) {
      const observed = (counts.get(piece.id) ?? 0) / n;
      expect(Math.abs(observed - piece.weight / total), piece.id).toBeLessThan(0.01);
    }
  });

  it('excludes a piece whose override weight is 0 (§7.7)', () => {
    const rng = createRng('override');
    for (let i = 0; i < 3000; i++) {
      expect(drawPiece(rng, undefined, { P11: 0, P08: 0, P09: 0 })).not.toMatch(/P08|P09|P11/);
    }
    expect(pieceWeight(PIECE_BY_ID.P11, { P11: 0 })).toBe(0);
    expect(pieceWeight(PIECE_BY_ID.P11)).toBe(3);
  });

  it('throws rather than drawing from an all-zero pool', () => {
    const zeroed = Object.fromEntries(PIECE_IDS.map((id) => [id, 0]));
    expect(() => drawPiece(createRng('zero'), PIECE_IDS, zeroed)).toThrow(/zero total weight/);
  });

  it('is a pure function of the seed', () => {
    const a = Array.from({ length: 50 }, (_, i) => drawPiece(createRng(`s${i}`)));
    const b = Array.from({ length: 50 }, (_, i) => drawPiece(createRng(`s${i}`)));
    expect(a).toEqual(b);
  });
});
