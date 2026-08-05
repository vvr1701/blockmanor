/**
 * Canonical piece set — PRD §6.2. **The IDs are permanent API.**
 *
 * P12–P15 and P16–P19 are given in the PRD as "rotations of <base>"; they are
 * expanded here into concrete cell lists by rotating the base 90° clockwise and
 * normalizing to the top-left corner of the bounding box. The four rotations of
 * each are distinct (asserted in test/pieces.test.ts, which re-derives them).
 *
 * Note that, exactly as in the PRD table for P21 `ess`, a piece's cell list need
 * not contain (0,0): the anchor of §6.3 is the (0,0) *offset*, not a cell.
 */

import { BLOCK_COLOR_COUNT } from './board';
import { nextFloat, type Rng } from './rng';

export type PieceId =
  | 'P01'
  | 'P02'
  | 'P03'
  | 'P04'
  | 'P05'
  | 'P06'
  | 'P07'
  | 'P08'
  | 'P09'
  | 'P10'
  | 'P11'
  | 'P12'
  | 'P13'
  | 'P14'
  | 'P15'
  | 'P16'
  | 'P17'
  | 'P18'
  | 'P19'
  | 'P20'
  | 'P21'
  | 'P22';

export interface Piece {
  id: PieceId;
  name: string;
  /** (row, col) offsets from the placement anchor. */
  cells: readonly (readonly [number, number])[];
  /** Base draw weight (§6.2); overridable per level (§7.7 `pieceWeightOverrides`). */
  weight: number;
}

export const PIECES: readonly Piece[] = [
  { id: 'P01', name: 'dot', cells: [[0, 0]], weight: 6 },
  {
    id: 'P02',
    name: 'duo-h',
    cells: [
      [0, 0],
      [0, 1],
    ],
    weight: 8,
  },
  {
    id: 'P03',
    name: 'duo-v',
    cells: [
      [0, 0],
      [1, 0],
    ],
    weight: 8,
  },
  {
    id: 'P04',
    name: 'tri-h',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
    weight: 8,
  },
  {
    id: 'P05',
    name: 'tri-v',
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    weight: 8,
  },
  {
    id: 'P06',
    name: 'quad-h',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    weight: 6,
  },
  {
    id: 'P07',
    name: 'quad-v',
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    weight: 6,
  },
  {
    id: 'P08',
    name: 'penta-h',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ],
    weight: 3,
  },
  {
    id: 'P09',
    name: 'penta-v',
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ],
    weight: 3,
  },
  {
    id: 'P10',
    name: 'square2',
    cells: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    weight: 8,
  },
  {
    id: 'P11',
    name: 'square3',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ],
    weight: 3,
  },

  // P12–P15 — corner (3-cell L), rotations of (0,0)(1,0)(1,1), 5 each.
  {
    id: 'P12',
    name: 'corner-S',
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    weight: 5,
  },
  {
    id: 'P13',
    name: 'corner-E',
    cells: [
      [0, 0],
      [0, 1],
      [1, 0],
    ],
    weight: 5,
  },
  {
    id: 'P14',
    name: 'corner-N',
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    weight: 5,
  },
  {
    id: 'P15',
    name: 'corner-W',
    cells: [
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    weight: 5,
  },

  // P16–P19 — ell4 (4-cell L), rotations of (0,0)(1,0)(2,0)(2,1), 4 each.
  {
    id: 'P16',
    name: 'ell4-0',
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ],
    weight: 4,
  },
  {
    id: 'P17',
    name: 'ell4-90',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
    ],
    weight: 4,
  },
  {
    id: 'P18',
    name: 'ell4-180',
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    weight: 4,
  },
  {
    id: 'P19',
    name: 'ell4-270',
    cells: [
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    weight: 4,
  },

  {
    id: 'P20',
    name: 'tee',
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
    ],
    weight: 4,
  },
  {
    id: 'P21',
    name: 'ess',
    cells: [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ],
    weight: 3,
  },
  {
    id: 'P22',
    name: 'zed',
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
    weight: 3,
  },
];

// Frozen, not merely `readonly`: a consumer mutating the table at runtime would
// silently break determinism process-wide, and the type system cannot stop it.
for (const piece of PIECES) Object.freeze(Object.freeze(piece).cells);
Object.freeze(PIECES);

export const PIECE_BY_ID: Readonly<Record<PieceId, Piece>> = Object.fromEntries(
  PIECES.map((p) => [p.id, p]),
) as Record<PieceId, Piece>;

export const PIECE_IDS: readonly PieceId[] = PIECES.map((p) => p.id);

/** §6.2 `SMALL_POOL = {P01..P05, P12..P15}` — the mercy pool (§6.4). */
export const SMALL_POOL: readonly PieceId[] = [
  'P01',
  'P02',
  'P03',
  'P04',
  'P05',
  'P12',
  'P13',
  'P14',
  'P15',
];

export type PieceWeightOverrides = Readonly<Partial<Record<PieceId, number>>>;

/**
 * Piece color (§6.1 `filled(colorId)`). Derived from the piece's table position,
 * never from the RNG: the Daily Board sequence is piece IDs only (§8.2), so color
 * has to be reproducible from the ID alone.
 */
export function pieceColor(id: PieceId): number {
  return PIECE_IDS.indexOf(id) % BLOCK_COLOR_COUNT;
}

export function pieceWeight(piece: Piece, overrides?: PieceWeightOverrides): number {
  const override = overrides?.[piece.id];
  return override === undefined ? piece.weight : override;
}

/**
 * Weighted draw with the seeded RNG (§6.2). A weight of 0 excludes the piece.
 * Consumes exactly one random per call.
 */
export function drawPiece(
  rng: Rng,
  pool: readonly PieceId[] = PIECE_IDS,
  overrides?: PieceWeightOverrides,
): PieceId {
  let total = 0;
  for (const id of pool) total += pieceWeight(PIECE_BY_ID[id], overrides);
  if (total <= 0) throw new Error('Piece pool has zero total weight (check pieceWeightOverrides)');

  let roll = nextFloat(rng) * total;
  for (const id of pool) {
    roll -= pieceWeight(PIECE_BY_ID[id], overrides);
    if (roll < 0) return id;
  }
  // Unreachable for finite weights; keeps the return total without a non-null assertion.
  return pool[pool.length - 1] as PieceId;
}
