/**
 * The board — PRD §7.2 / §4.5 (v1.8). ONE Skia canvas; per-cell Skia
 * scene-graph nodes are explicitly permitted by §4.5 — what's banned is a
 * per-cell React Native view.
 *
 * State-driven only: this component re-renders React at most once per
 * placement, when `board` changes, and does nothing else. §4.5 (v1.8) is
 * explicit that this is as far as this file goes: drag preview (§7.3) and
 * clear/combo juice (§7.4) must animate via Skia/Reanimated shared values on
 * the UI thread in a later session, never by re-rendering this cell tree
 * per frame — that re-render-per-frame path is the one §4.5 actually bans.
 */

import { BOARD_SIZE, cellColor, cellKind, type Board } from '@blockmanor/engine';
import {
  Canvas,
  Circle,
  Group,
  Path,
  RoundedRect,
  Text,
  matchFont,
  vec,
  type SkFont,
} from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { GlossyBlock } from './GlossyBlock';
import {
  CELL_RADIUS_MIN,
  CELL_RADIUS_RATIO,
  MOTIF_BADGE_BG,
  MOTIF_BADGE_FONT_SIZE_RATIO,
  MOTIF_BADGE_INSET_RATIO,
  MOTIF_BADGE_SIZE_RATIO,
  MOTIF_BADGE_TEXT_COLOR,
  MOTIF_CHAIN_BAR_COLOR,
  MOTIF_CHAIN_BAR_HEIGHT_RATIO,
  MOTIF_CHAIN_BAR_WIDTH_RATIO,
  MOTIF_CHAIN_RING_COLOR,
  MOTIF_CHAIN_RING_SIZE_RATIO,
  MOTIF_CHAIN_RING_STROKE_MIN,
  MOTIF_CHAIN_RING_STROKE_RATIO,
  MOTIF_ITEM_BAND_ANGLE_RAD,
  MOTIF_ITEM_BAND_HEIGHT_RATIO,
  MOTIF_ITEM_OPACITY,
  MOTIF_ITEM_RADIUS_RATIO,
  MOTIF_ITEM_SIZE_RATIO,
  MOTIF_LEAF_BIG_HEIGHT_RATIO,
  MOTIF_LEAF_BIG_OPACITY,
  MOTIF_LEAF_BIG_WIDTH_RATIO,
  MOTIF_LEAF_SMALL_HEIGHT_RATIO,
  MOTIF_LEAF_SMALL_OFFSET_X_RATIO,
  MOTIF_LEAF_SMALL_OFFSET_Y_RATIO,
  MOTIF_LEAF_SMALL_OPACITY,
  MOTIF_LEAF_SMALL_WIDTH_RATIO,
  MOTIF_PLANK_ANGLE_RAD,
  MOTIF_PLANK_OPACITY,
  MOTIF_PLANK_THICKNESS_RATIO,
  MOTIF_PLANK_WIDTH_RATIO,
} from './boardTokens';
import { cellRect, computeBoardLayout, type BoardLayout, type CellRect } from './boardLayout';
import { cellVisual, type CellVisual } from './cellVisual';
import type { MotifShape } from './obstacleSprites';

/** Unit-square (0..1) leaf outline, scaled/offset into a rect within the cell.
 * Approximates the Production Spec's `border-radius:70% 8% 70% 8%` leaf blob
 * (Skia's RoundedRect radius can't express 4 independent corners) — same
 * silhouette family (rounded lens), not a pixel trace. */
function leafPathD(x: number, y: number, w: number, h: number): string {
  const p = (u: number, v: number): string => `${x + u * w},${y + v * h}`;
  return `M${p(0.5, 0)} C${p(0.85, 0.2)} ${p(0.85, 0.8)} ${p(0.5, 1)} C${p(0.15, 0.8)} ${p(0.15, 0.2)} ${p(0.5, 0)} Z`;
}

