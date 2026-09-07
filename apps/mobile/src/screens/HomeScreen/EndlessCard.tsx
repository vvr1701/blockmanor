/**
 * "Endless" entry card — PRD §7.6 ("Entry: Home → small 'Endless' card") /
 * §7.11(e) ("Endless card (post-L10)"). Presentational only: `HomeScreen`
 * owns the `useMetaStore`/`useConfigStore` reads and passes plain props, the
 * same split `DailyBoardTile` already uses.
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel
 * "10.1 Endless entry" (unlocked card composition + locked-state variant).
 * Two things in that panel are deliberately NOT built here, for two DIFFERENT
 * reasons — don't collapse them:
 *   - The Manor Pass XP copy is a later STAGE (Manor Pass is Stage 4,
 *     CLAUDE.md hard rule 1): buildable data, wrong stage.
 *   - The 5-run score-history bar chart is not a stage problem at all: §4.4's
 *     persisted meta state holds a single scalar `endlessBest`, and §7.6 specs
 *     only "personal best tracked". There is NO run-history model to render,
 *     at any stage, until the PRD grows one — so this is a §0 amendment away,
 *     not a later PR away.
 * Everything else in the panel is here: title, personal best (or the §12.9
 * empty-state copy), the single "Play Endless" action, and the locked
 * variant's lock icon + unlock-progress copy.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { formatScore } from '../../i18n/format';

/** §15 a11y: every interactive element ≥44dp regardless of visual size. */
const MIN_TOUCH = 44;

export interface EndlessCardProps {
  /** True once `currentLevel > unlockLevel` — see `HomeScreen` for why
   * "after Level 10" reads as strictly-greater-than. */
  unlocked: boolean;
  /** `[RC] endless_unlock_level` (§13 Modes, default 10), resolved by
   * `HomeScreen` off the live snapshot. A prop rather than a module constant
   * so this number is never read from a call site (CLAUDE.md rule 3) — it was
   * a literal here until §0 v1.18 promoted it to the registry. */
  unlockLevel: number;
  /** The player's current progression pointer, for the locked subtitle's
   * "you're on N" and progress fill. */
  currentLevel: number;
  /** `useMetaStore.endlessBest`. 0 renders the §12.9 empty-state copy. */
  best: number;
  onPress: () => void;
}

export function EndlessCard({
  unlocked,
  unlockLevel,
  currentLevel,
  best,
  onPress,
}: EndlessCardProps): React.JSX.Element {
  if (!unlocked) {
    // Progress toward the gate, which opens at `currentLevel > 10` (see
    // `HomeScreen`) — i.e. the LEVELS CLEARED, not the level number. Dividing
    // the raw pointer would paint a full bar next to a padlock on level 10.
    const pct = Math.max(0, Math.min(1, (currentLevel - 1) / unlockLevel));
    const status = t('home.endless.locked.subtitle', {
      unlockLevel,
      level: currentLevel,
    });
    return (
      // The subtitle carries the whole payload of this state (how far off the
      // unlock is); `accessible` collapses the subtree into ONE node, so the
      // label has to carry it too or a screen reader hears only "locked".
      <View
        style={styles.card}
        accessible
        accessibilityLabel={t('home.endless.locked.a11y', { status })}
      >
        <View style={styles.row}>
          <View style={styles.lockBadge}>
            <Text style={styles.lockGlyph}>{'🔒'}</Text>
          </View>
          <View style={styles.textCol}>
            <Text style={[styles.title, styles.titleLocked]}>{t('home.endless.title')}</Text>
            <Text style={styles.subtitleLocked}>{status}</Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
        </View>
      </View>
    );
  }

  // §7.6: the personal best is the one thing this mode tracks — the label has
  // to announce it, not just the action (the card is one press target, so the
  // best-score row is otherwise invisible to a screen reader).
  const bestText =
    best > 0
      ? t('home.endless.bestA11y', { best: formatScore(best) })
      : t('home.endless.emptyBest');
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('home.endless.cta.a11y', { best: bestText })}
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
        <Text style={styles.bestValue}>
          {best > 0 ? formatScore(best) : t('home.endless.emptyBest')}
        </Text>
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
  // §0 v1.21/qa-prd-auditor B-4: "never a second gold button" binds the
  // COMPOSED screen — this card has exactly one live caller (`HomeScreen`),
  // which always sits beside the real PLAY CTA, so there is no standalone
  // context where gold would be correct. `colors.night2` is already this
  // card's own lock-badge/badge token, not a new hex; cream text on it is
  // >4.5:1 (verified in the render test).
  cta: {
    marginTop: spacing.sm,
    minHeight: MIN_TOUCH,
    borderRadius: radius.card,
    backgroundColor: colors.night2,
    borderBottomWidth: 3,
    borderBottomColor: 'rgba(220,226,238,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: colors.cream, fontSize: fontSize.md, fontWeight: '800' },
});
