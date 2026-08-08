/**
 * The §7.4 juice table, minus lift/legal-snap (owned by `DragLayer.tsx` —
 * see its §7.4 additions) and minus audio (blocked on assets, `sfx.ts`).
 *
 * Purely event-driven: everything here reads `GameEvent[]` from the most
 * recent `applyPlacement` call (§4.3) — never re-derives a clear, a combo,
 * or a win/loss itself. `placementSeq` (the engine's own `state.placements`
 * counter) is the remount key for every event-triggered sub-tree below: a
 * fresh key each placement restarts that placement's animations even if, by
 * coincidence, the same cells clear twice in a row.
 *
 * §4.5 v1.8 architecture: this component's own re-render happens at most
 * once per placement — the SAME re-render `GameplayScreen`'s board-state
 * `setState` already causes, not an extra one (`events`/`placementSeq` are
 * plain props, not polled). Every child below mounts once per placement and
 * then animates purely via its own Reanimated shared values on the UI
 * thread; nothing here re-renders on an animation frame. Per-cell pop and
 * particles are Skia scene-graph nodes (one small `<Canvas>` positioned over
 * the board only); text/flash/shimmer/stars/confetti/vignette-lite are
 * single-instance `Animated.View`/`Animated.Text` nodes — never a per-cell
 * RN view (§4.5's actual ban), since none of these is instantiated per
 * board cell.
 */

import { type GameEvent } from '@blockmanor/engine';
import { Canvas, Circle, RoundedRect, vec } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { blockColors, colors, fontSize } from '../components/tokens';
import { CELL_RADIUS_MIN, CELL_RADIUS_RATIO } from './boardTokens';
import { cellRect, type BoardLayout, type CellRect } from './boardLayout';
import {
  CLEAR_HAPTIC_STYLE,
  CLEAR_PARTICLE_COUNT,
  CLEAR_PARTICLE_MS,
  CLEAR_PARTICLE_TRAVEL_CELLS,
  CLEAR_POP_MS,
  CLEAR_POP_PEAK_SCALE,
  CLEAR_POP_STAGGER_MS_PER_CELL,
  COMBO_TEXT_HOLD_MS,
  COMBO_TEXT_SLAM_MS,
  FAIL_DESATURATE_MS,
  FLOATING_SCORE_MS,
  FLOATING_SCORE_RISE_PX,
  MULTI_LINE_COMBO_MIN,
  MULTI_LINE_FLASH_MS,
  MULTI_LINE_FLASH_OPACITY,
  MULTI_LINE_HAPTIC_STYLE,
  NEAR_DEATH_FILL_THRESHOLD,
  NEAR_DEATH_PEAK_OPACITY,
  NEAR_DEATH_PULSE_MS,
  NEAR_DEATH_STATIC_OPACITY,
  PERFECT_CLEAR_SHIMMER_MS,
  WIN_CONFETTI_COUNT,
  WIN_CONFETTI_MS,
  WIN_STAR_COUNT,
  WIN_STAR_SLAM_MS,
  WIN_STAR_STAGGER_MS,
} from './juice';
import { playCue } from './sfx';

const CONFETTI_COLORS: readonly string[] = Object.values(blockColors);

// --- per-cell pop (§7.4 "Line clear") ---------------------------------------

function PopCell({ rect, delayMs }: { rect: CellRect; delayMs: number }): React.JSX.Element {
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  useEffect(() => {
    opacity.value = withDelay(delayMs, withTiming(0, { duration: CLEAR_POP_MS }));
    scale.value = withDelay(delayMs, withTiming(CLEAR_POP_PEAK_SCALE, { duration: CLEAR_POP_MS }));
    // Mount-once: a fresh `PopCell` instance (new `key` from the caller) is
    // exactly what "restart this animation" means here — no re-trigger dep.
  }, []);
  const transform = useDerivedValue(() => [{ scale: scale.value }]);
  const radius = Math.max(CELL_RADIUS_MIN, Math.round(rect.size * CELL_RADIUS_RATIO));
  return (
    <RoundedRect
      x={rect.x}
      y={rect.y}
      width={rect.size}
      height={rect.size}
      r={radius}
      color={colors.gold}
      opacity={opacity}
      transform={transform}
      origin={vec(rect.x + rect.size / 2, rect.y + rect.size / 2)}
    />
  );
}

// --- star particles (§7.4 "star particles") ---------------------------------

