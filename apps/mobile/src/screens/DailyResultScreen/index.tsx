/**
 * `DailyResultScreen` — PRD §8.3 "result: score count-up 900ms → percentile
 * reveal → share card → 'Continue to levels'", mockup panel "4.3 Daily
 * result" (Daily complete · score · Top X% worldwide · 🔥N · Continue).
 *
 * The percentile is the server's (§8.4, fixed at submission). `null` shows
 * §12.9's "Early bird! 🌅" — fewer than 100 counted submissions, or a log
 * excluded by §0 v1.26(b).
 *
 * NOT built here, each on its own branch: the 900ms count-up (next step on
 * this branch), the worldwide distribution chart (the histogram is
 * server-only; no callable returns it), and the share card + WhatsApp/Story
 * buttons (§8.7).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing, withAlpha } from '../../components/tokens';
import { t } from '../../i18n';
import { formatScore } from '../../i18n/format';

export interface DailyResultScreenProps {
  /** The server's re-simulated score (§8.5). */
  score: number;
  /** §8.4 "Top X%", or null for Early bird. */
  percentile: number | null;
  /** §8.6 server-authoritative streak after this submission. */
  streak: number;
  onContinue: () => void;
}

export function DailyResultScreen({
  score,
  percentile,
  streak,
  onContinue,
}: DailyResultScreenProps): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>{t('daily.result.title')}</Text>
        <Text style={styles.score} accessibilityLabel={t('daily.hud.scoreA11y', { score })}>
          {formatScore(score)}
        </Text>
        <Text style={styles.percentile}>
          {percentile === null
            ? t('daily.result.earlyBird')
            : t('daily.result.topPercent', { percent: percentile })}
        </Text>
        {streak > 0 ? (
          <View style={styles.streakChip}>
            <Text style={styles.streakText}>{t('daily.result.streak', { n: streak })}</Text>
          </View>
        ) : null}
        <View style={styles.spacer} />
        <GoldButton label={t('daily.result.continue')} onPress={onContinue} size="lg" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  container: { flex: 1, padding: spacing.lg, alignItems: 'stretch' },
  title: {
    marginTop: spacing.xl,
    textAlign: 'center',
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    color: colors.cream,
  },
  score: {
    marginTop: spacing.md,
    textAlign: 'center',
    color: colors.gold,
    fontSize: fontSize.xxl,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  percentile: {
    marginTop: spacing.sm,
    textAlign: 'center',
    color: colors.cream,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  streakChip: {
    alignSelf: 'center',
    marginTop: spacing.md,
    borderRadius: radius.card,
    backgroundColor: withAlpha(colors.gold, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.45),
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  streakText: { color: colors.gold, fontSize: fontSize.sm, fontWeight: '900' },
  spacer: { flex: 1 },
});
