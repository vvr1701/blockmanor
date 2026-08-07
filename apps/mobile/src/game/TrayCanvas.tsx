/**
 * The 3-piece tray — PRD §7.2 v1.8: pieces render at 50% board-cell scale.
 * ONE Skia canvas (§4.5), separate from the board canvas since it's a
 * visually and layout-independent region (its own height, driven by the
 * tallest piece).
 *
 * State-driven only. `hiddenSlot` (§7.3) is the one exception: while a piece
 * is being dragged, `DragLayer`'s overlay canvas draws it instead (so there's
 * never a duplicate — one static copy here, one flying copy there) — this is
 * a prop toggle, not a per-frame re-render, so it doesn't touch §4.5's
 * budget. A used slot (piece already placed on the board, tray not yet
 * refilled — a real mid-turn state per §6.3) simply renders nothing either.
 */

import { PIECE_BY_ID, pieceColor, type TraySlot } from '@blockmanor/engine';
import { Canvas } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { GlossyBlock } from './GlossyBlock';
import { computeTrayLayout, computeTrayRowLayout, trayCellRect } from './boardLayout';
import { blockColors } from '../components/tokens';
import { glossyGradient } from './colorMath';

const BLOCK_PALETTE: readonly string[] = Object.values(blockColors);

export interface TrayCanvasProps {
  tray: readonly TraySlot[];
  /** Board cell size (px) — tray pieces render at §7.2's fixed 50% of this. */
  boardCellSize: number;
  containerWidth: number;
  /** §7.3: the tray slot index currently being dragged, or `null`. */
  hiddenSlot?: number | null;
}

export const TrayCanvas = React.memo(function TrayCanvas({
  tray,
  boardCellSize,
  containerWidth,
  hiddenSlot = null,
}: TrayCanvasProps): React.JSX.Element {
  const trayLayout = useMemo(() => computeTrayLayout(boardCellSize), [boardCellSize]);

  const row = useMemo(
    () =>
      computeTrayRowLayout(
        tray.map((s) => ({ used: s.used, cells: PIECE_BY_ID[s.pieceId].cells })),
        trayLayout,
        containerWidth,
      ),
    [tray, trayLayout, containerWidth],
  );

  return (
    <Canvas style={{ width: containerWidth, height: row.canvasHeight }}>
      {row.slots.map((slot, i) => {
        if (!slot || i === hiddenSlot) return null;
        const trayPiece = tray[i];
        if (!trayPiece) return null;
        const piece = PIECE_BY_ID[trayPiece.pieceId];
        const gradient = glossyGradient(
          BLOCK_PALETTE[pieceColor(trayPiece.pieceId) % BLOCK_PALETTE.length] as string,
        );
        return (
          <React.Fragment key={i}>
            {piece.cells.map(([r, c], j) => {
              const rect = trayCellRect(r, c, trayLayout);
              return (
                <GlossyBlock
                  key={j}
                  x={slot.originX + rect.x}
                  y={slot.originY + rect.y}
                  size={rect.size}
                  gradient={gradient}
                />
              );
            })}
          </React.Fragment>
        );
      })}
    </Canvas>
  );
});
