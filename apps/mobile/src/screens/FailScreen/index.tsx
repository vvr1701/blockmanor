/**
 * `FailScreen` — PRD §7.5 / §16.1: "'Out of space!' + goal progress shown
 * ('Crates 9/12 — so close!') + Retry (free, unlimited in Stage 1) +
 * 'Level map' ghost. NO monetization yet, but layout MUST reserve the
 * continue-button slot (§9.4 drops in without redesign)."
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel "3.6
 * Fail / Continue" (cream card over the darkened dead board, title + goal
 * line + primary-CTA slot + tiny exit link). That panel's Continue/
 * second-chance/streak content is Stage-2 §9.4 — reproduced here only as an
 * EMPTY reserved slot (`CONTINUE_SLOT_RESERVED_HEIGHT`), never rendered,
 * never reading Stage-2 state (CLAUDE.md rule 1 / §0 rule 2a).
 *
 * No loading/error/offline states (CLAUDE.md screen checklist): a pure
 * synchronous function of the terminal `GameState` the caller already holds
 * — levels are fully offline-capable end to end (§12.4), nothing here calls
 * the network.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GhostButton } from '../../components/GhostButton';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontSize, radius, spacing } from '../../components/tokens';
import { GOAL_LABEL_KEY, type GoalBarEntry } from '../../game/goalBar';
import { t } from '../../i18n';
import { CONTINUE_SLOT_RESERVED_HEIGHT } from './failTokens';

export interface FailScreenProps {
  levelId: number;
  /** Goal state at the moment the board died (§7.5's "Crates 9/12"). Empty
   * for a goal-less config (endless-shaped) — the goal block simply omits. */
  goals: readonly GoalBarEntry[];
  onRetry: () => void;
  onLevelMap: () => void;
}

function GoalLine({ goal }: { goal: GoalBarEntry }): React.JSX.Element {
  const done = goal.total - goal.remaining;
  return (
    <Text style={styles.goalLine}>
      {t('fail.goalLine', { label: t(GOAL_LABEL_KEY[goal.type]), done, total: goal.total })}
    </Text>
  );
}

export function FailScreen({
  levelId,
  goals,
  onRetry,
  onLevelMap,
}: FailScreenProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('fail.title')}</Text>
        <Text style={styles.subtitle}>{t('fail.subtitle', { id: levelId })}</Text>

        {goals.length > 0 ? (
          <View style={styles.goalBlock}>
            {goals.map((goal, i) => (
              <GoalLine key={`${goal.type}-${i}`} goal={goal} />
            ))}
            <Text style={styles.soClose}>{t('fail.soClose')}</Text>
          </View>
        ) : null}

        {/* §9.4 continue-button slot reservation — renders nothing, reads no
            Stage-2 state. See `failTokens.ts`. */}
        <View style={{ height: CONTINUE_SLOT_RESERVED_HEIGHT }} />

        <GoldButton label={t('fail.retry')} onPress={onRetry} size="lg" style={styles.retry} />
        <GhostButton label={t('fail.levelMap')} onPress={onLevelMap} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    backgroundColor: colors.cream,
    borderRadius: radius.sheet,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: { color: colors.night, fontSize: fontSize.xl, fontWeight: '800' },
  subtitle: { color: colors.night, opacity: 0.6, fontSize: fontSize.sm, fontWeight: '700' },
  goalBlock: { alignItems: 'center', marginTop: spacing.sm, gap: 2 },
  goalLine: {
    color: colors.night,
    opacity: 0.75,
    fontSize: fontSize.md,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  soClose: {
    color: colors.night,
    opacity: 0.55,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  retry: { width: '100%', marginTop: spacing.sm },
});
