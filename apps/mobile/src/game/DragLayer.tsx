/**
 * Drag input + ghost preview — PRD §7.3 (v1.9: release is a three-way
 * outcome — legal / illegal-hover / cancelled — see the §7.3 doc comment on
 * `.onFinalize` below). §4.5 v1.8's architectural spine for this file: the
 * drag animates via Reanimated shared values feeding Skia scene-graph props
 * directly (react-native-skia's documented Reanimated integration —
 * `materialize()` reads `.value` off a shared value passed as any prop, on
 * the UI thread, every frame) — React never re-renders during the
 * continuous part of a drag. React re-renders at most 3 times per gesture:
 * touch-down (`onDragIndexChange`, to know which piece's cells to draw and
 * to hide it from the static `TrayCanvas`), a legal commit (`onPlace`, one
 * `applyPlacement` — the §4.5 "at most once per board-state change" budget),
 * and cleanup once the release animation finishes (`endDrag`, clearing the
 * drag-index hide). None of the three is a per-frame re-render.
 *
 * Legality is never recomputed here: `getLegalPlacements` (the engine's own
 * public §4.3 API) is called ONCE per gesture, on the JS thread, at touch-down.
 * The result — a plain list of {r,c} anchors — is handed to the UI-thread
 * worklet as data; the worklet only ever does arithmetic against that list
 * (`dragAnchors.ts`), it never re-derives what's legal.
 *
 * Lives in an overlay Skia canvas spanning the board+tray strip (the §7.3
 * prereq: BoardCanvas and TrayCanvas stay two independently-tested, clipped
 * canvases; this third canvas sits on top so a piece dragged from the tray
 * onto the board is never clipped crossing the gap between them) plus up to
 * 3 plain RN gesture hitboxes (one per un-used tray slot — not a per-CELL
 * view, so this doesn't touch the §4.5 "no per-cell RN view" rule).
 *
 * `dragX`/`dragY` hold the piece's on-screen CENTER (not top-left): scale
 * (below) pivots around the piece's own local center, so a translate that
 * targets the CENTER stays correct regardless of the current scale — no
 * separate "recompute top-left for this scale" step needed when the illegal
 * return shrinks the piece from 100% board scale down to the tray's 50%.
 */

