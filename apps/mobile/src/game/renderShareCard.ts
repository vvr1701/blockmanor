/**
 * §8.7 "1080×1080 PNG generated on-device (Skia offscreen)" — paints a
 * `ShareCardModel` and returns base64 PNG, or null when no offscreen surface
 * is available (the share then carries text + link only, never nothing).
 *
 * ponytail: layout is a fixed composition of the mockup's "4.4 Share card
 * asset" (grid, score, tagline, footer) in §15 tokens; its look needs a
 * device screenshot, like the board frame. The CONTENT rules live in
 * `shareCard.ts` and are tested there.
 */

import { matchFont, Skia } from '@shopify/react-native-skia';
import { BOARD_SIZE } from '@blockmanor/engine';
import { colors } from '../components/tokens';
import type { ShareCardModel } from './shareCard';

export const SHARE_CARD_PX = 1080;

const GRID_PX = 640;
const GRID_TOP = 140;
const CELL_GAP = 6;

export function renderShareCard(model: ShareCardModel): string | null {
  const surface = Skia.Surface.MakeOffscreen(SHARE_CARD_PX, SHARE_CARD_PX);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  canvas.clear(Skia.Color(colors.night));

  // Spoiler-free mini-grid: colours only (§8.7).
  const left = (SHARE_CARD_PX - GRID_PX) / 2;
  const cell = (GRID_PX - CELL_GAP * (BOARD_SIZE - 1)) / BOARD_SIZE;
  model.cells.forEach((fill, i) => {
    const r = Math.floor(i / BOARD_SIZE);
    const c = i % BOARD_SIZE;
    paint.setColor(Skia.Color(fill ?? 'rgba(255,255,255,0.06)'));
    const rect = Skia.XYWHRect(
      left + c * (cell + CELL_GAP),
      GRID_TOP + r * (cell + CELL_GAP),
      cell,
      cell,
    );
    canvas.drawRRect(Skia.RRectXY(rect, 14, 14), paint);
  });

  const text = (value: string, y: number, size: number, color: string) => {
    const font = matchFont({ fontSize: size, fontWeight: 'bold' });
    paint.setColor(Skia.Color(color));
    const width = font.measureText(value).width;
    canvas.drawText(value, (SHARE_CARD_PX - width) / 2, y, paint, font);
  };
  text(model.score, GRID_TOP + GRID_PX + 120, 96, colors.gold);
  text(model.tagline, GRID_TOP + GRID_PX + 190, 44, colors.cream);
  text(model.footer, SHARE_CARD_PX - 48, 30, colors.muted);

  surface.flush();
  return surface.makeImageSnapshot().encodeToBase64();
}
