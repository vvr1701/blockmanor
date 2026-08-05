/**
 * Scoring — PRD §6.6 (exact formulas).
 *
 * - Placement: `+cellCount`
 * - Clear: `+ score_clear_base × clearedCellCount × linesClearedSimultaneously`
 * - Combo: counter starts 0, +1 on any clearing placement, resets to 0 after TWO
 *   consecutive non-clearing placements. Clear points × `(1 + combo_step × combo)`,
 *   floored.
 * - Perfect clear: flat `perfect_clear_bonus` (not combo-multiplied — "flat").
 *
 * Multiplier timing is SPEC, not interpretation (§6.6, explicit since PRD v1.6):
 * the multiplier uses the combo counter as it stood BEFORE this placement's
 * increment, so 1st clear ×1.0 → counter 1, 2nd consecutive clear ×1.25, etc.
 * The LINES_CLEARED event carries the POST-increment value as `comboDisplay`,
 * because that is the combo level the renderer shows ("COMBO x2!") — a first
 * clear is comboDisplay 1 while scoring ×1.0. The two differ by one by design.
 *
 * `clearedCellCount` is the size of the cleared union (§6.5), including cells
 * that survive as obstacles (`crate2`→`crate`, `chain`→`filled`).
 */

import type { LevelStars } from './levels';

/** Reset after TWO consecutive non-clearing placements (§6.6). */
export const COMBO_RESET_AFTER_MISSES = 2;

export function placementPoints(cellCount: number): number {
  return cellCount;
}

export function clearPoints(
  base: number,
  clearedCellCount: number,
  linesCleared: number,
  comboStep: number,
  combo: number,
): number {
  return Math.floor(base * clearedCellCount * linesCleared * (1 + comboStep * combo));
}

/** §7.5: star 1 = win; stars 2/3 are score thresholds from the level schema. */
export function starsFor(score: number, stars: LevelStars | undefined): number {
  if (!stars) return 1;
  if (score >= stars.s3) return 3;
  if (score >= stars.s2) return 2;
  return 1;
}