function Plank({
  cx,
  cy,
  w,
  h,
  angle,
}: {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}): React.JSX.Element {
  return (
    <RoundedRect
      x={cx - w / 2}
      y={cy - h / 2}
      width={w}
      height={h}
      r={h / 2}
      color="black"
      opacity={MOTIF_PLANK_OPACITY}
      transform={[{ rotate: angle }]}
      origin={vec(cx, cy)}
    />
  );
}

/** crate2's "2" badge (Production Spec :3910–3911) — real text, not a shape:
 * the numeral is what actually reads as "needs 2 hits" to a player. */
function Badge({ rect, font }: { rect: CellRect; font: SkFont }): React.JSX.Element {
  const size = rect.size * MOTIF_BADGE_SIZE_RATIO;
  const inset = rect.size * MOTIF_BADGE_INSET_RATIO;
  const cx = rect.x + rect.size - inset - size / 2;
  const cy = rect.y + rect.size - inset - size / 2;
  const glyph = font.measureText('2');
  return (
    <>
      <Circle cx={cx} cy={cy} r={size / 2} color={MOTIF_BADGE_BG} />
      <Text
        x={cx - glyph.width / 2}
        y={cy + glyph.height / 2}
        text="2"
        font={font}
        color={MOTIF_BADGE_TEXT_COLOR}
      />
    </>
  );
}

function Motif({
  rect,
  motif,
  badgeFont,
}: {
  rect: CellRect;
  motif: MotifShape;
  badgeFont: SkFont;
}): React.JSX.Element {
  const cx = rect.x + rect.size / 2;
  const cy = rect.y + rect.size / 2;

  if (motif === 'crossPlank' || motif === 'plankBadge') {
    const w = rect.size * MOTIF_PLANK_WIDTH_RATIO;
    const h = rect.size * MOTIF_PLANK_THICKNESS_RATIO;
    return motif === 'crossPlank' ? (
      <Group>
        <Plank cx={cx} cy={cy} w={w} h={h} angle={-MOTIF_PLANK_ANGLE_RAD} />
        <Plank cx={cx} cy={cy} w={w} h={h} angle={MOTIF_PLANK_ANGLE_RAD} />
      </Group>
    ) : (
      <Group>
        <Plank cx={cx} cy={cy} w={w} h={h} angle={-MOTIF_PLANK_ANGLE_RAD} />
        <Badge rect={rect} font={badgeFont} />
      </Group>
    );
  }

  if (motif === 'chainBar') {
    const barW = rect.size * MOTIF_CHAIN_BAR_WIDTH_RATIO;
    const barH = rect.size * MOTIF_CHAIN_BAR_HEIGHT_RATIO;
    const ringSize = rect.size * MOTIF_CHAIN_RING_SIZE_RATIO;
    return (
      <Group>
        <RoundedRect
          x={cx - barW / 2}
          y={cy - barH / 2}
          width={barW}
          height={barH}
          r={2}
          color={MOTIF_CHAIN_BAR_COLOR}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={ringSize / 2}
          style="stroke"
          strokeWidth={Math.max(
            MOTIF_CHAIN_RING_STROKE_MIN,
            rect.size * MOTIF_CHAIN_RING_STROKE_RATIO,
          )}
          color={MOTIF_CHAIN_RING_COLOR}
        />
      </Group>
    );
  }

  if (motif === 'leafPair') {
    const bigW = rect.size * MOTIF_LEAF_BIG_WIDTH_RATIO;
    const bigH = rect.size * MOTIF_LEAF_BIG_HEIGHT_RATIO;
    const smallW = rect.size * MOTIF_LEAF_SMALL_WIDTH_RATIO;
    const smallH = rect.size * MOTIF_LEAF_SMALL_HEIGHT_RATIO;
    return (
      <Group>
        <Path
          path={leafPathD(cx - bigW / 2, cy - bigH / 2, bigW, bigH)}
          color="white"
          opacity={MOTIF_LEAF_BIG_OPACITY}
        />
        <Path
          path={leafPathD(
            rect.x + rect.size * MOTIF_LEAF_SMALL_OFFSET_X_RATIO,
            rect.y + rect.size * MOTIF_LEAF_SMALL_OFFSET_Y_RATIO,
            smallW,
            smallH,
          )}
          color="white"
          opacity={MOTIF_LEAF_SMALL_OPACITY}
        />
      </Group>
    );
  }

  // 'itemChain' (heirloom): rounded-square item + a diagonal chain-linked bar.
  const itemSize = rect.size * MOTIF_ITEM_SIZE_RATIO;
  const bandW = rect.size * MOTIF_CHAIN_BAR_WIDTH_RATIO;
  const bandH = rect.size * MOTIF_ITEM_BAND_HEIGHT_RATIO;
  return (
    <Group>
      <RoundedRect
        x={cx - itemSize / 2}
        y={cy - itemSize / 2}
        width={itemSize}
        height={itemSize}
        r={itemSize * MOTIF_ITEM_RADIUS_RATIO}
        color="white"
        opacity={MOTIF_ITEM_OPACITY}
      />
      <RoundedRect
        x={cx - bandW / 2}
        y={cy - bandH / 2}
        width={bandW}
        height={bandH}
        r={2}
        color={MOTIF_CHAIN_BAR_COLOR}
        transform={[{ rotate: MOTIF_ITEM_BAND_ANGLE_RAD }]}
        origin={vec(cx, cy)}
      />
    </Group>
  );
}

