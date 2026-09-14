/**
 * `StreakScreen` — PRD §8.6 "client-displayed flame + calendar month view",
 * mockup panel "4.5 Streak calendar" (N days · month · "X of D played" ·
 * weekday grid · Longest · Play today's board).
 *
 * Played days come from the server (`readPlayedDates`); `null` is "not known
 * yet" and renders as loading, never as an empty month.
 *
 * NOT built: "Streak Freeze · 1 equipped" and "Milestone rewards" (Stage 2
 * economy, CLAUDE.md hard rule 1), and "Every day since …" (the server returns
 * the count, not the date the run began).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing, withAlpha } from '../../components/tokens';
import { flameTier } from '../../game/streak';
import { t } from '../../i18n';

const MIN_TOUCH = 44;
const WEEK = 7;

export interface StreakScreenProps {
  /** §8.6 server-authoritative current streak. */
  streak: number;
  longest: number;
  /** YYYY-MM, UTC. */
  month: string;
  playedDates: ReadonlySet<string> | null;
  onPlay: () => void;
  onBack: () => void;
}

/** Leading blanks, then 1..daysInMonth, padded to whole weeks. UTC throughout. */
export function monthCells(month: string): (number | null)[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % WEEK !== 0) cells.push(null);
  return cells;
}

export function StreakScreen({
  streak,
  longest,
  month,
  playedDates,
  onPlay,
  onBack,
}: StreakScreenProps): React.JSX.Element {
  const cells = monthCells(month);
  const daysInMonth = cells.filter((c) => c !== null).length;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const tier = flameTier(streak);
  const weekdays = t('streak.weekdays').split(',');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Pressable
          style={styles.back}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('streak.back')}
        >
          <Text style={styles.backGlyph}>{'‹'}</Text>
        </Pressable>

        <Text style={[styles.flame, tier !== 'none' && styles[tier]]}>🔥</Text>
        <Text style={styles.days}>{t('streak.days', { n: streak })}</Text>

        <Text style={styles.month}>{monthLabel}</Text>
        <Text style={styles.played}>
          {playedDates === null
            ? t('streak.loading')
            : t('streak.monthPlayed', { played: playedDates.size, days: daysInMonth })}
        </Text>

        <View style={styles.grid}>
          {weekdays.map((d, i) => (
            <Text key={`h${i}`} style={styles.weekday}>
              {d}
            </Text>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <View key={`b${i}`} style={styles.cell} />;
            const date = `${month}-${String(day).padStart(2, '0')}`;
            const isPlayed = playedDates?.has(date) ?? false;
            return (
              <View
                key={date}
                style={[styles.cell, isPlayed && styles.cellPlayed]}
                accessible
                accessibilityLabel={t(isPlayed ? 'streak.dayPlayedA11y' : 'streak.dayA11y', {
                  date,
                })}
              >
                <Text style={[styles.cellText, isPlayed && styles.cellTextPlayed]}>{day}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.longest}>
          <Text style={styles.longestLabel}>{t('streak.longest')}</Text>
          <Text style={styles.longestValue}>{t('streak.days', { n: longest })}</Text>
        </View>

        <View style={styles.spacer} />
        <GoldButton label={t('streak.play')} onPress={onPlay} size="lg" />
      </View>
    </SafeAreaView>
  );
}

const CELL = `${100 / WEEK}%` as const;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  container: { flex: 1, padding: spacing.lg },
  back: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: 'center' },
  backGlyph: { color: colors.cream, fontSize: fontSize.xxl, fontWeight: '700' },
  flame: { textAlign: 'center', fontSize: fontSize.xxl },
  bronze: { textShadowColor: '#CD7F32', textShadowRadius: 12 },
  silver: { textShadowColor: '#C0C0C0', textShadowRadius: 12 },
  gold: { textShadowColor: colors.gold, textShadowRadius: 12 },
  days: {
    textAlign: 'center',
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    color: colors.cream,
  },
  month: { marginTop: spacing.lg, color: colors.cream, fontSize: fontSize.md, fontWeight: '800' },
  played: { marginTop: 2, color: colors.muted, fontSize: fontSize.xs, fontWeight: '800' },
  grid: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap' },
  weekday: {
    width: CELL,
    textAlign: 'center',
    color: colors.muted,
    fontSize: fontSize.xs,
    fontWeight: '800',
    paddingVertical: spacing.xs,
  },
  cell: {
    width: CELL,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
  },
  cellPlayed: { backgroundColor: withAlpha(colors.gold, 0.22) },
  cellText: { color: colors.muted, fontSize: fontSize.xs, fontWeight: '700' },
  cellTextPlayed: { color: colors.gold, fontWeight: '900' },
  longest: {
    marginTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.3),
    padding: spacing.sm,
  },
  longestLabel: { color: colors.muted, fontSize: fontSize.sm, fontWeight: '800' },
  longestValue: { color: colors.cream, fontSize: fontSize.sm, fontWeight: '900' },
  spacer: { flex: 1 },
});
