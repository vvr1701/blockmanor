/**
 * Daily Board tile — PRD §7.11(c) / §7.1.3 ("Home reveal with Daily Board
 * tile pulsing"). SCOPE (per the §7.1 task boundary): render the tile's
 * pulsing presence only — no daily-board behavior (state, countdown, LIVE
 * detection) lives here; that's §7.11/§8's own build. Static "unplayed
 * today" presentation + the one-pulse-on-entry animation is the whole of
 * this component.
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, the Daily
 * Board card inside panel "2.1 Home — default" (title, red unplayed badge
 * dot, mini board preview omitted here — that preview needs real board data,
 * §8 scope).
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';

/** §7.11: "tile pulses once on screen entry". Not PRD-timed — a quick,
 * noticeable single beat rather than a long attention-grab. */
const PULSE_MS = 260;
const PULSE_PEAK_SCALE = 1.06;

export interface DailyBoardTileProps {
  /** Defaults true: pulse once when this tile mounts. §7.11's "max 1
   * pulse/session" (repeat-visit suppression) is Home-screen session state
   * that belongs to the full §7.11 build; this prop is the seam for it. */
  pulseOnMount?: boolean;
}

export function DailyBoardTile({ pulseOnMount = true }: DailyBoardTileProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (pulseOnMount && !reducedMotion) {
      scale.value = withSequence(
        withTiming(PULSE_PEAK_SCALE, { duration: PULSE_MS / 2 }),
        withTiming(1, { duration: PULSE_MS / 2 }),
      );
    }
    // Mount-only: pulses once on entry, not on every `pulseOnMount` re-render.
  }, []);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.card, style]}>
      <View style={styles.badgeDot} accessibilityLabel={t('home.dailyBoard.badgeLabel')} />
      <Text style={styles.title}>{t('home.dailyBoard.title')}</Text>
      <Text style={styles.subtitle}>{t('home.dailyBoard.subtitle')}</Text>
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
  badgeDot: {
    position: 'absolute',
    top: -6,
    right: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.bad,
    borderWidth: 2,
    borderColor: colors.night,
  },
  title: {
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.md,
    color: colors.cream,
  },
  subtitle: { marginTop: 2, fontSize: fontSize.xs, fontWeight: '800', color: colors.muted },
});
