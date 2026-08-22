/**
 * In-run Endless header — PRD §7.6, mockup panel "10.2 Endless gameplay"
 * (`docs/design/spec/Block Manor Production Spec.dc.html`). Replaces
 * `GameplayScreen`'s standard HUD row (no level title, no score chip: this
 * mode's whole HUD IS the score) via that screen's `header` render prop, so
 * the live score comes from its render pass and costs no extra one (§4.5).
 *
 * Composition per the mockup, top to bottom: the "ENDLESS" mode chip, the
 * centred hero score, the personal-best chip ("Best 12,480 — passed!"), and
 * the best-line marker that lights once the run passes it.
 *
 * Two deliberate token substitutions, both under §15's "where a mockup and
 * this document disagree, this document wins" rule — composition is copied,
 * raw CSS values are not:
 *   - Hero score: mockup 52px, §15's type scale tops out at 34 (`fontSize.xxl`).
 *     Scale wins; it is still the largest thing on the screen.
 *   - Mode chip: mockup's `linear-gradient(#AAB4CB,#6E7899)` becomes flat
 *     `colors.muted` (the §15 token that gradient is drawn from).
 *
 * The exit affordance is NOT in the mockup — the mockup has no way out of a
 * run at all, which §12.9's "invitations, never dead ends" does not permit
 * for a mode the player elected into. It is one close button, not §12.2's
 * `PauseSheet` (that is its own section, its own PR).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { formatScore } from '../../i18n/format';

/** §15 a11y: every interactive element ≥44dp regardless of visual size. */
const MIN_TOUCH = 44;

export interface EndlessHudProps {
  /** Live `GameState.score` for this run. */
  score: number;
  /** Personal best as it stood when this run STARTED (0 = no best yet, §12.9:
   * nothing to beat, so the whole best-line treatment is suppressed). */
  best: number;
  onExit: () => void;
}

export function EndlessHud({ score, best, onExit }: EndlessHudProps): React.JSX.Element {
  const hasBest = best > 0;
  const passed = hasBest && score > best;
  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <Pressable
          style={styles.exit}
          onPress={onExit}
          accessibilityRole="button"
          accessibilityLabel={t('endless.hud.exit')}
        >
          <Text style={styles.exitGlyph}>{'×'}</Text>
        </Pressable>
        <View style={styles.modeChip}>
          <Text style={styles.modeChipText}>{t('endless.hud.mode')}</Text>
        </View>
        {/* Balances the exit button so the chip stays optically centred. */}
        <View style={styles.exitSpacer} />
      </View>

      <Text style={styles.score} accessibilityLabel={t('endless.hud.scoreA11y', { score })}>
        {formatScore(score)}
      </Text>

      {hasBest ? (
        <>
          <View style={[styles.bestChip, passed && styles.bestChipPassed]}>
            <Text style={styles.bestChipText}>
              {passed
                ? t('endless.hud.bestPassed', { best: formatScore(best) })
                : t('endless.hud.best', { best: formatScore(best) })}
            </Text>
          </View>
          {/* "The best line sits at the score's vertical position and glows
              once passed — the only feedback the mode needs." (panel 10.2) */}
          <View style={styles.bestLineWrap}>
            <Text style={styles.bestLineLabel}>{t('endless.hud.bestLine')}</Text>
            <View style={[styles.bestLine, passed && styles.bestLinePassed]} />
          </View>
        </>
      ) : null}
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
  exitSpacer: { width: MIN_TOUCH, height: MIN_TOUCH },
  exitGlyph: { color: colors.cream, fontSize: fontSize.xl, fontWeight: '700', lineHeight: 28 },
  modeChip: {
    backgroundColor: colors.muted,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  modeChipText: {
    color: colors.night,
    fontSize: fontSize.xs,
    fontWeight: '900',
    letterSpacing: 3,
  },
  score: {
    marginTop: spacing.sm,
    textAlign: 'center',
    color: colors.cream,
    fontSize: fontSize.xxl,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  bestChip: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(233,196,106,0.45)',
    backgroundColor: 'rgba(233,196,106,0.16)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  bestChipPassed: { borderColor: colors.gold },
  bestChipText: {
    color: colors.gold,
    fontSize: fontSize.xs,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  bestLineWrap: { marginTop: spacing.sm },
  bestLineLabel: {
    textAlign: 'right',
    color: colors.gold,
    fontSize: fontSize.xs,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  bestLine: { height: 3, borderRadius: 2, backgroundColor: 'rgba(233,196,106,0.35)' },
  bestLinePassed: { backgroundColor: colors.gold },
});
