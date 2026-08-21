/**
 * `GhostButton` — PRD §15 "GhostButton". The secondary/low-emphasis action
 * (outline, no fill) — e.g. §7.5 FailScreen's "Level map" exit, §9.4's
 * eventual "Give up". Border/label colors are `colors.cream` at reduced
 * opacity (matches the Production Spec's ghost swatch: `border:2px solid
 * rgba(243,234,215,.28)`, `color:rgba(243,234,215,.7)` — `#F3EAD7` IS
 * `colors.cream`, so this is the token at two opacities, not a new hex).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { fontSize, radius, spacing } from './tokens';

export interface GhostButtonProps {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const MIN_TOUCH_TARGET = 44;

export function GhostButton({
  label,
  onPress,
  accessibilityLabel,
  style,
}: GhostButtonProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={8}
      style={({ pressed }) => [styles.base, pressed ? styles.pressed : null, style]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.card - 2,
    borderWidth: 2,
    borderColor: 'rgba(243,234,215,0.28)', // colors.cream @ 28%
  },
  pressed: { opacity: 0.6 },
  label: { color: 'rgba(243,234,215,0.7)', fontSize: fontSize.sm, fontWeight: '700' }, // colors.cream @ 70%
});
