/**
 * `(CellKind, colorId)` → what to draw — PRD §6.1 cell states + §7.8 obstacles.
 * Pure mapping, no Skia/RN imports, so it's unit-testable on its own.
 */

import type { CellKind } from '@blockmanor/engine';
import { blockColors } from '../components/tokens';
import { glossyGradient } from './colorMath';
import { spriteForObstacle, type MotifShape } from './obstacleSprites';

/** §6.1 `filled(colorId)`: colorId is engine-assigned (`pieceColor()` % 7); the
 * renderer just needs a stable bijection onto the §15 7-color block palette. */
const BLOCK_PALETTE: readonly string[] = Object.values(blockColors);

function colorAt(colorId: number): string {
  const n = BLOCK_PALETTE.length;
  const i = ((colorId % n) + n) % n; // defensive: engine colorId is always 0..6, but never trust input blindly
  return BLOCK_PALETTE[i] as string;
}

export type CellVisual =
  | { kind: 'empty' }
  | { kind: 'filled'; gradient: readonly [string, string, string] }
  | {
      kind: 'obstacle';
      obstacle: Exclude<CellKind, 'empty' | 'filled'>;
      motif: MotifShape;
      /** The gradient the BASE cell rect should draw with — the underlying
       * block's own color for `chain` (§7.8 overlay), the sprite's own
       * color family for every other obstacle. */
      gradient: readonly [string, string, string];
    };

export function cellVisual(kind: CellKind, colorId: number): CellVisual {
  if (kind === 'empty') return { kind: 'empty' };
  if (kind === 'filled') return { kind: 'filled', gradient: glossyGradient(colorAt(colorId)) };

  const sprite = spriteForObstacle(kind);
  return {
    kind: 'obstacle',
    obstacle: kind,
    motif: sprite.motif,
    gradient: sprite.overlaysFilled ? glossyGradient(colorAt(colorId)) : sprite.gradient,
  };
}