function Particle({
  originX,
  originY,
  angle,
  delayMs,
  travelPx,
}: {
  originX: number;
  originY: number;
  angle: number;
  delayMs: number;
  travelPx: number;
}): React.JSX.Element {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delayMs, withTiming(1, { duration: CLEAR_PARTICLE_MS }));
  }, []);
  const cx = useDerivedValue(() => originX + Math.cos(angle) * travelPx * progress.value);
  const cy = useDerivedValue(() => originY + Math.sin(angle) * travelPx * progress.value);
  const opacity = useDerivedValue(() => 1 - progress.value);
  const r = useDerivedValue(() => 3.5 * (1 - progress.value * 0.5));
  return <Circle cx={cx} cy={cy} r={r} color={colors.gold} opacity={opacity} />;
}

// --- near-death vignette (§7.4 "red edge vignette pulse 1.2s loop") ---------

function NearDeathVignette({
  active,
  reducedMotion,
  size,
}: {
  active: boolean;
  reducedMotion: boolean;
  size: number;
}): React.JSX.Element | null {
  const opacity = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(opacity);
    if (!active) {
      opacity.value = withTiming(0, { duration: 150 });
    } else if (reducedMotion) {
      // §7.4 rule: reduced-motion kills the LOOP (a continuous pulse is a
      // motion effect, same category as the shakes the rule names), but the
      // warning itself is informational, not decorative — a static tint
      // keeps that signal instead of just disappearing.
      opacity.value = withTiming(NEAR_DEATH_STATIC_OPACITY, { duration: 150 });
    } else {
      opacity.value = withRepeat(
        withSequence(
          withTiming(NEAR_DEATH_PEAK_OPACITY, { duration: NEAR_DEATH_PULSE_MS / 2 }),
          withTiming(0, { duration: NEAR_DEATH_PULSE_MS / 2 }),
        ),
        -1,
        true,
      );
    }
  }, [active, reducedMotion, opacity]);
  if (size <= 0) return null;
  const strokeWidth = Math.max(6, size * 0.06);
  return (
    <RoundedRect
      x={strokeWidth / 2}
      y={strokeWidth / 2}
      width={size - strokeWidth}
      height={size - strokeWidth}
      r={12}
      style="stroke"
      strokeWidth={strokeWidth}
      color={colors.bad}
      opacity={opacity}
    />
  );
}

// --- floating score (§7.4 "+N floating score") ------------------------------

function FloatingScore({
  x,
  y,
  points,
}: {
  x: number;
  y: number;
  points: number;
}): React.JSX.Element {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: FLOATING_SCORE_MS });
  }, []);
  const style = useAnimatedStyle(() => ({
    left: x - 24,
    top: y - FLOATING_SCORE_RISE_PX * progress.value - 12,
    opacity: 1 - progress.value,
  }));
  return (
    <Animated.Text style={[styles.floatingScore, style]} pointerEvents="none">
      {`+${points}`}
    </Animated.Text>
  );
}

// --- combo text slam (§7.4 "COMBO xN! text slam") ---------------------------

function ComboText({
  n,
  width,
  height,
}: {
  n: number;
  width: number;
  height: number;
}): React.JSX.Element {
  const scale = useSharedValue(0.4);
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: COMBO_TEXT_SLAM_MS });
    scale.value = withTiming(1, { duration: COMBO_TEXT_SLAM_MS }, (finished) => {
      'worklet';
      if (finished) {
        opacity.value = withDelay(
          COMBO_TEXT_HOLD_MS,
          withTiming(0, { duration: COMBO_TEXT_SLAM_MS }),
        );
      }
    });
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <View pointerEvents="none" style={[styles.centerWrap, { width, height }]}>
      <Animated.Text style={[styles.comboText, style]}>{`COMBO x${n}!`}</Animated.Text>
    </View>
  );
}

// --- multi-line screen flash (§7.4 "screen flash 8% white 80ms") -----------

function ScreenFlash({ width, height }: { width: number; height: number }): React.JSX.Element {
  const opacity = useSharedValue(MULTI_LINE_FLASH_OPACITY);
  useEffect(() => {
    opacity.value = withTiming(0, { duration: MULTI_LINE_FLASH_MS });
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View pointerEvents="none" style={[styles.flash, { width, height }, style]} />;
}

// --- perfect clear shimmer (§7.4 "gold fullscreen shimmer 600ms") ----------

function PerfectClearShimmer({
  width,
  height,
}: {
  width: number;
  height: number;
}): React.JSX.Element {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: PERFECT_CLEAR_SHIMMER_MS / 2 }),
      withTiming(0, { duration: PERFECT_CLEAR_SHIMMER_MS / 2 }),
    );
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View pointerEvents="none" style={[styles.perfectShimmer, { width, height }, style]} />
  );
}

// --- level win: stars + confetti (§7.4 "stars slam in x3, confetti") -------

