/**
 * `ChestSheet` — the claim interaction for PRD §7.10's "Chest at L10/20/30…
 * (Stage 1 reward: cosmetic avatar frames; coins retrofit in Stage 2)".
 * Not a §16.1 canonical screen: §16.1 names only `LevelMapScreen` for §7.10,
 * so this is that screen's own overlay, not a route.
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel "12.1
 * Chest opening" — brass-framed cream sheet, closed pulsing chest with a gold
 * band and lock plate, then the reward revealed on a light card, then a gold
 * "Collect" CTA.
 *
 * DIVERGENCES from that panel, all deliberate (§15: the PRD wins, and the
 * mismatch gets reported):
 * 1. The panel's stage-3 "contents fan out" shows THREE loot cards — coins,
 *    a booster and a cosmetic. §7.10's Stage-1 reward is "cosmetic avatar
 *    frames" and nothing else; coins are Stage 2 (§9.1) and boosters §9.3, so
 *    exactly one reward card renders here. The row is not a reserved slot —
 *    it reads no later-stage state and imports no later-stage module.
 * 2. The panel's "2 · burst" particle stage is not built: §15's component
 *    list has `Confetti` as its particle primitive and this app has no such
 *    component yet. Building one inside a §7.10 PR would be a design-system
 *    addition smuggled into a feature PR; the sheet opens with the panel's
 *    stage-1 pulse and stage-3 reveal, which are the two states that carry
 *    information.
 * 3. The panel's CTA reads "Collect all" (plural, because of divergence 1).
 *
 * No loading / error / offline states: a chest claim is a pure local write to
 * the MMKV meta store (§4.4) against content that ships in the bundle. There
 * is no network path to fail (§12.4 — campaign play is fully offline), and
 * the one non-happy input — a chest level with no frame in
 * `AVATAR_FRAMES` — is handled by `LevelMapScreen`, which never opens this
 * sheet without one.
 */
import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { playCue } from '../../game/sfx';
import { t } from '../../i18n';

/** The mockup's stage-1 "closed, pulsing" beat: `animation: bm-pulse 1.4s`.
 * Both numbers are the spec's keyframe verbatim — `bm-pulse` is
 * `scale(1) → scale(1.03)` over half a period. */
export const CHEST_PULSE_MS = 1400;
export const CHEST_PULSE_SCALE = 1.03;
const MIN_TOUCH_TARGET = 44;

export interface ChestSheetProps {
  /** The §7.10 chest level (L10/20/30…). */
  chestLevel: number;
  /** i18n'd display name of the avatar frame this chest pays out. */
  frameName: string;
  /** True once the reward has been granted and persisted. */
  opened: boolean;
  /** Grants the frame and marks the chest claimed. */
  onOpen: () => void;
  /** Dismisses the sheet. */
  onClose: () => void;
}

export function ChestSheet({
  chestLevel,
  frameName,
  opened,
  onOpen,
  onClose,
}: ChestSheetProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (opened || reducedMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withRepeat(
      withTiming(CHEST_PULSE_SCALE, { duration: CHEST_PULSE_MS / 2 }),
      -1,
      true,
    );
  }, [opened, reducedMotion, scale]);

  const chestStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handleOpen = useCallback(() => {
    // §15.1 "chest_open" — the rewarding moment §15.1 forbids leaving silent.
    playCue('chest_open');
    onOpen();
  }, [onOpen]);

  return (
    // `accessibilityViewIsModal` WITHOUT `accessible` on the same node: the
    // §7.6 fix pass found that pairing collapses a sheet into a single
    // screen-reader node and makes its buttons unreachable — the same dead
    // end for TalkBack users that §12.9 forbids for everyone else.
    <View style={styles.backdrop} accessibilityViewIsModal>
      <View style={styles.frame}>
        <View style={styles.sheet}>
          <Text style={styles.eyebrow}>{t('map.chest.eyebrow', { level: chestLevel })}</Text>
          <Text style={styles.title}>
            {t(opened ? 'map.chest.openedTitle' : 'map.chest.title')}
          </Text>

          <Animated.View style={[styles.chest, chestStyle]}>
            <View style={styles.chestBand} />
            <View style={styles.chestLock} />
          </Animated.View>

          {opened ? (
            <View style={styles.rewardCard}>
              <View style={styles.frameSwatch} />
              <Text style={styles.rewardName}>{frameName}</Text>
              <Text style={styles.rewardKind}>{t('map.chest.rewardKind')}</Text>
            </View>
          ) : (
            <Text style={styles.teaser}>{t('map.chest.teaser')}</Text>
          )}

          <GoldButton
            label={t(opened ? 'map.chest.collect' : 'map.chest.open')}
            onPress={opened ? onClose : handleOpen}
            size="lg"
            style={styles.cta}
          />
        </View>
      </View>

      {/* §12.9 "invitations, never dead ends": the sheet always has a way out,
          including before the chest is opened. */}
      <Pressable
        style={styles.dismiss}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('map.chest.dismissLabel')}
        hitSlop={8}
      >
        <Text style={styles.dismissText}>{t('map.chest.dismiss')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    // `colors.night` @ 82% — the panel's dark scrim, no new hex.
    backgroundColor: 'rgba(19,24,48,0.82)',
  },
  /** The panel's brass frame around the cream sheet. */
  frame: {
    alignSelf: 'stretch',
    borderRadius: radius.sheet + spacing.sm,
    borderWidth: 2,
    borderColor: colors.goldDeep,
    backgroundColor: colors.goldDeep,
    padding: spacing.sm,
  },
  sheet: {
    borderRadius: radius.sheet,
    backgroundColor: colors.cream,
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  eyebrow: {
    // `colors.night` @ 70% on cream — 5.98:1, the same pair `GhostButton`'s
    // `onLight` variant uses (§7.5 re-audit item 1).
    color: 'rgba(19,24,48,0.7)',
    fontSize: fontSize.xs,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.night,
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    textAlign: 'center',
  },
  chest: {
    width: 112,
    height: 88,
    marginVertical: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 3,
    borderColor: colors.goldDeep,
    backgroundColor: colors.night2,
  },
  chestBand: {
    position: 'absolute',
    left: -3,
    right: -3,
    top: 20,
    height: 12,
    backgroundColor: colors.gold,
  },
  chestLock: {
    position: 'absolute',
    left: '50%',
    top: 16,
    marginLeft: -9,
    width: 18,
    height: 20,
    borderRadius: radius.block - 2,
    backgroundColor: colors.cream,
  },
  teaser: { color: 'rgba(19,24,48,0.7)', fontSize: fontSize.sm, textAlign: 'center' },
  rewardCard: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.goldDeep,
    // `colors.gold` @ 18% on cream — the panel's warm loot card.
    backgroundColor: 'rgba(233,196,106,0.18)',
    padding: spacing.md,
  },
  frameSwatch: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 4,
    borderColor: colors.goldDeep,
    backgroundColor: colors.night2,
  },
  rewardName: {
    color: colors.night,
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.lg,
    textAlign: 'center',
  },
  rewardKind: {
    color: 'rgba(19,24,48,0.7)',
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  cta: { alignSelf: 'stretch', marginTop: spacing.sm },
  dismiss: {
    marginTop: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  dismissText: { color: colors.cream, fontSize: fontSize.sm, fontWeight: '700' },
});
