/**
 * Endless game-over sheet — PRD §7.6, mockup panels "10.3a Game over — new
 * best" and "10.3b Game over — regular" (`docs/design/spec/Block Manor
 * Production Spec.dc.html`). One component, two variants, exactly as the two
 * panels are one sheet with two states.
 *
 * 10.3a: "New personal best" chip · hero score · "+1,440 over your old best".
 * 10.3b: "Board full" title · hero score · your-best row · progress toward
 *        that best · "3,240 short — one good combo away".
 * Both: gold "Play again" CTA, ghost "Home".
 *
 * Both panels draw the sheet as cream parchment with dark text, not as a
 * night-navy card — that inversion is the point of the moment, so it is built
 * here. Token substitutions under §15's "where a mockup and this document
 * disagree, this document wins": the parchment gradient (#F7F1E3→#E7DCC4)
 * becomes flat `colors.cream`, the brown ink (#2A2115) becomes `colors.night`
 * (14.6:1 on cream), and the mockup's teal delta (#2F9184) is dropped — the
 * nearest §15 token, block `teal #2A9D8F`, is 2.78:1 on cream and fails the
 * text floor. §15 forbids depending on colour alone anyway: the "+" and the
 * copy carry the meaning.
 *
 * NOT built, and NOT for the same reason (see `EndlessCard`'s note):
 *   - "Pass XP" tile — Manor Pass is Stage 4 (CLAUDE.md hard rule 1).
 *   - "Lines" / "Best combo" tiles — §4.4's `GameState` carries no per-run
 *     line or peak-combo aggregate (only the live `combo`), so these need a
 *     data model that does not exist yet, at any stage.
 *   - "Share the score" — §11 social/share scope, not §7.6.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { formatScore } from '../../i18n/format';

/** §15 a11y: every interactive element ≥44dp regardless of visual size. */
const MIN_TOUCH = 44;

export interface EndlessResultSheetProps {
  /** This run's final score. */
  score: number;
  /** Personal best BEFORE this run (0 = first ever run, §12.9 empty state). */
  prevBest: number;
  onPlayAgain: () => void;
  onHome: () => void;
}

export function EndlessResultSheet({
  score,
  prevBest,
  onPlayAgain,
  onHome,
}: EndlessResultSheetProps): React.JSX.Element {
  const isNewBest = score > prevBest;
  // 10.3b's bar: how close this run got to the standing best. `prevBest > 0`
  // whenever this renders (a first run can only be a new best).
  const pct = prevBest > 0 ? Math.max(0, Math.min(1, score / prevBest)) : 0;
  return (
    // `accessibilityViewIsModal` traps screen-reader focus in the sheet, which
    // is what a modal wants. NOT `accessible`: that collapses the subtree into
    // one node and would make "Play again"/"Home" unreachable — the same dead
    // end this sheet exists to avoid, just for TalkBack/VoiceOver users.
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.sheet}>
        {isNewBest ? (
          <View style={styles.newBestChip}>
            <Text style={styles.newBestChipText}>{t('endless.result.newBest')}</Text>
          </View>
        ) : (
          <Text style={styles.title}>{t('endless.result.boardFull')}</Text>
        )}

        <Text style={styles.score} accessibilityLabel={t('endless.hud.scoreA11y', { score })}>
          {formatScore(score)}
        </Text>

        {isNewBest ? (
          <Text style={styles.delta}>
            {prevBest > 0
              ? t('endless.result.delta', { delta: formatScore(score - prevBest) })
              : t('endless.result.firstRecord')}
          </Text>
        ) : (
          <>
            <View style={styles.bestRow}>
              <Text style={styles.bestLabel}>{t('endless.result.yourBest')}</Text>
              <Text style={styles.bestValue}>{formatScore(prevBest)}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
            </View>
            <Text style={styles.shortBy}>
              {t('endless.result.short', { gap: formatScore(prevBest - score) })}
            </Text>
          </>
        )}

        <Pressable
          style={styles.cta}
          onPress={onPlayAgain}
          accessibilityRole="button"
          accessibilityLabel={t('endless.result.playAgain')}
        >
          <Text style={styles.ctaText}>{t('endless.result.playAgain')}</Text>
        </Pressable>
        <Pressable
          style={styles.ghost}
          onPress={onHome}
          accessibilityRole="button"
          accessibilityLabel={t('endless.result.home')}
        >
          <Text style={styles.ghostText}>{t('endless.result.home')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** `colors.night` at the alphas the cream sheet's secondary text/fills use —
 * all verified against the §15 contrast floors in `endlessScreen.render.test`. */
const INK_70 = 'rgba(19,24,48,0.7)';
const INK_55 = 'rgba(19,24,48,0.55)';
const INK_12 = 'rgba(19,24,48,0.12)';

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
  newBestChip: {
    alignSelf: 'center',
    backgroundColor: colors.gold,
    borderBottomWidth: 3,
    borderBottomColor: colors.goldDeep,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  newBestChipText: {
    color: colors.night,
    fontSize: fontSize.xs,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    textAlign: 'center',
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    color: colors.night,
  },
  score: {
    marginTop: spacing.sm,
    textAlign: 'center',
    color: colors.night,
    fontSize: fontSize.xxl,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  delta: {
    marginTop: spacing.xs,
    textAlign: 'center',
    color: colors.night,
    fontSize: fontSize.sm,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  bestRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: INK_12,
    borderRadius: radius.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  bestLabel: { color: INK_70, fontSize: fontSize.sm, fontWeight: '800' },
  bestValue: {
    color: colors.night,
    fontSize: fontSize.md,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    marginTop: spacing.sm,
    height: 9,
    borderRadius: 6,
    backgroundColor: INK_12,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: INK_55 },
  shortBy: {
    marginTop: spacing.xs,
    textAlign: 'center',
    color: INK_70,
    fontSize: fontSize.xs,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  cta: {
    marginTop: spacing.lg,
    minHeight: MIN_TOUCH,
    borderRadius: radius.card,
    backgroundColor: colors.gold,
    borderBottomWidth: 3,
    borderBottomColor: colors.goldDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: colors.night,
    fontFamily: fontFamily.display,
    fontSize: fontSize.md,
    fontWeight: '800',
  },
  ghost: {
    marginTop: spacing.sm,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: {
    color: INK_70,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
