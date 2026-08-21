/**
 * `WinScreen` — PRD §7.5 / §16.1: "stars (thresholds from level schema),
 * score, 'Next level' CTA." Star 1 = win; stars 2/3 are the engine's own
 * `starsFor` (§6.6) evaluated against the level's `s2`/`s3` — this screen
 * never re-derives that, it only displays the `stars` count the caller reads
 * off the engine's own `LEVEL_WON` event (§0 v1.11 "asserted against the
 * engine's own emitted GameEvent[], never re-derived from the rules").
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel "3.5
 * Level win" (stars slam in, score card, gold CTA) — S2 extras on that panel
 * (streak chip, double-coins-with-ad card, manor star-flight row) are out of
 * Stage-1 scope (CLAUDE.md rule 1) and not reproduced here.
 *
 * No loading/error/offline states (CLAUDE.md screen checklist): this screen
 * is a pure, synchronous function of props already computed client-side by
 * the engine (§12.4 — levels are fully offline-capable; nothing here ever
 * calls the network).
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontSize, radius, spacing } from '../../components/tokens';
import { playCue } from '../../game/sfx';
import { t } from '../../i18n';

const TOTAL_STARS = 3;
const FILLED_STAR = '★';
const EMPTY_STAR = '☆';

export interface WinScreenProps {
  score: number;
  /** 1-3 (§7.5: star 1 = win). */
  stars: number;
  onNext: () => void;
}

export function WinScreen({ score, stars, onNext }: WinScreenProps): React.JSX.Element {
  // §15.1 "star_slam (win stars, ×3)" — §7.5 audit mn-4. Fires once on mount
  // alongside this screen's own star glyphs, distinct from `win_fanfare`
  // (already wired, `JuiceLayer.tsx` — the board-side celebration held open
  // by §7.5 audit M-2 while this screen mounts).
  useEffect(() => {
    playCue('star_slam');
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t('win.title')}</Text>

      <View style={styles.starsRow} accessible accessibilityLabel={t('win.starsLabel', { stars })}>
        {Array.from({ length: TOTAL_STARS }, (_, i) => (
          <Text key={i} style={i < stars ? styles.starFilled : styles.starEmpty}>
            {i < stars ? FILLED_STAR : EMPTY_STAR}
          </Text>
        ))}
      </View>

      <View style={styles.scoreCard}>
        <Text style={styles.scoreLabel}>{t('win.scoreLabel')}</Text>
        <Text style={styles.scoreValue}>{score}</Text>
      </View>

      <View style={styles.ctaSlot}>
        <GoldButton label={t('win.next')} onPress={onNext} size="lg" />
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
    gap: spacing.lg,
  },
  title: { color: colors.cream, fontSize: fontSize.xxl, fontWeight: '800', textAlign: 'center' },
  starsRow: { flexDirection: 'row', gap: spacing.sm },
  starFilled: { color: colors.gold, fontSize: 44 },
  starEmpty: { color: colors.muted, fontSize: 44 },
  scoreCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    gap: spacing.xs,
  },
  scoreLabel: {
    color: colors.muted,
    fontSize: fontSize.xs,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  scoreValue: {
    color: colors.cream,
    fontSize: fontSize.xxl,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  ctaSlot: { width: '100%', marginTop: spacing.lg },
});
