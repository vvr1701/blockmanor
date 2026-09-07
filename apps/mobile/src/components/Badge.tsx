/**
 * `BadgeDot` — PRD §15 "Badge". The one red-dot mechanism every "unclaimed /
 * unplayed" indicator renders through (§7.11: "badge-dot logic centralized
 * in `useMetaStore.badges`" — this is its ONE visual, so a second screen's
 * dot never drifts to a different size/color/position by hand-copying
 * `DailyBoardTile`'s original inline style).
 *
 * Absolutely positioned top-right of whatever host it is placed inside
 * (the host must be `position: relative`, which every card/icon chip in this
 * app already is). `style` lets a host override the border color to match
 * its own surface (the dot's border is a cutout ring, so it must equal
 * whatever it sits on — a `night2` HUD chip needs a different ring than a
 * `night`-backed card).
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from './tokens';

export interface BadgeDotProps {
  /** Screen-reader text for what the dot means in this context (e.g. "Unplayed
   * today", "Chest ready to open") — a bare dot has no meaning to a11y. */
  label: string;
  style?: StyleProp<ViewStyle>;
}

export function BadgeDot({ label, style }: BadgeDotProps): React.JSX.Element {
  return <View style={[styles.dot, style]} accessibilityLabel={label} />;
}

const styles = StyleSheet.create({
  dot: {
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
});
