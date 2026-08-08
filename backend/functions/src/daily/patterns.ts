/**
 * Curated Daily-Board prefill templates — PRD §8.2.
 *
 * §8.2: "prefill = 6–14 obstacle-free filled cells from curated pattern
 * templates". Every template below is hand-authored, contains only plain filled
 * cells (no §7.8 obstacle ever appears on the Daily Board), and its cell count
 * is inside the 6–14 band. `assertTemplates()` re-checks both at module load so
 * a bad edit fails loudly instead of shipping an out-of-spec board.
 *
 * Where these live: PRD §16 says content is data in `packages/content`, and §17
 * lists "30 daily-board pattern templates" as a content-ops task that has not
 * been delivered. Until it is, this hand-authored starter set lives beside the
 * generator that consumes it. Moving it to `packages/content` later changes no
 * behaviour — `generate.ts` only needs `PREFILL_TEMPLATES`.
 */

import { BOARD_SIZE } from '@blockmanor/engine';

export interface TemplateCell {
  r: number;
  c: number;
}

export interface PrefillTemplate {
  /** Stable id — recorded nowhere, but makes an authoring diff readable. */
  id: string;
  cells: readonly TemplateCell[];
}

/** §8.2 prefill size band. */
export const PREFILL_MIN_CELLS = 6;
export const PREFILL_MAX_CELLS = 14;

/** 8 rows of 8 chars: `#` = filled, anything else = empty. */
function art(id: string, rows: readonly string[]): PrefillTemplate {
  const cells: TemplateCell[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') cells.push({ r, c });
  });
  return { id, cells };
}

export const PREFILL_TEMPLATES: readonly PrefillTemplate[] = [
  art('left-gutter', [
    '........',
    '#.......',
    '#.......',
    '#.......',
    '#.......',
    '#.......',
    '#.......',
    '........',
  ]),
  art('twin-blocks', [
    '........',
    '.##..##.',
    '.##..##.',
    '........',
    '........',
    '........',
    '........',
    '........',
  ]),
  art('staircase', [
    '........',
    '#.......',
    '##......',
    '###.....',
    '####....',
    '........',
    '........',
    '........',
  ]),
  art('diamond-core', [
    '........',
    '........',
    '...##...',
    '..####..',
    '..####..',
    '...##...',
    '........',
    '........',
  ]),
  art('near-row', [
    '........',
    '........',
    '........',
    '######..',
    '........',
    '........',
    '........',
    '........',
  ]),
  art('offset-bars', [
    '........',
    '........',
    '.#####..',
    '........',
    '..#####.',
    '........',
    '........',
    '........',
  ]),
  art('corner-nest', [
    '###.....',
    '###.....',
    '###.....',
    '........',
    '........',
    '........',
    '........',
    '...#####',
  ]),
  art('scatter', [
    '.#......',
    '........',
    '...#....',
    '......#.',
    '.#......',
    '....#...',
    '.......#',
    '..#..#..',
  ]),
  art('bar-cross', [
    '........',
    '...#....',
    '...#....',
    '.#######',
    '...#....',
    '...#....',
    '........',
    '........',
  ]),
  art('four-corners', [
    '##....##',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '##....##',
  ]),
  art('wave', [
    '........',
    '##......',
    '..##....',
    '....##..',
    '......##',
    '........',
    '........',
    '........',
  ]),
  art('column-pair', [
    '..#..#..',
    '..#..#..',
    '..#..#..',
    '..#..#..',
    '..#..#..',
    '..#..#..',
    '........',
    '........',
  ]),
];

/**
 * The 8 symmetries of the square (D4). Multiplying 12 curated templates by 8
 * orientations is what keeps ~a month of boards from repeating a silhouette,
 * without hand-authoring 96 grids.
 */
export const TEMPLATE_ORIENTATIONS = 8;

/**
 * Apply orientation `o` (0–7): bit 0 mirrors horizontally, bits 1–2 are the
 * number of 90° clockwise rotations. Output is sorted row-major so the cell
 * ORDER is a function of the geometry alone — the generator draws a colour per
 * cell in this order, so an unstable sort would desynchronise two runs of the
 * same seed.
 */
export function orient(cells: readonly TemplateCell[], o: number): TemplateCell[] {
  const mirror = (o & 1) === 1;
  const turns = (o >> 1) & 3;
  const out = cells.map(({ r, c }) => {
    let rr = r;
    let cc = mirror ? BOARD_SIZE - 1 - c : c;
    for (let t = 0; t < turns; t++) {
      const nr = cc;
      const nc = BOARD_SIZE - 1 - rr;
      rr = nr;
      cc = nc;
    }
    return { r: rr, c: cc };
  });
  return out.sort((a, b) => a.r - b.r || a.c - b.c);
}

/** §8.2 invariants, checked at load: obstacle-free is structural, size is not. */
export function assertTemplates(templates: readonly PrefillTemplate[] = PREFILL_TEMPLATES): void {
  if (templates.length === 0) throw new Error('PRD §8.2: no prefill templates');
  for (const t of templates) {
    if (t.cells.length < PREFILL_MIN_CELLS || t.cells.length > PREFILL_MAX_CELLS) {
      throw new Error(
        `PRD §8.2: template "${t.id}" has ${t.cells.length} cells, must be ${PREFILL_MIN_CELLS}–${PREFILL_MAX_CELLS}`,
      );
    }
    const seen = new Set<string>();
    for (const { r, c } of t.cells) {
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
        throw new Error(`PRD §8.2: template "${t.id}" cell (${r},${c}) is off-board`);
      }
      const key = `${r},${c}`;
      if (seen.has(key)) throw new Error(`PRD §8.2: template "${t.id}" repeats cell (${r},${c})`);
      seen.add(key);
    }
  }
}

assertTemplates();
