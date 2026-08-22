/**
 * "Endless" entry card — PRD §7.6 ("Entry: Home → small 'Endless' card") /
 * §7.11(e) ("Endless card (post-L10)"). Presentational only: `HomeScreen`
 * owns the `useMetaStore`/`useConfigStore` reads and passes plain props, the
 * same split `DailyBoardTile` already uses.
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel
 * "10.1 Endless entry" (unlocked card composition + locked-state variant).
 * That panel also shows a 5-run score-history bar chart and copy about
 * boosters/Manor Pass XP that belong to a later stage (boosters/Manor Pass
 * are Stage 2/4, CLAUDE.md hard rule 1) — this card keeps only what §7.6
 * actually specs for Stage 1: title, personal best (or the §12.9 empty-state
 * copy), and the single "Play Endless" action; the locked variant's lock
 * icon + progress copy carries over since the unlock gate is Stage-1 scope.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';

/** §15 a11y: every interactive element ≥44dp regardless of visual size. */
const MIN_TOUCH = 44;

/**
 * §7.6 "Unlocked after Level 10" — a fixed narrative gate, not a `[RC]` key
 * (§7.6 carries no `[RC]` marker on this number, unlike e.g.
 * `mercy_threshold`; the §13 registry-completeness rule only binds marked
 * values). Same order as the §7.10 chest-at-L10 milestone.
 */
export const ENDLESS_UNLOCK_LEVEL = 10;

export interface EndlessCardProps {
  /** True once `currentLevel > ENDLESS_UNLOCK_LEVEL` — see `HomeScreen` for
   * why "after Level 10" reads as strictly-greater-than. */
  unlocked: boolean;
  /** The player's current progression pointer, for the locked subtitle's
   * "you're on N" and progress fill. */
  currentLevel: number;
  /** `useMetaStore.endlessBest`. 0 renders the §12.9 empty-state copy. */
  best: number;
  onPress: () => void;
}

export function EndlessCard({
  unlocked,
  currentLevel,
  best,
  onPress,
}: EndlessCardProps): React.JSX.Element {
  if (!unlocked) {
    const pct = Math.max(0, Math.min(1, currentLevel / ENDLESS_UNLOCK_LEVEL));
    return (
      <View style={styles.card} accessible accessibilityLabel={t('home.endless.locked.a11y')}>
        <View style={styles.row}>
          <View style={styles.lockBadge}>
            <Text style={styles.lockGlyph}>{'🔒'}</Text>
          </View>
          <View style={styles.textCol}>
            <Text style={[styles.title, styles.titleLocked]}>{t('home.endless.title')}</Text>
            <Text style={styles.subtitleLocked}>
              {t('home.endless.locked.subtitle', {
                unlockLevel: ENDLESS_UNLOCK_LEVEL,
                level: currentLevel,
              })}
            </Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('home.endless.cta')}
    >
      <View style={styles.row}>
        <View style={styles.badge}>
          <View style={styles.badgeRing} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.title}>{t('home.endless.title')}</Text>
          <Text style={styles.subtitle}>{t('home.endless.subtitle')}</Text>
        </View>
      </View>
      <View style={styles.bestRow}>
        <Text style={styles.bestLabel}>{t('home.endless.bestLabel')}</Text>
        <Text style={styles.bestValue}>{best > 0 ? best : t('home.endless.emptyBest')}</Text>
      </View>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>{t('home.endless.cta')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    borderRadius: radius.card,
    padding: spacing.md,
    backgroundColor: 'rgba(36,44,85,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(220,226,238,0.28)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.card,
    backgroundColor: colors.night2,
    borderWidth: 1,
    borderColor: 'rgba(220,226,238,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRing: {
    width: 20,
    height: 12,
    borderWidth: 4,
    borderColor: colors.cream,
    borderRadius: 10,
  },
  lockBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.card,
    backgroundColor: colors.night2,
    borderWidth: 2,
    borderColor: 'rgba(220,226,238,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockGlyph: { fontSize: fontSize.md },
  textCol: { flex: 1 },
  title: {
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.lg,
    color: colors.cream,
  },
  titleLocked: { color: colors.muted },
  subtitle: { marginTop: 2, fontSize: fontSize.xs, fontWeight: '800', color: colors.muted },
  subtitleLocked: { marginTop: 2, fontSize: fontSize.xs, fontWeight: '800', color: colors.muted },
  bestRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(8,11,24,0.45)',
    borderRadius: radius.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  bestLabel: { fontSize: fontSize.xs, fontWeight: '800', color: colors.muted },
  bestValue: {
    fontSize: fontSize.lg,
    fontWeight: '900',
    color: colors.cream,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    marginTop: spacing.sm,
    height: 9,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: 'rgba(220,226,238,0.45)' },
  cta: {
    marginTop: spacing.sm,
    minHeight: MIN_TOUCH,
    borderRadius: radius.card,
    backgroundColor: colors.gold,
    borderBottomWidth: 3,
    borderBottomColor: colors.goldDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: colors.night, fontSize: fontSize.md, fontWeight: '800' },
});
