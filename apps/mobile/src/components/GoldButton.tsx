/**
 * `GoldButton` — PRD §15 "GoldButton(3 sizes/states)". The ONE primary-CTA
 * component (CLAUDE.md: "never ad-hoc ... one-off buttons"): every screen's
 * primary action (Play, Next level, Retry, Claim...) renders through this,
 * not a bespoke `Pressable`. Sizes mirror the Production Spec's "Primary
 * gold CTA" panel (large/medium/small, `docs/design/spec/Block Manor
 * Production Spec.dc.html` — chunky gradient-look button with a hard bottom
 * "chunk" shadow that drops to near-flat on press). This app has no gradient
 * primitive for plain RN views (only Skia canvases use one, §7.2/§7.3), so
 * the chunk look is the flat `colors.gold` fill + `colors.goldDeep` bottom
 * border already established by `HomeScreen`'s placeholder CTA — both real
 * §15 tokens, no new hex.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fontSize, radius, spacing } from './tokens';

export type GoldButtonSize = 'lg' | 'md' | 'sm';

const SIZE: Record<
  GoldButtonSize,
  { paddingV: number; paddingH: number; font: number; radius: number; border: number }
> = {
  lg: {
    paddingV: spacing.md,
    paddingH: spacing.xl,
    font: fontSize.lg,
    radius: radius.card,
    border: 4,
  },
  md: {
    paddingV: spacing.sm + 2,
    paddingH: spacing.lg,
    font: fontSize.md,
    radius: radius.card - 2,
    border: 3,
  },
  sm: {
    paddingV: spacing.xs + 2,
    paddingH: spacing.md,
    font: fontSize.sm,
    radius: radius.block + 6,
    border: 2,
  },
};

export interface GoldButtonProps {
  label: string;
  onPress: () => void;
  size?: GoldButtonSize;
  disabled?: boolean;
  /** Defaults to `label` — pass this when the visible label is decorative
   * (e.g. carries an emoji) and needs a plainer a11y string. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Every interactive element ≥44dp touch target (CLAUDE.md a11y rule),
 * regardless of the `sm` variant's smaller visual size — same principle as
 * §7.3's "Hitboxes: tray pieces min 64×64dp touch target regardless of
 * visual size", `hitSlop` covers the rest. */
const MIN_TOUCH_TARGET = 44;

export function GoldButton({
  label,
  onPress,
  size = 'lg',
  disabled = false,
  accessibilityLabel,
  style,
}: GoldButtonProps): React.JSX.Element {
  const s = SIZE[size];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        {
          paddingVertical: s.paddingV,
          paddingHorizontal: s.paddingH,
          borderRadius: s.radius,
          borderBottomWidth: s.border,
        },
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <Text style={[styles.label, { fontSize: s.font }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.gold,
    borderBottomColor: colors.goldDeep,
  },
  pressed: { transform: [{ translateY: 2 }], borderBottomWidth: 1 },
  // Same fill, dimmed — no new hex (CLAUDE.md rule), just an opacity state.
  disabled: { opacity: 0.4 },
  label: { color: colors.night, fontWeight: '800' },
});
