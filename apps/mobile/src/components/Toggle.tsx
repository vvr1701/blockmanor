/**
 * `Toggle` — a genuinely new §15 design-system component (CLAUDE.md: "Use
 * ONLY design-system tokens and components — never ... one-off buttons.
 * Extend the system deliberately if a new component is genuinely needed, in
 * src/components with all states"). §15's component list (`GoldButton ·
 * GhostButton · Card · ModalSheet · HUDBar · TimerChip · Badge · ProgressBar
 * · Toast · Confetti`) has no switch/toggle primitive, and §12.1 is the
 * first section that genuinely needs one (SFX/music/haptics + two
 * notification-category toggles, all live pill switches — `PauseSheet`'s
 * settings row deliberately deferred exactly this construction to "when
 * §12.1 exists").
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel 9.1
 * "Settings" (`s.toggle`/`s.knob` cells in its `settingsRows` table) — a
 * pill track with a sliding circular knob. Token-only, no new hex: the ON
 * track is `colors.gold` (matches the mockup's warm "on" fill and this
 * repo's one existing brand-accent color); the OFF track is `colors.night2`
 * (this repo's established dark-surface token, e.g. `HudBar`'s guest
 * avatar); the knob is `colors.cream` on both states, which is what actually
 * needs to read against either track.
 *
 * All three states: on, off, disabled (rendered as `off` visually at reduced
 * opacity, `accessibilityState.disabled` carries the semantic — same
 * treatment `GoldButton.disabled` already uses, not a bespoke grey).
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { playCue } from '../game/sfx';
import { colors, radius } from './tokens';

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const KNOB_SIZE = 20;
const KNOB_INSET = (TRACK_HEIGHT - KNOB_SIZE) / 2;

/** ≥44dp on every interactive element (CLAUDE.md a11y rule) — the visual
 * track is narrower, so `hitSlop` makes up the difference, same pattern as
 * `GoldButton`'s `sm` size and §7.3's tray-piece hitboxes. */
const MIN_TOUCH_TARGET = 44;

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Screen-reader label — a bare switch has no meaning without one. */
  label: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Toggle({
  value,
  onValueChange,
  label,
  disabled = false,
  style,
}: ToggleProps): React.JSX.Element {
  const handlePress = useCallback(() => {
    if (disabled) return;
    playCue('btn_tap');
    onValueChange(!value);
  }, [disabled, onValueChange, value]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      hitSlop={(MIN_TOUCH_TARGET - TRACK_HEIGHT) / 2}
      style={[
        styles.track,
        { backgroundColor: value && !disabled ? colors.gold : colors.night2 },
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.card,
    justifyContent: 'center',
    padding: KNOB_INSET,
  },
  disabled: { opacity: 0.4 },
  knob: {
    position: 'absolute',
    top: KNOB_INSET,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: colors.cream,
  },
  knobOff: { left: KNOB_INSET },
  knobOn: { left: TRACK_WIDTH - KNOB_SIZE - KNOB_INSET },
});
