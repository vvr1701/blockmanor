/**
 * In-run Daily Board header — PRD §8.3 "gameplay with gold DAILY frame,
 * attempt badge 1/1", mockup panel "4.2 Daily gameplay" (DAILY chip,
 * "Attempt 1/1", score). Passed to `GameplayScreen`'s `header` slot, so the
 * live score costs no extra render (§4.5), same as `EndlessHud`.
 *
 * NOT built here: the gold inner board frame + ribbon. Board chrome belongs to
 * the board renderer, and its frame is already a tracked follow-up that needs
 * a device screenshot (BUILD_STATE "board/tray frame").
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing, withAlpha } from '../components/tokens';
import { t } from '../i18n';
import { formatScore } from '../i18n/format';

/** §15 a11y: every interactive element ≥44dp regardless of visual size. */
const MIN_TOUCH = 44;

export interface DailyHudProps {
  score: number;
  /** `GameplayScreen`'s own `openPause`; this header replaces the default row. */
  onOpenPause: () => void;
}

export function DailyHud({ score, onOpenPause }: DailyHudProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <Pressable
          style={styles.exit}
          onPress={onOpenPause}
          accessibilityRole="button"
          accessibilityLabel={t('pause.openLabel')}
        >
          <Text style={styles.exitGlyph}>{'×'}</Text>
        </Pressable>
        <View style={styles.modeChip}>
          <Text style={styles.modeChipText}>{t('daily.hud.mode')}</Text>
        </View>
        <View style={styles.attempt}>
          <Text style={styles.attemptText}>{t('daily.hud.attempt')}</Text>
        </View>
      </View>
      <Text style={styles.score} accessibilityLabel={t('daily.hud.scoreA11y', { score })}>
        {formatScore(score)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingTop: spacing.sm, paddingHorizontal: spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exit: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitGlyph: { color: colors.cream, fontSize: fontSize.xl, fontWeight: '700', lineHeight: 28 },
  modeChip: {
    backgroundColor: colors.gold,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  modeChipText: { color: colors.night, fontSize: fontSize.xs, fontWeight: '900', letterSpacing: 3 },
  attempt: {
    minWidth: MIN_TOUCH,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.45),
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  attemptText: { color: colors.gold, fontSize: fontSize.xs, fontWeight: '900' },
  score: {
    marginTop: spacing.sm,
    textAlign: 'center',
    color: colors.cream,
    fontSize: fontSize.xxl,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
});
