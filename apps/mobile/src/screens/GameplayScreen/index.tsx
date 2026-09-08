import {
  PIECE_BY_ID,
  applyPlacement,
  fillRatio,
  type GameEvent,
  type GameState,
  type Placement,
} from '@blockmanor/engine';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
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
import { GOAL_LABEL_KEY, deriveGoalBar, type GoalBarEntry } from '../../game/goalBar';
import { HUD_FADE_IN_MS } from '../../game/juice';
import { JuiceLayer } from '../../game/JuiceLayer';
import { spriteForObstacle } from '../../game/obstacleSprites';
import { TrayCanvas } from '../../game/TrayCanvas';
import { playCue } from '../../game/sfx';
import { colors, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { formatScore } from '../../i18n/format';
import { PauseSheet } from '../PauseSheet';

/** CLAUDE.md a11y rule — every interactive element ≥44dp. */
const MIN_TOUCH_TARGET = 44;

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

/**
 * §12.2's two destructive pause actions, owned by whoever owns the RUN — this
 * screen owns a `GameState`, not a level session, so it can neither re-seed
 * an attempt nor navigate. Absent (`FtueScreen`, the dev board) means this
 * screen has no pause affordance at all and no `BackHandler` subscription:
 * FTUE has no destination behind it, so Android's default "back exits the
 * app" is correct there (the same scope call §7.6's fix pass made).
 */
export interface PauseControls {
  /** §12.2 restart. FREE in Stage 1 — §9.2's life cost is Stage 2 and is
   * neither modelled nor reserved here. */
  onRestart: () => void;
  /** §12.2 quit-to-map. `moves` is `GameState.placements` at the moment of
   * the quit, for §14's `level_quit{id,moves}`; this screen is the only
   * holder of that number, so it hands it up rather than making the caller
   * mirror the state. */
  onQuit: (moves: number) => void;
  /** §12.2's "settings shortcut" -> §12.1's `SettingsScreen`. This screen
   * has no navigation of its own (same reason it can't restart/quit itself)
   * so it hands the press straight up, unchanged. */
  onOpenSettings: () => void;
}

export interface GameplayScreenProps {
  /** Seeds this screen's own session state (§7.3: placements now mutate the
   * board, so this is no longer a purely display-driven prop — see the "own
   * state locally" note below). */
  initialState: GameState;
  /** §7.1 FTUE: hide the top HUD row + goal bar for the minimal-affordance
   * early FTUE levels ("no HUD, no menus, no timers" — L1's mockup). Defaults
   * `true` (every non-FTUE caller keeps today's always-visible HUD). */
  hudVisible?: boolean;
  /** §7.1 L5: the HUD fades in rather than snapping visible on mount. Only
   * meaningful when `hudVisible` is true; ignored otherwise. */
  hudFadeIn?: boolean;
  /**
   * §7.6 (mockup panel 10.2): replaces the standard HUD row with the caller's
   * own header — Endless has no level title and no pause chip, it has a mode
   * chip, a centred hero score and a personal-best marker.
   *
   * A RENDER PROP, not a node, on purpose: the header needs the live
   * `state.score`, which lives in THIS screen's state. Taking a node would
   * force the caller to mirror the score into its own state off `onEvent`,
   * which adds a second render pass per placement (§4.5 budgets one). Called
   * inside this screen's existing render, it costs nothing extra.
   * `hudVisible`/`hudFadeIn` do not apply to it — a caller that supplies a
   * header owns its own visibility.
   */
  header?: (state: GameState) => React.ReactNode;
  /** §7.1: lets a caller (the FTUE step machine) observe every placement's
   * events/resulting state without this screen knowing anything about FTUE —
   * same `applyPlacement` return value `JuiceLayer` already consumes, just
   * also handed upward. Never used to re-derive rules, only to react to them. */
  onEvent?: (events: readonly GameEvent[], state: GameState) => void;
  /** §12.2: hands this screen the two actions its `PauseSheet` cannot
   * perform itself. Omit to leave the HUD's pause glyph inert (see
   * `PauseControls`). */
  pause?: PauseControls;
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
 * §7.4 clear/combo/perfect/near-death/win/fail juice is wired in here too,
 * via `JuiceLayer` — purely `GameEvent[]`-driven off `applyPlacement`'s own
 * return value, never a re-derived clear/combo/win. Audio stays a no-op seam
 * (`sfx.ts`, blocked on assets); the §7.5 win/fail SCREENS themselves are a
 * later session — `JuiceLayer` only ever renders the board-side celebration/
 * fail visuals, it never navigates.
 */
export function GameplayScreen({
  initialState,
  hudVisible = true,
  hudFadeIn = false,
  header,
  onEvent,
  pause,
}: GameplayScreenProps): React.JSX.Element {
  const [state, setState] = useState(initialState);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  // The most recent `applyPlacement` call's events (§4.3) — `JuiceLayer`'s
  // only input, never re-derived. A fresh (possibly empty) array reference
  // each placement, set in the SAME handler as `setState` below so React 18
  // batches both into the one re-render §4.5 v1.8 budgets per placement.
  const [juiceEvents, setJuiceEvents] = useState<readonly GameEvent[]>([]);
  const { width } = useWindowDimensions();
  const containerWidth = width - spacing.md * 2;
  const reducedMotion = useReducedMotion();
  const boardShakeX = useSharedValue(0);
  // §7.4 "Fail | desaturate board 400ms" — owned here (like `boardShakeX`)
  // since both `BoardCanvas` (reads it to render) and `JuiceLayer` (writes it
  // on `GAME_OVER`) need the same stable shared-value ref.
  const desaturateSV = useSharedValue(0);

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

  // --- §12.2 pause -------------------------------------------------------
  const [paused, setPaused] = useState(false);
  // §12.2's quit confirm is the sheet's SECOND layer, held here (not in the
  // sheet) because the `BackHandler` below is the only one on this screen and
  // it has to know which layer is on top in order to pop just that one.
  const [confirming, setConfirming] = useState(false);
  // Pause is only offered on a LIVE board. `LevelSession` deliberately holds
  // this screen mounted for `WIN_HOLD_MS`/`FAIL_HOLD_MS` after a terminal
  // placement so the §7.4 win/fail beat can play (§7.5 audit M-2) — opening a
  // pause menu over a board that has already been won is not a state §12.2
  // describes, and the sheet would be torn down by the phase swap anyway.
  const canPause = pause !== undefined && state.status === 'playing';
  // §15.1: `modal_open`/`modal_close` are the named cues for exactly this.
  const openPause = useCallback(() => {
    playCue('modal_open');
    setPaused(true);
  }, []);
  const closePause = useCallback(() => {
    playCue('modal_close');
    setPaused(false);
    // The sheet unmounts on close, so the confirm layer must not survive to
    // greet the next open.
    setConfirming(false);
  }, []);

  // §12.9 "invitations, never dead ends": Android's hardware back opens pause
  // (or closes it when already open) and is ALWAYS consumed — the default
  // handler pops an empty navigation stack and Android kills the process
  // mid-run, which is the trap §7.6's audit filed as a BLOCKER. Consumed even
  // during the terminal hold above, where `canPause` is false: swallowing one
  // press for ~1s beats killing the app over a win animation.
  //
  // Back pops exactly ONE layer per press — confirm -> pause menu -> board —
  // which is the Android convention (§12.9 audit nit 7). Dismissing the whole
  // sheet from the confirm would also silently discard the "are you sure"
  // the player was answering.
  useEffect(() => {
    if (!pause) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (confirming) setConfirming(false);
      else if (paused) closePause();
      else if (canPause) openPause();
      return true;
    });
    return () => sub.remove();
  }, [pause, paused, confirming, canPause, openPause, closePause]);

  const handleRestart = useCallback(() => {
    // Closed first so this component is self-consistent even for a caller
    // that does NOT remount it. `LevelSession` does remount (its `key`
    // carries `attempt`, §0 v1.17), which makes this a no-op there.
    closePause();
    pause?.onRestart();
  }, [closePause, pause]);

  const handleQuit = useCallback(() => {
    closePause();
    pause?.onQuit(state.placements);
  }, [closePause, pause, state.placements]);

  const handlePlace = useCallback((pieceIndex: number, r: number, c: number) => {
    const placement: Placement = { pieceIndex, r, c };
    let events: readonly GameEvent[] = [];
    setState((prev) => {
      try {
        const result = applyPlacement(prev, placement);
        events = result.events;
        return result.state;
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
    setJuiceEvents(events);
  }, []);

  // §7.1 v1.11: notify `onEvent` off a STATE-IDENTITY change, not by reading
  // a side-channel variable synchronously right after the `setState` call
  // above. React does not guarantee that functional updater runs
  // synchronously with the call that scheduled it (it only does when its own
  // "eager bailout" heuristic applies, e.g. the very first update since the
  // last commit) — a second placement queued before the first commits would
  // otherwise silently read a stale `null` and never notify the caller. An
  // effect keyed on the committed `state` reference fires exactly once per
  // REAL placement (a rejected/illegal placement returns the same `prev`
  // reference, so `state` never changes and no notification fires) and never
  // on initial mount (both refs start equal).
  const lastNotifiedState = useRef(state);
  useEffect(() => {
    if (state !== lastNotifiedState.current) {
      lastNotifiedState.current = state;
      onEvent?.(juiceEvents, state);
    }
  }, [state, juiceEvents, onEvent]);

  const boardShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: boardShakeX.value }],
  }));

  // §7.1 v1.11: HUD row + goal bar visibility/fade for the FTUE step machine.
  // Snaps to the caller's starting visibility on mount, then (only when
  // `hudFadeIn` asks for it) tweens to fully visible — L1-L4 skip this
  // entirely by never mounting with `hudVisible` false-then-true.
  const hudOpacity = useSharedValue(hudVisible && !hudFadeIn ? 1 : 0);
  useEffect(() => {
    if (hudVisible) {
      hudOpacity.value = hudFadeIn ? withTiming(1, { duration: HUD_FADE_IN_MS }) : 1;
    } else {
      hudOpacity.value = 0;
    }
    // Only the MOUNT-time intent matters here (§7.1 L5 fades in once); a
    // GameplayScreen instance never toggles `hudVisible` mid-life in any
    // current caller (FTUE remounts a fresh instance per step via `key`).
  }, []);
  const hudAnimatedStyle = useAnimatedStyle(() => ({ opacity: hudOpacity.value }));

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {header ? (
        header(state)
      ) : (
        <Animated.View style={hudAnimatedStyle} pointerEvents={hudVisible ? 'auto' : 'none'}>
          <View style={styles.hudRow}>
            {/* The glyph is 38dp per the mockup's HUD row (`HUD_ICON_SIZE`);
                `hitSlop` carries it past the 44dp floor, the same way §7.3
                sizes tray hitboxes independently of their visual size.

                With NO `pause` prop there is no control here at all, ever — so
                it is rendered as the decorative `View` it is, hidden from the
                accessibility tree. Announcing a permanently-disabled "Pause the
                game" button would put a dead end (§12.9) on `FtueScreen`, which
                shows this row at step L5 on a screen §7.1 specs as "no HUD, no
                menus". Same 38dp box either way, so the row never reflows. */}
            {pause ? (
              <Pressable
                style={({ pressed }) => [styles.pauseButton, pressed ? styles.pausePressed : null]}
                onPress={openPause}
                disabled={!canPause}
                accessibilityRole="button"
                accessibilityLabel={t('pause.openLabel')}
                accessibilityState={{ disabled: !canPause }}
                hitSlop={(MIN_TOUCH_TARGET - HUD_ICON_SIZE) / 2}
              >
                <View style={styles.pauseBar} />
                <View style={styles.pauseBar} />
              </Pressable>
            ) : (
              <View
                style={styles.pauseButton}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View style={styles.pauseBar} />
                <View style={styles.pauseBar} />
              </View>
            )}
            <Text style={styles.levelTitle}>
              {levelId !== undefined ? t('gameplay.level', { id: levelId }) : ''}
            </Text>
            <View style={styles.scoreChip}>
              <Text style={styles.scoreText}>{formatScore(state.score)}</Text>
            </View>
          </View>
        </Animated.View>
      )}

      {/* §7.1 v1.11: the goal bar stays visible even when `hudVisible` hides
          the pause/score row above — L4 is the first FTUE level with a goal
          and needs it lit for its own goal-bar callout. */}
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
              desaturateSV={desaturateSV}
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
            paused={paused}
          />

          <JuiceLayer
            events={juiceEvents}
            placementSeq={state.placements}
            boardLayout={boardLayout}
            boardOffsetX={boardOffsetX}
            containerWidth={containerWidth}
            playAreaHeight={playAreaHeight}
            fill={fillRatio(state.board)}
            reducedMotion={reducedMotion}
            desaturateSV={desaturateSV}
            paused={paused}
          />
        </View>
      </View>

      <DevRenderTimeStats dep={state} />

      {paused && pause ? (
        <PauseSheet
          levelId={levelId}
          goals={goals}
          moves={state.placements}
          onResume={closePause}
          onRestart={handleRestart}
          onOpenSettings={pause.onOpenSettings}
          onQuit={handleQuit}
          confirming={confirming}
          onConfirmingChange={setConfirming}
        />
      ) : null}
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
  pausePressed: { opacity: 0.6 },
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
