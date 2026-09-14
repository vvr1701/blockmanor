/**
 * `DailyGateScreen` — PRD §8.3 "Gate screen (countdown to next board, 'one
 * attempt', yesterday's percentile; the board is refused until its
 * `activatesAt`)", mockup panel "4.1 Daily gate" (Today's Board · date ·
 * one-attempt line · Yesterday Top X% · Streak N days · PLAY TODAY'S BOARD).
 *
 * Presentational: the flow that decides `status` (play-start outcomes, the
 * "submitted on next open" pending run) lives in `DailySession`.
 *
 * NOT built: the mockup's key art (no art pipeline output yet, same note as
 * Home's manor) and "Friends already played" (friends are a later stage).
 */

import { dailyActivatesAt } from '@blockmanor/shared';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing, withAlpha } from '../../components/tokens';
import { t } from '../../i18n';

const DAY_MS = 86_400_000;
const MIN_TOUCH = 44;

export type DailyGateStatus =
  | { kind: 'ready' }
  | { kind: 'busy'; message: 'submittingPending' | null }
  | { kind: 'played' }
  | { kind: 'unavailable'; reason: 'not-yet-live' | 'closed' | 'not-published' };

export interface DailyGateScreenProps {
  /** Today's UTC date, YYYY-MM-DD (§8.1: boards are per UTC day). */
  date: string;
  now: number;
  streak: number;
  /** Yesterday's §8.4 result, or null when there is none to show. */
  yesterdayPercentile: number | null;
  status: DailyGateStatus;
  onPlay: () => void;
  onBack: () => void;
}

/** "5h 07m" until the next UTC day's board activates (§8.2 `activatesAt`). */
export function resetsIn(date: string, now: number): string {
  const ms = Math.max(0, dailyActivatesAt(date) + DAY_MS - now);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

const UNAVAILABLE_KEY = {
  'not-yet-live': 'daily.gate.notYetLive',
  closed: 'daily.gate.closed',
  'not-published': 'daily.gate.notPublished',
} as const;

export function DailyGateScreen({
  date,
  now,
  streak,
  yesterdayPercentile,
  status,
  onPlay,
  onBack,
}: DailyGateScreenProps): React.JSX.Element {
  const dateLabel = new Date(dailyActivatesAt(date)).toLocaleDateString('en', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Pressable
          style={styles.back}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('daily.gate.back')}
        >
          <Text style={styles.backGlyph}>{'‹'}</Text>
        </Pressable>

        <Text style={styles.title}>{t('daily.gate.title')}</Text>
        <Text style={styles.date}>{dateLabel}</Text>
        <Text style={styles.resets}>{t('daily.gate.resetsIn', { time: resetsIn(date, now) })}</Text>
        <Text style={styles.oneAttempt}>{t('daily.gate.oneAttempt')}</Text>

        <View style={styles.stats}>
          {yesterdayPercentile !== null ? (
            <View style={styles.stat}>
              <Text style={styles.statLabel}>{t('daily.gate.yesterday')}</Text>
              <Text style={styles.statValue}>
                {t('daily.result.topPercent', { percent: yesterdayPercentile })}
              </Text>
            </View>
          ) : null}
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t('daily.gate.streak')}</Text>
            <Text style={styles.statValue}>{t('daily.gate.streakDays', { n: streak })}</Text>
          </View>
        </View>

        <View style={styles.spacer} />

        {status.kind === 'ready' ? (
          <GoldButton label={t('daily.gate.play')} onPress={onPlay} size="lg" />
        ) : (
          <Text style={styles.message} accessibilityRole="text">
            {status.kind === 'played'
              ? t('daily.gate.playedToday')
              : status.kind === 'unavailable'
                ? t(UNAVAILABLE_KEY[status.reason])
                : status.message
                  ? t('daily.gate.submittingPending')
                  : ''}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  container: { flex: 1, padding: spacing.lg },
  back: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: 'center' },
  backGlyph: { color: colors.cream, fontSize: fontSize.xxl, fontWeight: '700' },
  title: {
    textAlign: 'center',
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    color: colors.cream,
  },
  date: { marginTop: spacing.xs, textAlign: 'center', color: colors.muted, fontSize: fontSize.sm },
  resets: {
    marginTop: spacing.xs,
    textAlign: 'center',
    color: colors.gold,
    fontSize: fontSize.sm,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  oneAttempt: {
    marginTop: spacing.lg,
    textAlign: 'center',
    color: colors.cream,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  stats: { marginTop: spacing.lg, flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
  stat: {
    minWidth: 120,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.3),
    padding: spacing.sm,
    alignItems: 'center',
  },
  statLabel: { color: colors.muted, fontSize: fontSize.xs, fontWeight: '800' },
  statValue: { marginTop: 2, color: colors.cream, fontSize: fontSize.md, fontWeight: '900' },
  spacer: { flex: 1 },
  message: { textAlign: 'center', color: colors.cream, fontSize: fontSize.md, fontWeight: '700' },
});