function Cell({
  rect,
  visual,
  badgeFont,
}: {
  rect: CellRect;
  visual: CellVisual;
  badgeFont: SkFont;
}): React.JSX.Element {
  const radius = Math.max(CELL_RADIUS_MIN, Math.round(rect.size * CELL_RADIUS_RATIO));

  if (visual.kind === 'empty') {
    return (
      <RoundedRect
        x={rect.x}
        y={rect.y}
        width={rect.size}
        height={rect.size}
        r={radius}
        color="white"
        opacity={0.045}
      />
    );
  }

  return (
    <>
      <GlossyBlock x={rect.x} y={rect.y} size={rect.size} gradient={visual.gradient} />
      {visual.kind === 'obstacle' ? (
        <Motif rect={rect} motif={visual.motif} badgeFont={badgeFont} />
      ) : null}
    </>
  );
}

export interface BoardCanvasProps {
  board: Board;
  /** Available width to fit the (always-square) board into. */
  containerWidth: number;
}

/** `React.memo`'d: re-renders only when the board reference or width changes —
 * placements always clone the board (§4.3 `cloneState`), so reference equality
 * is a correct, cheap "did anything change" check. */
export const BoardCanvas = React.memo(function BoardCanvas({
  board,
  containerWidth,
}: BoardCanvasProps): React.JSX.Element {
  const layout: BoardLayout = useMemo(() => computeBoardLayout(containerWidth), [containerWidth]);

  // One system-font match per layout (not per cell/frame) for crate2's "2" badge.
  const badgeFont = useMemo(
    () =>
      matchFont({
        fontFamily: 'System',
        fontWeight: '900',
        fontSize: layout.cellSize * MOTIF_BADGE_FONT_SIZE_RATIO,
      }),
    [layout.cellSize],
  );

  const cells = useMemo(() => {
    const out: { key: number; rect: CellRect; visual: CellVisual }[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        out.push({
          key: r * BOARD_SIZE + c,
          rect: cellRect(r, c, layout),
          visual: cellVisual(cellKind(board, r, c), cellColor(board, r, c)),
        });
      }
    }
    return out;
  }, [board, layout]);

  return (
    <Canvas style={{ width: layout.canvasSize, height: layout.canvasSize }}>
      {cells.map(({ key, rect, visual }) => (
        <Cell key={key} rect={rect} visual={visual} badgeFont={badgeFont} />
      ))}
    </Canvas>
  );
});
