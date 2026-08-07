/**
 * The one glossy-block draw primitive (§15 "glossy top highlight, dark bottom
 * bevel") — shared by the board (`BoardCanvas`) and the tray (`TrayCanvas`) so
 * a filled cell looks identical at both scales. Still just Skia scene-graph
 * nodes inside whichever single `<Canvas>` the caller owns (§4.5).
 */

import { LinearGradient, RoundedRect, vec } from '@shopify/react-native-skia';
import React from 'react';
import { CELL_RADIUS_MIN, CELL_RADIUS_RATIO } from './boardTokens';

export interface GlossyBlockProps {
  x: number;
  y: number;
  size: number;
  /** Light → base → dark, top-to-bottom. */
  gradient: readonly [string, string, string];
}

export function GlossyBlock({ x, y, size, gradient }: GlossyBlockProps): React.JSX.Element {
  const r = Math.max(CELL_RADIUS_MIN, Math.round(size * CELL_RADIUS_RATIO));
  return (
    <RoundedRect x={x} y={y} width={size} height={size} r={r}>
      <LinearGradient
        start={vec(x, y)}
        end={vec(x, y + size)}
        colors={[gradient[0], gradient[1], gradient[2]]}
      />
    </RoundedRect>
  );
}
