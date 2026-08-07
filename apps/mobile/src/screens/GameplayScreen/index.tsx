import type { GameState } from '@blockmanor/engine';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
// Major 7 (qa-prd-auditor): plain `react-native` SafeAreaView only applies
// insets on iOS. Expo's Android edge-to-edge needs the real inset-aware one —
// this screen is pinned top (HUD) and bottom (tray), so it bites otherwise.
import { SafeAreaView } from 'react-native-safe-area-context';
import { BoardCanvas } from '../../game/BoardCanvas';
import { computeBoardLayout } from '../../game/boardLayout';
import {
  BOOSTER_ROW_RESERVED_HEIGHT,
  GOAL_BAR_ICON_SIZE,
  GOAL_PROGRESS_BAR_HEIGHT,
  GOAL_PROGRESS_BAR_RADIUS,
  HUD_ICON_SIZE,
  HUD_ROW_GAP,
} from '../../game/boardTokens';
import { DevRenderTimeStats } from '../../game/DevRenderTimeStats';
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
  state: GameState;
}

/**
 * `GameplayScreen` — PRD §7.2 / §16.1. Renders any `GameState` statically:
 * top HUD (pause · goal bar · score), the board (ONE Skia canvas, §4.5), the
 * Stage-2 booster row reservation (renders nothing, reads no Stage-2 state —
 * CLAUDE.md rule 1), and the 3-piece tray at 50% board-cell scale (§7.2 v1.8).
 *
 * Deliberately NOT here: drag input, ghost preview, snap (§7.3); clear/combo
 * juice, haptics, audio (§7.4). Those are later sessions wiring into this
 * same static renderer.
 */
export function GameplayScreen({ state }: GameplayScreenProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const containerWidth = width - spacing.md * 2;
  const boardLayout = useMemo(() => computeBoardLayout(containerWidth), [containerWidth]);
  const goals = useMemo(() => deriveGoalBar(state), [state]);
  const levelId = state.config.level?.id;

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

      <View style={styles.boardWrap}>
        <BoardCanvas board={state.board} containerWidth={containerWidth} />
      </View>

      {/* Stage-2 booster row reservation (PRD §7.2 / CLAUDE.md rule 1): renders
          nothing, reads no Stage-2 state. §9.3 fills this slot in place. */}
      <View style={{ height: BOOSTER_ROW_RESERVED_HEIGHT }} />

      <TrayCanvas
        tray={state.tray}
        boardCellSize={boardLayout.cellSize}
        containerWidth={containerWidth}
      />

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
  boardWrap: { alignItems: 'center', marginTop: spacing.sm },
});
