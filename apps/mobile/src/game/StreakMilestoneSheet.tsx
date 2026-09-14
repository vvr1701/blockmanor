/**
 * §8.6 "Milestones 7/30/100: celebration screen + cosmetic flame upgrades",
 * mockup panel "milestone · day 7" (tier chip · "7 days." · one line · CTA).
 * Shown over `DailyResultScreen` when the server credits a milestone day.
 *
 * NOT built: the Week One chest, coins, Streak Freeze and décor rewards (Stage 2
 * economy, CLAUDE.md hard rule 1) and "Share the streak" (§8.7).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GoldButton } from '../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing } from '../components/tokens';
import { t } from '../i18n';
import { flameTier } from './streak';

export interface StreakMilestoneSheetProps {
  /** 7, 30 or 100. */
  streak: number;
  onContinue: () => void;
}

export function StreakMilestoneSheet({
  streak,
  onContinue,
}: StreakMilestoneSheetProps): React.JSX.Element {
  const tier = flameTier(streak);
  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.sheet}>
        {tier !== 'none' ? (
          <View style={styles.tierChip}>
            <Text style={styles.tierText}>{t(`streak.milestone.tier.${tier}`)}</Text>
          </View>
        ) : null}
        <Text style={styles.flame}>🔥</Text>
        <Text style={styles.title}>{t('streak.milestone.title', { n: streak })}</Text>
        <Text style={styles.line}>{t('streak.milestone.line')}</Text>
        <GoldButton
          label={t('streak.milestone.continue')}
          onPress={onContinue}
          size="lg"
          style={styles.cta}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,11,24,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius.sheet,
    padding: spacing.lg,
    backgroundColor: colors.cream,
    alignItems: 'stretch',
  },
  tierChip: {
    alignSelf: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tierText: { color: colors.night, fontSize: fontSize.xs, fontWeight: '900', letterSpacing: 2 },
  flame: { marginTop: spacing.sm, textAlign: 'center', fontSize: fontSize.xxl },
  title: {
    textAlign: 'center',
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    color: colors.night,
  },
  line: {
    marginTop: spacing.xs,
    textAlign: 'center',
    color: colors.night,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  cta: { marginTop: spacing.lg },
});