import {
  BOARD_SIZE,
  PIECE_BY_ID,
  getLegalPlacements,
  pieceColor,
  type GameState,
  type PieceId,
} from '@blockmanor/engine';
import {
  Canvas,
  Group,
  LinearGradient,
  RoundedRect,
  Shadow,
  vec,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { blockColors, colors } from '../components/tokens';
import type { BoardLayout, TrayRowLayout } from './boardLayout';
import { pieceBounds } from './boardLayout';
import { CELL_RADIUS_MIN, CELL_RADIUS_RATIO, TRAY_SCALE } from './boardTokens';
import { glossyGradient } from './colorMath';
import { clampToGrid, isNearBoard, nearestAnchor, type AnchorPoint } from './dragAnchors';
import {
  BOARD_SHAKE_MS,
  BOARD_SHAKE_PX,
  GHOST_HIDE_MARGIN_CELLS,
  GHOST_TINT_OPACITY,
  ILLEGAL_DROP_HAPTIC_STYLE,
  LIFT_OFFSET_Y,
  LIFT_SHADOW_BLUR,
  LIFT_SHADOW_COLOR,
  LIFT_SHADOW_DX,
  LIFT_SHADOW_DY,
  LIFT_TILT_DEG,
  RETURN_EASE_MS,
  SNAP_RADIUS_CELLS,
  SNAP_SPRING_DAMPING_RATIO,
  SNAP_SPRING_MS,
  TRAY_HITBOX_MIN_DP,
} from './juice';

const BLOCK_PALETTE: readonly string[] = Object.values(blockColors);

/** Tallest piece is 5 rows (P09 penta-v); +1 row of buffer for the shadow
 * blur and rounding, so the overlay canvas never clips the lifted piece
 * regardless of which piece or cell size is in play. */
const MAX_LIFT_ROWS = 6;

interface GhostState {
  visible: boolean;
  legal: boolean;
  r: number;
  c: number;
}

const GHOST_HIDDEN: GhostState = { visible: false, legal: false, r: 0, c: 0 };

function localCellRect(dr: number, dc: number, cellSize: number, gap: number) {
  return { x: dc * (cellSize + gap), y: dr * (cellSize + gap), size: cellSize };
}

export interface DragLayerProps {
  state: GameState;
  boardLayout: BoardLayout;
  /** Board canvas's horizontal centering offset within `containerWidth`
   * (`boardWrap`'s `alignItems: 'center'`, §7.2). */
  boardOffsetX: number;
  trayRow: TrayRowLayout;
  /** Tray canvas's vertical offset within the play-surface stack (board
   * height + the §7.2 booster-row reservation). */
  trayOffsetY: number;
  containerWidth: number;
  /** Total height of the board+booster-gap+tray stack this overlay spans. */
  playAreaHeight: number;
  /** Legal release: commit the placement via the engine's own API (§4.3). */
  onPlace: (pieceIndex: number, r: number, c: number) => void;
  /** Which tray slot is mid-drag, or `null` — lets the caller hide that
   * slot's static copy in `TrayCanvas` (there is only ever one flying copy). */
  onDragIndexChange: (index: number | null) => void;
  /** §7.3 illegal-drop-only shake target — a plain RN View transform the
   * caller applies to the board container (owning it here would mean this
   * component reaches outside its own canvas to style a sibling). */
  boardShakeX: SharedValue<number>;
  reducedMotion: boolean;
}

export function DragLayer({
  state,
  boardLayout,
  boardOffsetX,
  trayRow,
  trayOffsetY,
  containerWidth,
  playAreaHeight,
  onPlace,
  onDragIndexChange,
  boardShakeX,
  reducedMotion,
}: DragLayerProps): React.JSX.Element {
  const [dragging, setDragging] = useState<{ index: number; pieceId: PieceId } | null>(null);

  const headroom =
    LIFT_OFFSET_Y + MAX_LIFT_ROWS * (boardLayout.cellSize + boardLayout.gap) + LIFT_SHADOW_BLUR * 2;

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragScale = useSharedValue(1);
  const dragOpacity = useSharedValue(0);
  const tiltDeg = useSharedValue(0);
  const ghost = useSharedValue<GhostState>(GHOST_HIDDEN);
  const reducedMotionSV = useSharedValue(reducedMotion);
  reducedMotionSV.value = reducedMotion;

  const startDrag = (index: number, pieceId: PieceId): void => {
    setDragging({ index, pieceId });
    onDragIndexChange(index);
  };
  const endDrag = (): void => {
    setDragging(null);
    onDragIndexChange(null);
  };
  const triggerIllegalHaptic = (): void => {
    void Haptics.impactAsync(ILLEGAL_DROP_HAPTIC_STYLE);
  };

  // One Pan gesture per un-used tray slot. Rebuilt whenever the board/tray
  // state changes (a real re-render, not a per-frame event) so every
  // gesture's captured anchors/origins are always for the CURRENT state —
  // never recomputed mid-drag.
  const gestures = useMemo(() => {
    const cellStep = boardLayout.cellSize + boardLayout.gap;
    return state.tray.map((slot, index) => {
      const slotLayout = trayRow.slots[index];
      if (slot.used || !slotLayout) return null;

      const piece = PIECE_BY_ID[slot.pieceId];
      const bounds = pieceBounds(piece.cells);
      const liftPieceW = bounds.cols * boardLayout.cellSize + (bounds.cols - 1) * boardLayout.gap;
      const liftPieceH = bounds.rows * boardLayout.cellSize + (bounds.rows - 1) * boardLayout.gap;

      const hitboxW = Math.max(TRAY_HITBOX_MIN_DP, slotLayout.pieceW);
      const hitboxH = Math.max(TRAY_HITBOX_MIN_DP, slotLayout.pieceH);
      const pieceCenterX = slotLayout.originX + slotLayout.pieceW / 2;
      const pieceCenterY = trayOffsetY + slotLayout.originY + slotLayout.pieceH / 2;
      const hitboxLeft = pieceCenterX - hitboxW / 2;
      const hitboxTop = pieceCenterY - hitboxH / 2;

      // Return target for BOTH release-illegal cases (§7.3 v1.9) is the tray
      // slot's own CENTER, at the tray's 50% scale — `dragScale` animates
      // 1 -> TRAY_SCALE alongside this so the piece shrinks into the slot
      // instead of a 100%-board-scale shape flying into (and clipping past)
      // a 50%-scale footprint.
      const originTrayCenterX = pieceCenterX;
      const originTrayCenterY = headroom + pieceCenterY;

      const anchors: AnchorPoint[] = getLegalPlacements(state, index).map((p) => ({
        r: p.r,
        c: p.c,
      }));

      const pan = Gesture.Pan()
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin((e) => {
          'worklet';
          const fingerX = hitboxLeft + e.x;
          const fingerY = hitboxTop + e.y;
          dragX.value = fingerX;
          dragY.value = fingerY - LIFT_OFFSET_Y + headroom;
          dragScale.value = 1;
          dragOpacity.value = 1;
          tiltDeg.value = LIFT_TILT_DEG;
          ghost.value = GHOST_HIDDEN;
          runOnJS(startDrag)(index, slot.pieceId);
        })
        .onUpdate((e) => {
          'worklet';
          const fingerX = hitboxLeft + e.x;
          const fingerY = hitboxTop + e.y;
          const centerX = fingerX;
          const centerY = fingerY - LIFT_OFFSET_Y;
          dragX.value = centerX;
          dragY.value = centerY + headroom;

          const topLeftX = centerX - liftPieceW / 2;
          const topLeftY = centerY - liftPieceH / 2;
          const boardLocalX = topLeftX - boardOffsetX - boardLayout.padding;
          const boardLocalY = topLeftY - boardLayout.padding;
          const near = isNearBoard(
            boardLocalX,
            boardLocalY,
            boardLayout.gridSize,
            cellStep,
            GHOST_HIDE_MARGIN_CELLS,
          );
          if (!near) {
            ghost.value = GHOST_HIDDEN;
            return;
          }
          const nearest = nearestAnchor(
            anchors,
            boardLocalX,
            boardLocalY,
            cellStep,
            SNAP_RADIUS_CELLS,
          );
          if (nearest) {
            ghost.value = { visible: true, legal: true, r: nearest.r, c: nearest.c };
          } else {
            const clamped = clampToGrid(
              boardLocalX,
              boardLocalY,
              cellStep,
              bounds.rows,
              bounds.cols,
              BOARD_SIZE,
            );
            ghost.value = { visible: true, legal: false, r: clamped.r, c: clamped.c };
          }
        })
        // §7.3 v1.9 / qa-prd-auditor BLOCKER 1: `.onEnd` never fires for a
        // plain tap (DOWN->UP with no MOVE never reaches ACTIVE, so it goes
        // BEGAN->FAILED on both platforms, skipping `.onEnd` entirely).
        // `.onFinalize` fires from every terminal state — BEGAN->FAILED
        // included — so it's the only place cleanup can safely live.
        .onFinalize((_e, success) => {
          'worklet';
          const g = ghost.value;
          ghost.value = GHOST_HIDDEN;
          if (success && g.visible && g.legal) {
            const targetX = boardOffsetX + boardLayout.padding + g.c * cellStep + liftPieceW / 2;
            const targetY = headroom + boardLayout.padding + g.r * cellStep + liftPieceH / 2;
            dragX.value = withSpring(targetX, {
              duration: SNAP_SPRING_MS,
              dampingRatio: SNAP_SPRING_DAMPING_RATIO,
            });
            dragY.value = withSpring(targetY, {
              duration: SNAP_SPRING_MS,
              dampingRatio: SNAP_SPRING_DAMPING_RATIO,
            });
            tiltDeg.value = withTiming(0, { duration: SNAP_SPRING_MS });
            dragOpacity.value = withTiming(0, { duration: SNAP_SPRING_MS }, (finished) => {
              if (finished) runOnJS(endDrag)();
            });
            runOnJS(onPlace)(index, g.r, g.c);
            return;
          }

          // §7.3 v1.9: a ghost was shown (a real illegal hover) gets the
          // haptic + shake; NO ghost ever shown this gesture (a tap, or a
          // hesitant nudge that never entered the board region) is a silent
          // cancel — same return tween, no punishment.
          const wasIllegalHover = g.visible;
          if (wasIllegalHover) {
            runOnJS(triggerIllegalHaptic)();
          }
          dragScale.value = withTiming(TRAY_SCALE, {
            duration: RETURN_EASE_MS,
            easing: Easing.out(Easing.ease),
          });
          dragX.value = withTiming(
            originTrayCenterX,
            { duration: RETURN_EASE_MS, easing: Easing.out(Easing.ease) },
            (finished) => {
              if (finished) runOnJS(endDrag)();
            },
          );
          dragY.value = withTiming(originTrayCenterY, {
            duration: RETURN_EASE_MS,
            easing: Easing.out(Easing.ease),
          });
          tiltDeg.value = withTiming(0, { duration: RETURN_EASE_MS });
          if (wasIllegalHover && !reducedMotionSV.value) {
            boardShakeX.value = withSequence(
              withTiming(-BOARD_SHAKE_PX, { duration: BOARD_SHAKE_MS / 4 }),
              withTiming(BOARD_SHAKE_PX, { duration: BOARD_SHAKE_MS / 2 }),
              withTiming(0, { duration: BOARD_SHAKE_MS / 4 }),
            );
          }
        });

      return { index, pan, hitboxLeft, hitboxTop, hitboxW, hitboxH };
    });
    // `state` covers board+tray together (both drive legality/origins); the
    // shared values and JS callbacks above are stable across renders.
  }, [state, boardLayout, boardOffsetX, trayRow, trayOffsetY, headroom]);

  const cellRects = useMemo(() => {
    if (!dragging) return [];
    return PIECE_BY_ID[dragging.pieceId].cells.map(([dr, dc]) =>
      localCellRect(dr, dc, boardLayout.cellSize, boardLayout.gap),
    );
  }, [dragging, boardLayout]);

  const liftBounds = useMemo(() => {
    if (!dragging) return { w: 0, h: 0 };
    const b = pieceBounds(PIECE_BY_ID[dragging.pieceId].cells);
    return {
      w: b.cols * boardLayout.cellSize + (b.cols - 1) * boardLayout.gap,
      h: b.rows * boardLayout.cellSize + (b.rows - 1) * boardLayout.gap,
    };
  }, [dragging, boardLayout]);

  const gradient = useMemo(() => {
    if (!dragging) return glossyGradient(BLOCK_PALETTE[0] as string);
    return glossyGradient(
      BLOCK_PALETTE[pieceColor(dragging.pieceId) % BLOCK_PALETTE.length] as string,
    );
  }, [dragging]);

  const cellRadius = Math.max(
    CELL_RADIUS_MIN,
    Math.round(boardLayout.cellSize * CELL_RADIUS_RATIO),
  );

  const ghostOpacity = useDerivedValue(() => (ghost.value.visible ? GHOST_TINT_OPACITY : 0));
  const ghostColor = useDerivedValue(() => (ghost.value.legal ? colors.ok : colors.bad));
  const cellStep = boardLayout.cellSize + boardLayout.gap;

  // Skia types individual `transform` array ITEMS as plain numbers (the
  // runtime accepts a shared value there too, via `materialize()`'s generic
  // prop walk, but the array-item typing doesn't reflect that) — the
  // correctly-typed pattern is one `useDerivedValue` producing the WHOLE
  // array, which every Skia transform prop below takes as a `DerivedValue`.
  const ghostTransform = useDerivedValue(() => [
    { translateX: boardOffsetX + boardLayout.padding + ghost.value.c * cellStep },
    { translateY: headroom + boardLayout.padding + ghost.value.r * cellStep },
  ]);
  // Outer group: pure translate, no origin — `dragX`/`dragY` are the desired
  // on-screen CENTER, so this positions the piece's local (unscaled)
  // top-left such that its local center lands there.
  const dragTransform = useDerivedValue(() => [
    { translateX: dragX.value - liftBounds.w / 2 },
    { translateY: dragY.value - liftBounds.h / 2 },
  ]);
  // Inner group: scale + rotate, both pivoting on the SAME local-center
  // `origin` below — since neither carries a translate of its own, scaling
  // this group can never move the point the outer group already placed at
  // `(dragX, dragY)` (that's BLOCKER 2's fix: the illegal return shrinks
  // 1 -> TRAY_SCALE in place, anchored on the tray slot's center, instead of
  // a 100%-scale shape flying top-left-first into a 50%-scale slot).
  const scaleRotateTransform = useDerivedValue(() => [
    { scale: dragScale.value },
    { rotate: (tiltDeg.value * Math.PI) / 180 },
  ]);

  return (
    <>
      <Canvas
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: -headroom,
          width: containerWidth,
          height: playAreaHeight + headroom,
        }}
      >
        <Group transform={ghostTransform} opacity={ghostOpacity}>
          {cellRects.map((rect, i) => (
            <RoundedRect
              key={i}
              x={rect.x}
              y={rect.y}
              width={rect.size}
              height={rect.size}
              r={cellRadius}
              color={ghostColor}
            />
          ))}
        </Group>
        <Group transform={dragTransform} opacity={dragOpacity}>
          <Group transform={scaleRotateTransform} origin={vec(liftBounds.w / 2, liftBounds.h / 2)}>
            {cellRects.map((rect, i) => (
              <RoundedRect
                key={i}
                x={rect.x}
                y={rect.y}
                width={rect.size}
                height={rect.size}
                r={cellRadius}
              >
                <LinearGradient
                  start={vec(rect.x, rect.y)}
                  end={vec(rect.x, rect.y + rect.size)}
                  colors={[gradient[0], gradient[1], gradient[2]]}
                />
                <Shadow
                  dx={LIFT_SHADOW_DX}
                  dy={LIFT_SHADOW_DY}
                  blur={LIFT_SHADOW_BLUR}
                  color={LIFT_SHADOW_COLOR}
                />
              </RoundedRect>
            ))}
          </Group>
        </Group>
      </Canvas>

      {gestures.map((g) => {
        if (!g) return null;
        return (
          <GestureDetector key={g.index} gesture={g.pan}>
            <View
              style={[
                styles.hitbox,
                { left: g.hitboxLeft, top: g.hitboxTop, width: g.hitboxW, height: g.hitboxH },
              ]}
            />
          </GestureDetector>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  hitbox: { position: 'absolute' },
});
