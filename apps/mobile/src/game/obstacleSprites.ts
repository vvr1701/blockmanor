/**
 * Obstacle → sprite mapping — PRD §7.8 (5 types) rendered per §15's "obstacles
 * differ by SHAPE, not only color" deuteranopia rule.
 *
 * Traced verbatim from the labelled "Obstacle tiles" reference panel in
 * `docs/design/spec/Block Manor Production Spec.dc.html` — `V.obstacleSet`
 * (`'cCkidhuw'`, line 3939) rendered by its `cell()` helper, `OBNAME` (line
 * 3884) naming each, colors in the `P` table and per-type geometry in
 * `cell()` at lines 3908–3916:
 *   - `c`/`C` (crate/crate2) share `P.c`/`P.C` (identical browns — crate2's
 *     2nd hit becomes a `crate`, §7.8). `crate` = two planks crossed at ±38°
 *     (:3908–3909). `crate2` keeps only the −38° plank and replaces the
 *     second with a small dark pill + "2" numeral (:3910–3911) — the numeral,
 *     not a plank count, is what actually reads as "needs 2 hits" to a
 *     player, so `BoardCanvas` renders it as real text, not a decoration.
 *   - `k` (chain) = a horizontal linked steel bar spanning the cell plus a
 *     ring outline centered over it (:3913).
 *   - `i` (ivy) = two leaves, one large centered + one small offset toward
 *     the top-left (:3914).
 *   - `h` (heirloom) = a rounded-square item plus a diagonal chain-linked bar
 *     at −24° (:3916).
 * `d` (Darkness/candles) and `u`/`w` (Dust/Cobweb) in that panel are not
 * PRD §7.8 obstacles and are not modeled here.
 */

import type { ObstacleKind } from '@blockmanor/engine';

export type MotifShape = 'crossPlank' | 'plankBadge' | 'chainBar' | 'leafPair' | 'itemChain';

export interface ObstacleSprite {
  kind: ObstacleKind;
  /** Light → base → dark, top-to-bottom (§15 glossy look). */
  gradient: readonly [string, string, string];
  motif: MotifShape;
  /**
   * `chain` overlays an already-filled block (§7.8): its own gradient is
   * unused for the base cell — the base draws with the underlying block's own
   * color, and only the chain-bar-and-ring motif comes from this sprite.
   */
  overlaysFilled: boolean;
}

const OBSTACLE_SPRITES: Readonly<Record<ObstacleKind, ObstacleSprite>> = {
  crate: {
    kind: 'crate',
    gradient: ['#C79463', '#8E5F38', '#59371D'],
    motif: 'crossPlank',
    overlaysFilled: false,
  },
  crate2: {
    kind: 'crate2',
    gradient: ['#C79463', '#8E5F38', '#59371D'],
    motif: 'plankBadge',
    overlaysFilled: false,
  },
  chain: {
    kind: 'chain',
    gradient: ['#A9B2C9', '#6E7899', '#3C4463'],
    motif: 'chainBar',
    overlaysFilled: true,
  },
  ivy: {
    kind: 'ivy',
    gradient: ['#A9D888', '#5E9440', '#33612A'],
    motif: 'leafPair',
    overlaysFilled: false,
  },
  heirloom: {
    kind: 'heirloom',
    gradient: ['#FBE7AE', '#E9C46A', '#A8761A'],
    motif: 'itemChain',
    overlaysFilled: false,
  },
};

export function spriteForObstacle(kind: ObstacleKind): ObstacleSprite {
  return OBSTACLE_SPRITES[kind];
}
