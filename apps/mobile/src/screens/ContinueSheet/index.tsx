/**
 * `ContinueSheet` — PRD §9.4 / §16.1. Fills `FailScreen`'s reserved §9.4 slot
 * (`FailScreen/failTokens.ts`'s `CONTINUE_SLOT_RESERVED_HEIGHT`) with the real
 * "Continue — {price} 🪙" / "Second chance 📺 free" / tiny grey "Give up" row,
 * per §9.4 step 1. Rendered INLINE inside `FailScreen`'s existing cream card —
 * not a second backdrop — because the approved mockup ("3.6 Fail / Continue")
 * draws this content as part of that ONE card, not a sheet stacked on top of
 * it (`FailScreen`'s own doc comment already quotes that panel). The
 * give-up CONFIRM step is the one genuine overlay here (PauseSheet's own
 * confirm layer is the precedent), because it needs to interrupt the whole
 * screen, not just this slot.
 *
 * `LevelSession` decides WHETHER this renders at all (§0 v1.45's gating: the
 * engine `reliefClear` dry run, `continue_max_per_attempt`, caps) — this
 * component only renders what it is told to, same boundary `FailScreen`
 * itself already keeps (CLAUDE.md: a pure function of its props).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { GhostButton } from '../../components/GhostButton';
import { GoldButton } from '../../components/GoldButton';
import { ModalSheet } from '../../components/ModalSheet';
import { colors, fontSize, spacing, withAlpha } from '../../components/tokens';
import { t } from '../../i18n';
import { formatScore } from '../../i18n/format';

/** Below this, a dying streak isn't worth a farewell beat — matches §9.4's
 * own "if win-streak ≥2" thresholds on both the flame and the give-up confirm. */
const STREAK_WORTH_MOURNING = 2;

/** §9.4 "guttering" — a single fade from full to dim, not a loop (a looping
 * flicker on a screen the player is about to leave is motion for its own
 * sake, and §7.4's reduced-motion convention elsewhere in this codebase is a
 * ONE-SHOT settle, never an infinite repeat). */
const FLAME_GUTTER_MS = 1200;
const FLAME_GUTTER_TO = 0.35;

export interface ContinueSheetProps {
  /** §0 v1.45(a): the win-streak at the MOMENT of death — captured before
   * §9.3's unconditional fail-reset zeroes the live counter. Display only;
   * continuing does not restore it. */
  streakAtDeath: number;
  /** This attempt's next paid-continue price (§9.1 tier keys) — never a literal. */
  price: number;
  /** §0 v1.39(a)/(b)/v1.45(b): Second chance is offered only below both its
   * own daily cap AND this attempt's `continue_max_per_attempt`. */
  secondChanceOffered: boolean;
  /** True while a paid Continue's spend is in flight — disables the button
   * rather than letting a second tap mint a second spend. */
  busy: boolean;
  onContinue: () => void;
  onSecondChance: () => void;
  onGiveUp: () => void;
}

export function ContinueSheet({
  streakAtDeath,
  price,
  secondChanceOffered,
  busy,
  onContinue,
  onSecondChance,
  onGiveUp,
}: ContinueSheetProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const mourning = streakAtDeath >= STREAK_WORTH_MOURNING;

  const flameOpacity = useSharedValue(1);
  useEffect(() => {
    if (mourning) flameOpacity.value = withTiming(FLAME_GUTTER_TO, { duration: FLAME_GUTTER_MS });
  }, [mourning, flameOpacity]);
  const flameStyle = useAnimatedStyle(() => ({ opacity: flameOpacity.value }));

  const handleGiveUpPress = useCallback(() => {
    // §9.4 step 4 / §0 v1.45(a): confirm only when there was a streak worth
    // ending, read from the pre-reset snapshot, never the (already zeroed)
    // live store value.
    if (mourning) setConfirming(true);
    else onGiveUp();
  }, [mourning, onGiveUp]);

  return (
    <View style={styles.root}>
      {mourning ? (
        <Animated.Text style={[styles.flame, flameStyle]}>
          {t('continue.streak', { streak: streakAtDeath })}
        </Animated.Text>
      ) : null}

      <GoldButton
        label={t('continue.cta', { price: formatScore(price) })}
        onPress={onContinue}
        size="md"
        disabled={busy}
        style={styles.full}
      />
      {secondChanceOffered ? (
        <GhostButton
          label={t('continue.secondChance')}
          onPress={onSecondChance}
          variant="onLight"
          style={styles.full}
          disabled={busy}
        />
      ) : null}

      <Pressable
        style={styles.giveUp}
        onPress={handleGiveUpPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('continue.giveUp')}
        hitSlop={8}
      >
        <Text style={styles.giveUpText}>{t('continue.giveUp')}</Text>
      </Pressable>

      {confirming ? (
        <ModalSheet sheetAlign="center">
          <Text style={styles.confirmTitle}>{t('continue.giveUpConfirm.title')}</Text>
          <Text style={styles.confirmBody}>
            {t('continue.giveUpConfirm.body', { streak: streakAtDeath })}
          </Text>
          <GoldButton
            label={t('continue.giveUpConfirm.keepTrying')}
            onPress={() => setConfirming(false)}
            size="md"
            style={styles.full}
          />
          <Pressable
            style={styles.giveUp}
            onPress={onGiveUp}
            accessibilityRole="button"
            accessibilityLabel={t('continue.giveUpConfirm.leave')}
            hitSlop={8}
          >
            <Text style={styles.giveUpText}>{t('continue.giveUpConfirm.leave')}</Text>
          </Pressable>
        </ModalSheet>
      ) : null}
    </View>
  );
}

/** `colors.night` @ 70% on cream — 5.98:1, the repo's established on-light
 * ink (`GhostButton.onLight`, `PauseSheet`'s `INK_70`). */
const INK_70 = withAlpha(colors.night, 0.7);

const styles = StyleSheet.create({
  root: { width: '100%', alignItems: 'center', gap: spacing.sm },
  full: { alignSelf: 'stretch' },
  flame: {
    color: colors.night,
    fontSize: fontSize.sm,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  giveUp: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giveUpText: {
    color: INK_70,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  confirmTitle: {
    color: colors.night,
    fontSize: fontSize.lg,
    fontWeight: '800',
    textAlign: 'center',
  },
  confirmBody: {
    color: INK_70,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textAlign: 'center',
  },
});