function WinStar({
  index,
  reducedMotion,
}: {
  index: number;
  reducedMotion: boolean;
}): React.JSX.Element {
  const scale = useSharedValue(reducedMotion ? 1 : 0);
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) return;
    const delayMs = index * WIN_STAR_STAGGER_MS;
    opacity.value = withDelay(delayMs, withTiming(1, { duration: WIN_STAR_SLAM_MS }));
    scale.value = withDelay(delayMs, withTiming(1, { duration: WIN_STAR_SLAM_MS }));
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.Text style={[styles.winStar, style]} pointerEvents="none">
      {'★'}
    </Animated.Text>
  );
}

function ConfettiPiece({ index, width }: { index: number; width: number }): React.JSX.Element {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay((index % 6) * 40, withTiming(1, { duration: WIN_CONFETTI_MS }));
  }, []);
  const laneWidth = width / WIN_CONFETTI_COUNT;
  const left = laneWidth * index + laneWidth / 2;
  const spin = index % 2 === 0 ? 1 : -1;
  const style = useAnimatedStyle(() => ({
    left,
    top: progress.value * 240 - 16,
    opacity: 1 - progress.value,
    transform: [{ rotate: `${progress.value * 360 * spin}deg` }],
  }));
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length] as string;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.confettiPiece, { backgroundColor: color }, style]}
    />
  );
}

function WinCelebration({
  width,
  height,
  reducedMotion,
}: {
  width: number;
  height: number;
  reducedMotion: boolean;
}): React.JSX.Element {
  return (
    <View pointerEvents="none" style={[styles.centerWrap, { width, height }]}>
      <View style={styles.winStarsRow}>
        {Array.from({ length: WIN_STAR_COUNT }).map((_, i) => (
          <WinStar key={i} index={i} reducedMotion={reducedMotion} />
        ))}
      </View>
      {!reducedMotion
        ? Array.from({ length: WIN_CONFETTI_COUNT }).map((_, i) => (
            <ConfettiPiece key={i} index={i} width={width} />
          ))
        : null}
    </View>
  );
}

// --- orchestrator ------------------------------------------------------------

/** Placement centroid fallback when (defensively) no `PIECE_PLACED` event is
 * present — never happens per §4.3 event ordering, but keeps the distance
 * math finite rather than `NaN`-poisoning every pop delay. */
const BOARD_ANCHOR_FALLBACK = 3.5;

export interface JuiceLayerProps {
  /** The just-applied placement's events (§4.3), or `[]` before any placement. */
  events: readonly GameEvent[];
  /** `state.placements` — the engine's own monotonic counter; the remount
   * key for every event-triggered sub-tree above. */
  placementSeq: number;
  boardLayout: BoardLayout;
  boardOffsetX: number;
  containerWidth: number;
  playAreaHeight: number;
  /** Post-placement `fillRatio(state.board)` (§4.3 public API) — near-death
   * is continuous board STATE, not a discrete event. */
  fill: number;
  reducedMotion: boolean;
  /** §7.4 fail juice — owned by `GameplayScreen`, also handed to `BoardCanvas`. */
  desaturateSV?: SharedValue<number>;
}

