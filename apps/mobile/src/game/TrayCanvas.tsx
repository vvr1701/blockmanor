/**
 * The 3-piece tray — PRD §7.2: pieces render at 60% board-cell scale. ONE Skia
 * canvas (§4.5), separate from the board canvas since it's a visually and
 * layout-independent region (its own height, driven by the tallest piece).
 *
 * State-driven only — no drag (§7.3 is a later session). A used slot (piece
 * already placed on the board, tray not yet refilled — a real mid-turn state
 * per §6.3) simply renders nothing in that slot.
 */

import { PIECE_BY_ID, pieceColor, type TraySlot } from '@blockmanor/engine';
import { Canvas } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { GlossyBlock } from './GlossyBlock';
import { computeTrayLayout, pieceBounds, trayCellRect } from './boardLayout';
import { blockColors } from '../components/tokens';
import { glossyGradient } from './colorMath';
import { TRAY_ROW_PADDING_V } from './boardTokens';

const BLOCK_PALETTE: readonly string[] = Object.values(blockColors);

export interface TrayCanvasProps {
  tray: readonly TraySlot[];
  /** Board cell size (px) — tray pieces render at §7.2's fixed 60% of this. */
  boardCellSize: number;
  containerWidth: number;
}

export const TrayCanvas = React.memo(function TrayCanvas({
  tray,
  boardCellSize,
  containerWidth,
}: TrayCanvasProps): React.JSX.Element {
  const trayLayout = useMemo(() => computeTrayLayout(boardCellSize), [boardCellSize]);

  const slots = useMemo(() => {
    const slotWidth = containerWidth / 3;
    let tallest = trayLayout.pieceCellSize;
    const built = tray.map((slot, i) => {
      if (slot.used) return null;
      const piece = PIECE_BY_ID[slot.pieceId];
      const bounds = pieceBounds(piece.cells);
      const pieceW = bounds.cols * trayLayout.pieceCellSize + (bounds.cols - 1) * trayLayout.gap;
      const pieceH = bounds.rows * trayLayout.pieceCellSize + (bounds.rows - 1) * trayLayout.gap;
      if (pieceH > tallest) tallest = pieceH;
      const originX = i * slotWidth + (slotWidth - pieceW) / 2;
      const gradient = glossyGradient(
        BLOCK_PALETTE[pieceColor(slot.pieceId) % BLOCK_PALETTE.length] as string,
      );
      return { key: i, piece, originX, pieceH, gradient };
    });
    return { built, canvasHeight: tallest + TRAY_ROW_PADDING_V * 2 };
  }, [tray, trayLayout, containerWidth]);

  return (
    <Canvas style={{ width: containerWidth, height: slots.canvasHeight }}>
      {slots.built.map((slot) => {
        if (!slot) return null;
        const originY =
          TRAY_ROW_PADDING_V + (slots.canvasHeight - TRAY_ROW_PADDING_V * 2 - slot.pieceH) / 2;
        return (
          <React.Fragment key={slot.key}>
            {slot.piece.cells.map(([r, c], i) => {
              const rect = trayCellRect(r, c, trayLayout);
              return (
                <GlossyBlock
                  key={i}
                  x={slot.originX + rect.x}
                  y={originY + rect.y}
                  size={rect.size}
                  gradient={slot.gradient}
                />
              );
            })}
          </React.Fragment>
        );
      })}
    </Canvas>
  );
});
