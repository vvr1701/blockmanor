/**
 * FTUE presentation overlay pieces — PRD §7.1 (v1.11): the hand-cursor drag
 * demonstration (L1 only) and the dimmed-UI "mechanic callout" banner
 * (L2-L4). Pure presentation, `pointerEvents="none"` throughout — none of
 * this ever intercepts the drag gesture underneath it (§7.3 stays untouched).
 *
 * Simplification (ponytail: exact board-cell targeting, upgrade when a
 * follow-up needs it): the hand cursor demonstrates "drag from the tray
 * toward the board" as a general affordance rather than animating to the
 * exact pixel anchor of the level's winning placement — that needs
 * `boardLayout`/anchor coordinates threaded out of `GameplayScreen`, which
 * doesn't expose them today. The ceiling this hits: a level whose winning
 * cell is far from where the loop points would read a little vague; every
 * scripted L1 board in this PR fills the bottom-right area, which is where
 * the loop already points, so it reads correctly for the content that ships.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import {
  FTUE_CALLOUT_FADE_MS,
  FTUE_DIM_OVERLAY_OPACITY,
  FTUE_HAND_CURSOR_LOOP_MS,
} from './ftueTokens';

export interface FtueCalloutProps {
  title: string;
  subtitle: string;
  /** L2-L4 (§7.1 "mechanic callouts", mockup 11.2): dim the board behind the
   * banner. L1's own cold-open treatment (mockup 1.3) never dims. */
  dim?: boolean;
}

/** Title/subtitle banner, "dismissed by playing" (mockup 11.2) — the caller
 * unmounts this once the player makes their first placement, never an OK
 * button (§7.1: "zero tutorials beyond FTUE" reads as no extra taps either). */
export function FtueCallout({ title, subtitle, dim = false }: FtueCalloutProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (!reducedMotion) opacity.value = withTiming(1, { duration: FTUE_CALLOUT_FADE_MS });
    // Mount-only: this is a one-shot fade-in, not a value that re-tracks `reducedMotion`.
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={styles.fill} pointerEvents="none">
      {dim ? <View style={styles.dimScrim} /> : null}
      <Animated.View style={[styles.banner, style]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </Animated.View>
    </View>
  );
}

/** §7.1.1 "Hand cursor demonstrates drag" — L1 only. A loop from roughly the
 * tray toward the board (see the module doc simplification note above). */
export function FtueHandCursor(): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!reducedMotion) {
      t.value = withRepeat(
        withSequence(
          withTiming(1, {
            duration: FTUE_HAND_CURSOR_LOOP_MS / 2,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(0, {
            duration: FTUE_HAND_CURSOR_LOOP_MS / 2,
            easing: Easing.inOut(Easing.ease),
          }),
        ),
        -1,
      );
    }
    // Mount-only: starts the infinite loop once; reduced-motion is read fresh
    // on mount, matching the same one-shot pattern as `FtueCallout` above.
  }, []);
  const style = useAnimatedStyle(() => ({
    // Loops between "over the tray" and "over the lower board" — a generic
    // drag-toward-the-board demonstration (see module doc).
    transform: [{ translateY: -140 + t.value * -60 }, { scale: 1 - t.value * 0.15 }],
    opacity: reducedMotion ? 0.9 : 0.55 + t.value * 0.35,
  }));

  return (
    <View style={styles.handWrap} pointerEvents="none">
      <Animated.View style={[styles.handDot, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center' },
  dimScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.night,
    opacity: FTUE_DIM_OVERLAY_OPACITY,
  },
  banner: {
    marginTop: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  title: {
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    color: colors.cream,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing.xs,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.muted,
    textAlign: 'center',
  },
  handWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  handDot: {
    marginBottom: spacing.xl * 2,
    width: 28,
    height: 28,
    borderRadius: radius.card,
    backgroundColor: colors.gold,
    borderWidth: 2,
    borderColor: colors.cream,
  },
});