export function JuiceLayer({
  events,
  placementSeq,
  boardLayout,
  boardOffsetX,
  containerWidth,
  playAreaHeight,
  fill,
  reducedMotion,
  desaturateSV,
}: JuiceLayerProps): React.JSX.Element {
  const placed = events.find(
    (e): e is Extract<GameEvent, { type: 'PIECE_PLACED' }> => e.type === 'PIECE_PLACED',
  );
  const cleared = events.find(
    (e): e is Extract<GameEvent, { type: 'LINES_CLEARED' }> => e.type === 'LINES_CLEARED',
  );
  const perfect = events.some((e) => e.type === 'PERFECT_CLEAR');
  const won = events.find(
    (e): e is Extract<GameEvent, { type: 'LEVEL_WON' }> => e.type === 'LEVEL_WON',
  );
  const over = events.some((e) => e.type === 'GAME_OVER');
  const isMultiLine = !!cleared && cleared.comboDisplay >= MULTI_LINE_COMBO_MIN;

  // Imperative side effects (haptics, the no-op sfx seam, the board-desaturate
  // shared value) — once per placement, keyed on the `events` array's own
  // identity (a fresh array every `applyPlacement` call, §4.3).
  useEffect(() => {
    if (events.length === 0) return;
    if (cleared) {
      void Haptics.impactAsync(isMultiLine ? MULTI_LINE_HAPTIC_STYLE : CLEAR_HAPTIC_STYLE);
      // §6.6/§7.4: chime pitch is `+1 semitone x (comboDisplay - 1)`, capped
      // at +7 — the no-op seam already accepts this so wiring real audio
      // later needs no call-site change.
      playCue('clear_chime', Math.min(7, cleared.comboDisplay - 1));
      if (isMultiLine) playCue('combo_layer');
    }
    if (perfect) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      playCue('perfect_gliss');
    }
    if (won) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      playCue('win_fanfare');
    }
    if (over) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      playCue('fail_thud');
      if (desaturateSV) {
        desaturateSV.value = withTiming(1, { duration: FAIL_DESATURATE_MS });
      }
    }
  }, [events]);

  const step = boardLayout.cellSize + boardLayout.gap;
  let anchorX = boardLayout.canvasSize / 2;
  let anchorY = boardLayout.canvasSize / 2;
  let anchorCellR = BOARD_ANCHOR_FALLBACK;
  let anchorCellC = BOARD_ANCHOR_FALLBACK;
  if (placed && placed.cells.length > 0) {
    anchorCellR = placed.cells.reduce((s, cell) => s + cell.r, 0) / placed.cells.length;
    anchorCellC = placed.cells.reduce((s, cell) => s + cell.c, 0) / placed.cells.length;
    anchorX = boardLayout.padding + (anchorCellC + 0.5) * step;
    anchorY = boardLayout.padding + (anchorCellR + 0.5) * step;
  }

  const isNearDeath = fill > NEAR_DEATH_FILL_THRESHOLD;

  return (
    <View
      pointerEvents="none"
      style={[styles.overlay, { width: containerWidth, height: playAreaHeight }]}
    >
      <Canvas
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: boardOffsetX,
          top: 0,
          width: boardLayout.canvasSize,
          height: boardLayout.canvasSize,
        }}
      >
        {cleared
          ? cleared.cells.map((cell, i) => {
              const distCells = Math.hypot(cell.c - anchorCellC, cell.r - anchorCellR);
              return (
                <PopCell
                  key={`pop-${placementSeq}-${i}`}
                  rect={cellRect(cell.r, cell.c, boardLayout)}
                  delayMs={distCells * CLEAR_POP_STAGGER_MS_PER_CELL}
                />
              );
            })
          : null}
        {cleared && !reducedMotion
          ? Array.from({ length: CLEAR_PARTICLE_COUNT }).map((_, i) => (
              <Particle
                key={`particle-${placementSeq}-${i}`}
                originX={anchorX}
                originY={anchorY}
                angle={(i / CLEAR_PARTICLE_COUNT) * Math.PI * 2}
                delayMs={i * 6}
                travelPx={CLEAR_PARTICLE_TRAVEL_CELLS * boardLayout.cellSize}
              />
            ))
          : null}
        <NearDeathVignette
          active={isNearDeath}
          reducedMotion={reducedMotion}
          size={boardLayout.canvasSize}
        />
      </Canvas>

      {cleared ? (
        <FloatingScore
          key={`score-${placementSeq}`}
          x={boardOffsetX + anchorX}
          y={anchorY}
          points={cleared.points}
        />
      ) : null}
      {isMultiLine && !reducedMotion ? (
        <ScreenFlash key={`flash-${placementSeq}`} width={containerWidth} height={playAreaHeight} />
      ) : null}
      {isMultiLine ? (
        <ComboText
          key={`combo-${placementSeq}`}
          n={(cleared as Extract<GameEvent, { type: 'LINES_CLEARED' }>).comboDisplay}
          width={containerWidth}
          height={playAreaHeight}
        />
      ) : null}
      {perfect ? (
        <PerfectClearShimmer
          key={`perfect-${placementSeq}`}
          width={containerWidth}
          height={playAreaHeight}
        />
      ) : null}
      {won ? (
        <WinCelebration
          key={`win-${placementSeq}`}
          width={containerWidth}
          height={playAreaHeight}
          reducedMotion={reducedMotion}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, top: 0 },
  centerWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingScore: {
    position: 'absolute',
    color: colors.gold,
    fontSize: fontSize.lg,
    fontWeight: '900',
  },
  comboText: {
    color: colors.gold,
    fontSize: fontSize.xxl,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 6,
  },
  flash: { position: 'absolute', left: 0, top: 0, backgroundColor: '#FFFFFF' },
  perfectShimmer: { position: 'absolute', left: 0, top: 0, backgroundColor: colors.gold },
  winStarsRow: { flexDirection: 'row', gap: 12 },
  winStar: { fontSize: fontSize.xxl, color: colors.gold },
  confettiPiece: { position: 'absolute', width: 8, height: 12, borderRadius: 2 },
});
