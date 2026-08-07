import { PIECE_BY_ID, applyPlacement, type GameState, type Placement } from '@blockmanor/engine';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
// Major 7 (qa-prd-auditor): plain `react-native` SafeAreaView only applies
// insets on iOS. Expo's Android edge-to-edge needs the real inset-aware one —
// this screen is pinned top (HUD) and bottom (tray), so it bites otherwise.
import { SafeAreaView } from 'react-native-safe-area-context';
import { BoardCanvas } from '../../game/BoardCanvas';
import {
  computeBoardLayout,
  computeTrayLayout,
  computeTrayRowLayout,
} from '../../game/boardLayout';
import {
  BOOSTER_ROW_RESERVED_HEIGHT,
  GOAL_BAR_ICON_SIZE,
  GOAL_PROGRESS_BAR_HEIGHT,
  GOAL_PROGRESS_BAR_RADIUS,
  HUD_ICON_SIZE,
  HUD_ROW_GAP,
} from '../../game/boardTokens';
import { DevRenderTimeStats } from '../../game/DevRenderTimeStats';
import { DragLayer } from '../../game/DragLayer';
import { deriveGoalBar, type GoalBarEntry } from '../../game/goalBar';
import { spriteForObstacle } from '../../game/obstacleSprites';
import { TrayCanvas } from '../../game/TrayCanvas';
import { colors, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';

const GOAL_LABEL_KEY = {
  crate: 'gameplay.goal.crate',
  chain: 'gameplay.goal.chain',
  ivy: 'gameplay.goal.ivy',
  heirloom: 'gameplay.goal.heirloom',
} as const;

/**
 * Tiny non-Skia color swatch for the HUD goal bar — the board itself is where
 * the §15 "differ by SHAPE" rule is load-bearing (full sprite motifs, §7.8).
 * Matching this tiny icon's shape to each motif is a queued follow-up (#12),
 * not this pass — a plain rounded swatch is the honest placeholder.
 */
function GoalIcon({ type }: { type: GoalBarEntry['type'] }): React.JSX.Element {
  const sprite = spriteForObstacle(type);
  return (
    <View
      style={[
        styles.goalIcon,
        { backgroundColor: sprite.gradient[1], borderColor: sprite.gradient[2] },
      ]}
    />
  );
}

function GoalRow({ goal }: { goal: GoalBarEntry }): React.JSX.Element {
  const pct =
    goal.total > 0 ? Math.max(0, Math.min(1, (goal.total - goal.remaining) / goal.total)) : 0;
  return (
    <View style={styles.goalRow}>
      <GoalIcon type={goal.type} />
      <View style={styles.goalTextCol}>
        <Text style={styles.goalLabel}>{t(GOAL_LABEL_KEY[goal.type])}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
        </View>
      </View>
      <Text style={styles.goalRemaining}>{goal.remaining}</Text>
    </View>
  );
}

export interface GameplayScreenProps {
  /** Seeds this screen's own session state (§7.3: placements now mutate the
   * board, so this is no longer a purely display-driven prop — see the "own
   * state locally" note below). */
  initialState: GameState;
}

/**
 * `GameplayScreen` — PRD §7.2 / §7.3 / §16.1. Top HUD (pause · goal bar ·
 * score), the board + tray + drag overlay (ONE static board canvas + ONE
 * static tray canvas + ONE Reanimated/Skia drag overlay canvas, §4.5 v1.8),
 * and the Stage-2 booster row reservation (renders nothing, reads no Stage-2
 * state — CLAUDE.md rule 1).
 *
 * State ownership: this screen owns its own `GameState` via `useState`,
 * seeded from `initialState`, and commits placements straight through the
 * engine's public `applyPlacement` (§4.3) — it never recomputes clears or
 * legality itself. Wiring this to `useGameStore`/real level selection is a
 * later session's concern (same boundary the §7.2 `demoGameState` note
 * already draws); this screen just needs SOME state to mutate so dragging is
 * actually demonstrable.
 *
 * Deliberately NOT here: §7.4 clear/combo juice, haptics beyond the §7.3
 * illegal-drop one, audio. Those are next session, wiring into this same
 * renderer + `DragLayer`.
 */
export function GameplayScreen({ initialState }: GameplayScreenProps): React.JSX.Element {
  const [state, setState] = useState(initialState);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const { width } = useWindowDimensions();
  const containerWidth = width - spacing.md * 2;
  const reducedMotion = useReducedMotion();
  const boardShakeX = useSharedValue(0);

  // §4.5 v1.8 prereq: size the board from available HEIGHT too, not just
  // width — a 360×640-class device clips the width-only stack. `flexHeight`
  // is the real measured height of the flex-shrunk board/tray slot below the
  // HUD/goal bar; `Infinity` (unconstrained, old width-only behavior) until
  // the first layout pass reports it, so there's no zero-height flash.
  const [flexHeight, setFlexHeight] = useState(Infinity);
  const onFlexLayout = useCallback((e: LayoutChangeEvent) => {
    setFlexHeight(e.nativeEvent.layout.height);
  }, []);

  const traySlotShapes = useMemo(
    () => state.tray.map((s) => ({ used: s.used, cells: PIECE_BY_ID[s.pieceId].cells })),
    [state.tray],
  );

  // Tray piece scale is derived from the board's cell size (§7.2 v1.8 50%),
  // which the board's own height-fit derives from the space LEFT AFTER the
  // tray — a genuine circular dependency. Broken with one width-only
  // provisional pass to estimate the tray's height, then the real
  // height-constrained board layout. A few px of slack from this estimate
  // (if the true cell size ends up slightly smaller) is a non-issue: the
  // tray just centers with a hair more headroom, never overflows.
  const provisionalBoardLayout = useMemo(
    () => computeBoardLayout(containerWidth),
    [containerWidth],
  );
  const provisionalTrayLayout = useMemo(
    () => computeTrayLayout(provisionalBoardLayout.cellSize),
    [provisionalBoardLayout.cellSize],
  );
  const provisionalTrayRow = useMemo(
    () => computeTrayRowLayout(traySlotShapes, provisionalTrayLayout, containerWidth),
    [traySlotShapes, provisionalTrayLayout, containerWidth],
  );

  const boardMaxHeight =
    flexHeight === Infinity
      ? Infinity
      : Math.max(0, flexHeight - BOOSTER_ROW_RESERVED_HEIGHT - provisionalTrayRow.canvasHeight);
  const boardLayout = useMemo(
    () => computeBoardLayout(containerWidth, boardMaxHeight),
    [containerWidth, boardMaxHeight],
  );
  const trayLayout = useMemo(() => computeTrayLayout(boardLayout.cellSize), [boardLayout.cellSize]);
  const trayRow = useMemo(
    () => computeTrayRowLayout(traySlotShapes, trayLayout, containerWidth),
    [traySlotShapes, trayLayout, containerWidth],
  );

  const boardOffsetX = (containerWidth - boardLayout.canvasSize) / 2;
  const trayOffsetY = boardLayout.canvasSize + BOOSTER_ROW_RESERVED_HEIGHT;
  const playAreaHeight = trayOffsetY + trayRow.canvasHeight;

  const goals = useMemo(() => deriveGoalBar(state), [state]);
  const levelId = state.config.level?.id;

  const handlePlace = useCallback((pieceIndex: number, r: number, c: number) => {
    const placement: Placement = { pieceIndex, r, c };
    setState((prev) => {
      try {
        return applyPlacement(prev, placement).state;
      } catch (err) {
        // The DragLayer only commits a placement it already snapped to a
        // legal anchor (§7.3); this should be unreachable. Fail soft rather
        // than crash the screen — but this app's anti-cheat (§8.5) rests on
        // the engine and the renderer agreeing on legality, so silently
        // eating that disagreement is exactly the wrong instinct. Surface it
        // loudly in dev; still fail soft in production rather than crash.
        if (__DEV__) console.warn('[GameplayScreen] DragLayer committed an illegal placement', err);
        return prev;
      }
    });
  }, []);

  const boardShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: boardShakeX.value }],
  }));

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.hudRow}>
        <View style={styles.pauseButton}>
          <View style={styles.pauseBar} />
          <View style={styles.pauseBar} />
        </View>
        <Text style={styles.levelTitle}>
          {levelId !== undefined ? t('gameplay.level', { id: levelId }) : ''}
        </Text>
        <View style={styles.scoreChip}>
          <Text style={styles.scoreText}>{state.score}</Text>
        </View>
      </View>

      {goals.length > 0 ? (
        <View style={styles.goalBar}>
          {goals.map((goal, i) => (
            <GoalRow key={`${goal.type}-${i}`} goal={goal} />
          ))}
        </View>
      ) : null}

      <View style={styles.flexSlot} onLayout={onFlexLayout}>
        <View style={[styles.playArea, { width: containerWidth, height: playAreaHeight }]}>
          <Animated.View style={[styles.boardWrap, boardShakeStyle]}>
            <BoardCanvas
              board={state.board}
              containerWidth={containerWidth}
              maxHeight={boardMaxHeight}
            />
          </Animated.View>

          {/* Stage-2 booster row reservation (PRD §7.2 / CLAUDE.md rule 1):
              renders nothing, reads no Stage-2 state. §9.3 fills this slot
              in place. */}
          <View style={{ height: BOOSTER_ROW_RESERVED_HEIGHT }} />

          <TrayCanvas
            tray={state.tray}
            boardCellSize={boardLayout.cellSize}
            containerWidth={containerWidth}
            hiddenSlot={draggingIndex}
          />

          <DragLayer
            state={state}
            boardLayout={boardLayout}
            boardOffsetX={boardOffsetX}
            trayRow={trayRow}
            trayOffsetY={trayOffsetY}
            containerWidth={containerWidth}
            playAreaHeight={playAreaHeight}
            onPlace={handlePlace}
            onDragIndexChange={setDraggingIndex}
            boardShakeX={boardShakeX}
            reducedMotion={reducedMotion}
          />
        </View>
      </View>

      <DevRenderTimeStats dep={state} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  hudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HUD_ROW_GAP,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  pauseButton: {
    width: HUD_ICON_SIZE,
    height: HUD_ICON_SIZE,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pauseBar: { width: 4, height: 14, borderRadius: 2, backgroundColor: colors.cream },
  levelTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.cream,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  scoreChip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(233,196,106,0.3)',
    borderRadius: 13,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  scoreText: {
    color: colors.gold,
    fontSize: fontSize.md,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  goalBar: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(58,42,28,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(233,196,106,0.22)',
    borderRadius: radius.card,
    padding: spacing.sm,
  },
  goalIcon: {
    width: GOAL_BAR_ICON_SIZE,
    height: GOAL_BAR_ICON_SIZE,
    borderWidth: 2,
    borderRadius: 12,
  },
  goalTextCol: { flex: 1, gap: 6 },
  goalLabel: { color: colors.cream, fontSize: fontSize.sm, fontWeight: '700' },
  progressTrack: {
    height: GOAL_PROGRESS_BAR_HEIGHT,
    borderRadius: GOAL_PROGRESS_BAR_RADIUS,
    backgroundColor: 'rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.gold },
  goalRemaining: {
    color: colors.gold,
    fontSize: fontSize.lg,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  // flex:1 + minHeight:0: fills whatever vertical space the HUD/goal bar
  // leave, and — critically — is allowed to SHRINK on a short screen instead
  // of pushing the tray off it (§4.5 v1.8 prereq).
  flexSlot: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  playArea: { position: 'relative' },
  boardWrap: { alignItems: 'center' },
});
