import type { CellKind, ObstacleKind } from '@blockmanor/engine';
import { describe, expect, it } from 'vitest';
import { cellVisual } from '../src/game/cellVisual';
import { spriteForObstacle } from '../src/game/obstacleSprites';

const OBSTACLE_KINDS: readonly ObstacleKind[] = ['crate', 'crate2', 'chain', 'ivy', 'heirloom'];

describe('obstacle → sprite mapping (PRD §7.8, all 5 types)', () => {
  it('gives every obstacle a distinct motif shape (§15 deuteranopia: shape, not just color)', () => {
    const motifs = OBSTACLE_KINDS.map((k) => spriteForObstacle(k).motif);
    expect(new Set(motifs).size).toBe(OBSTACLE_KINDS.length);
  });

  it('crate and crate2 share the crate-brown color family (crate2 hit 1 of 2 becomes a crate, §7.8)', () => {
    expect(spriteForObstacle('crate').gradient).toEqual(spriteForObstacle('crate2').gradient);
  });

  it.each(OBSTACLE_KINDS)('sprite for %s round-trips its own kind', (kind) => {
    expect(spriteForObstacle(kind).kind).toBe(kind);
  });

  it('only chain overlays a filled block (§7.8: chain overlays; every other obstacle occupies its own cell)', () => {
    for (const kind of OBSTACLE_KINDS) {
      expect(spriteForObstacle(kind).overlaysFilled).toBe(kind === 'chain');
    }
  });
});

describe('cellVisual (CellKind + colorId → render descriptor)', () => {
  it('empty cell renders as empty, independent of colorId', () => {
    expect(cellVisual('empty', 3)).toEqual({ kind: 'empty' });
  });

  it('filled cell resolves to a 3-stop glossy gradient (§15 glossy top / dark bottom)', () => {
    const visual = cellVisual('filled', 2);
    expect(visual.kind).toBe('filled');
    if (visual.kind === 'filled') expect(visual.gradient).toHaveLength(3);
  });

  it('filled colorId wraps into the 7-color §15 palette instead of throwing on out-of-range input', () => {
    const inRange = cellVisual('filled', 1);
    const wrapped = cellVisual('filled', 1 + 7);
    expect(wrapped).toEqual(inRange);
  });

  it.each(OBSTACLE_KINDS)('%s obstacle cell carries its sprite motif', (kind: ObstacleKind) => {
    const visual = cellVisual(kind, 5);
    expect(visual.kind).toBe('obstacle');
    if (visual.kind === 'obstacle') {
      expect(visual.obstacle).toBe(kind);
      expect(visual.motif).toBe(spriteForObstacle(kind).motif);
    }
  });

  it('chain draws its BASE with the underlying block color, not its own grey family (§7.8 overlay)', () => {
    const chainColorId = 4;
    const filledSameColor = cellVisual('filled', chainColorId);
    const chain = cellVisual('chain', chainColorId);
    if (filledSameColor.kind === 'filled' && chain.kind === 'obstacle') {
      expect(chain.gradient).toEqual(filledSameColor.gradient);
      expect(chain.gradient).not.toEqual(spriteForObstacle('chain').gradient);
    } else {
      throw new Error('unreachable');
    }
  });

  it('non-chain obstacles ignore colorId and always draw their own sprite family', () => {
    const a = cellVisual('crate', 0);
    const b = cellVisual('crate', 6);
    expect(a).toEqual(b);
  });

  it('every non-empty CellKind is handled (exhaustiveness smoke test)', () => {
    const kinds: readonly CellKind[] = ['filled', ...OBSTACLE_KINDS];
    for (const kind of kinds) expect(() => cellVisual(kind, 0)).not.toThrow();
  });
});
