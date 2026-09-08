/**
 * Daily Board tile — PRD §7.11(c): "countdown or 'LIVE' state, red badge dot
 * if unplayed today, streak flame chip 🔥N".
 *
 * SCOPE: the tile's data is not this component's to fetch — §8.3's client
 * flow (real countdown, LIVE detection, today's percentile) is a different,
 * not-yet-built branch. This renders exactly what `useMetaStore` already
 * holds today (`badges.dailyUnplayed`, `streak`) and nothing else; the
 * `subtitle`/`subtitleComplete` copy is the seam §8.3 replaces with a real
 * countdown/LIVE string — see the two i18n keys below.
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, the Daily
 * Board card inside panel "2.1 Home — default" (title, red unplayed badge
 * dot, mini board preview omitted here — that preview needs real board data,
 * §8 scope). The mockup draws the streak as a SEPARATE card; the PRD's own
 * §7.11(c) bullet lists the flame chip as one of three things the Daily
 * Board tile itself shows, so it renders inline here (content per PRD,
 * layout latitude per CLAUDE.md "layouts follow the approved mockups" — see
 * the report note on this one deliberate divergence).
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { BadgeDot } from '../../components/Badge';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';

/** §7.11: "tile pulses once on screen entry". Not PRD-timed — a quick,
 * noticeable single beat rather than a long attention-grab. */
const PULSE_MS = 260;
const PULSE_PEAK_SCALE = 1.06;

export interface DailyBoardTileProps {
  /** `useMetaStore.badges.dailyUnplayed` — renders the red dot and the
   * "tap to play" copy. */
  unplayed: boolean;
  /** `useMetaStore.streak` — renders a 🔥N chip when > 0. Independent of
   * `unplayed`: a streak can be nonzero while today is still unplayed
   * (yesterday's play, today not yet consumed), so it is not nested under it. */
  streak: number;
  /** Defaults true: pulse once when this tile mounts, IF `unplayed` is also
   * true. §7.11's "max 1 pulse/session" cap is Home-screen SESSION state
   * (outlives one mount) — `HomeScreen` computes it via `homeSession.ts` and
   * passes the result down; this prop is only the mount-local seam. */
  pulseOnMount?: boolean;
  /** §12.4: the offline state REPLACES the play affordance rather than
   * sitting beside it — a tile that still invites a tap it cannot honour is
   * the dead end §12.9 forbids. */
  offline?: boolean;
  /** §12.4's "with retry". Required whenever `offline` is true, or the state
   * would be a dead end. */
  onRetry?: () => void;
}

export function DailyBoardTile({
  unplayed,
  streak,
  pulseOnMount = true,
  offline = false,
  onRetry,
}: DailyBoardTileProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (pulseOnMount && unplayed && !reducedMotion) {
      scale.value = withSequence(
        withTiming(PULSE_PEAK_SCALE, { duration: PULSE_MS / 2 }),
        withTiming(1, { duration: PULSE_MS / 2 }),
      );
    }
    // Mount-only: pulses once on entry, not on every prop change.
  }, []);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.card, style]}>
      {unplayed && !offline ? (
        <BadgeDot label={t('home.dailyBoard.badgeLabel')} style={styles.badgeDot} />
      ) : null}
      <Text style={styles.title}>{t('home.dailyBoard.title')}</Text>
      {offline ? (
        <>
          <Text style={styles.subtitle}>{t('daily.offline')}</Text>
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t('daily.retry')}
            hitSlop={spacing.sm}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t('daily.retry')}</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.subtitle}>
          {t(unplayed ? 'home.dailyBoard.subtitle' : 'home.dailyBoard.subtitleComplete')}
        </Text>
      )}
      {streak > 0 ? (
        <View
          style={styles.flameChip}
          accessible
          accessibilityLabel={t('home.dailyBoard.streakA11y', { n: streak })}
        >
          <Text style={styles.flameChipText}>{t('home.dailyBoard.streakChip', { n: streak })}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    padding: spacing.md,
    backgroundColor: 'rgba(36,44,85,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(233,196,106,0.3)',
    alignSelf: 'stretch',
  },
  // The dot pokes outside the card's own edge (see `BadgeDot`'s -6/-5
  // offset), so its ring must match what's BEHIND the card there — the
  // screen background — not the card's own translucent fill.
  badgeDot: { borderColor: colors.night },
  title: {
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.md,
    color: colors.cream,
  },
  subtitle: { marginTop: 2, fontSize: fontSize.xs, fontWeight: '800', color: colors.muted },
  flameChip: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    borderRadius: radius.block + 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  flameChipText: {
    color: colors.gold,
    fontSize: fontSize.xs,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  retry: { minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.gold, fontSize: fontSize.sm, fontWeight: '700' },
});
