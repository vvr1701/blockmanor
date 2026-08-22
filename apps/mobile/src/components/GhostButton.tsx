/**
 * `GhostButton` — PRD §15 "GhostButton". The secondary/low-emphasis action
 * (outline, no fill) — e.g. §7.5 FailScreen's "Level map" exit, §9.4's
 * eventual "Give up".
 *
 * Two variants, both existing §15 tokens at reduced opacity, never a new hex
 * (§7.5 audit M-3 — the single `onDark`-only palette this shipped with reads
 * `colors.cream` on a `colors.cream` card, a 1.00:1-contrast invisible
 * button):
 * - `onDark` (default): `colors.cream` at two opacities — the Production
 *   Spec's ghost swatch (`border:2px solid rgba(243,234,215,.28)`,
 *   `color:rgba(243,234,215,.7)`; `#F3EAD7` IS `colors.cream`) — for a
 *   ghost button sitting on the night board background.
 * - `onLight`: `colors.night` at two opacities (`#131830` → `rgba(19,24,48,…)`)
 *   — dark ink on a light card, the same "on-cream" reading the mockup's own
 *   exit link uses, expressed with this app's existing night token rather
 *   than the mockup's literal (untokenized) ink hex.
 *
 * `onLight` contrast against `colors.cream` (§7.5 re-audit item 1, sRGB
 * relative luminance, WCAG formula):
 *   - label @ 55% = 3.74:1 — fails the 4.5:1 normal-text minimum. Bumped to
 *     70% = 5.98:1 (matches `onDark`'s label alpha, which already used 70%).
 *   - border @ 28% = 1.82:1 — fails the 3:1 non-text minimum too, and by a
 *     wider margin than the label did. Bumped to 70% as well (not a bespoke
 *     value): reusing the label's alpha keeps this variant a one-alpha pair
 *     instead of introducing a third arbitrary opacity, and at 70% the
 *     border measures the same 5.98:1 — comfortably clear of 3:1 even
 *     accounting for anti-aliasing/rendering variance at a 2px stroke width.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { playCue } from '../game/sfx';
import { fontSize, radius, spacing } from './tokens';

export type GhostButtonVariant = 'onDark' | 'onLight';

const VARIANT_COLORS: Record<GhostButtonVariant, { border: string; label: string }> = {
  onDark: {
    border: 'rgba(243,234,215,0.28)', // colors.cream @ 28%
    label: 'rgba(243,234,215,0.7)', // colors.cream @ 70%
  },
  onLight: {
    border: 'rgba(19,24,48,0.7)', // colors.night @ 70% — 5.98:1 on cream (needs 3:1)
    label: 'rgba(19,24,48,0.7)', // colors.night @ 70% — 5.98:1 on cream (needs 4.5:1)
  },
};

export interface GhostButtonProps {
  label: string;
  onPress: () => void;
  /** Which background this button sits on — picks the token pair with real
   * contrast against it (§7.5 audit M-3). Defaults to `onDark`: the
   * Production Spec's ghost swatch is designed against the night board. */
  variant?: GhostButtonVariant;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const MIN_TOUCH_TARGET = 44;

export function GhostButton({
  label,
  onPress,
  variant = 'onDark',
  accessibilityLabel,
  style,
}: GhostButtonProps): React.JSX.Element {
  const c = VARIANT_COLORS[variant];
  // §15.1 "btn_tap (all buttons, subtle)" — the ONE seam every button-press
  // cue routes through (§7.5 audit mn-4).
  const handlePress = useCallback(() => {
    playCue('btn_tap');
    onPress();
  }, [onPress]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        { borderColor: c.border },
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      <Text style={[styles.label, { color: c.label }]}>{label}</Text>
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
  },
  pressed: { opacity: 0.6 },
  label: { fontSize: fontSize.sm, fontWeight: '700' },
});
