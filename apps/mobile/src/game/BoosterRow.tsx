/**
 * §9.3 booster row — fills `GameplayScreen`'s reserved
 * `BOOSTER_ROW_RESERVED_HEIGHT` slot between the board and the tray. Three
 * buttons (hammer / broom / hourglass), each showing the player's owned
 * count from `useBoosterStore` and, for the booster whose showcase level
 * just granted it, a one-shot tooltip (§9.3 "first grant... with a one-shot
 * tooltip").
 *
 * Purely a display + "which booster did the player tap" component — it owns
 * no engine call and no inventory mutation. `GameplayScreen` decides what a
 * tap MEANS (arm targeting for hammer/broom, fire immediately for hourglass)
 * and is the one place that calls `applyBooster` and, on success, decrements
 * the store.
 *
 * §15 deuteranopia-safe: each booster is a distinct GLYPH (🔨/🧹/⏳), not a
 * color-only swatch — same "differ by shape" rule §7.8's obstacle motifs
 * follow, cheaply satisfied here since no bespoke icon asset exists yet.
 */
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BoosterType } from '@blockmanor/engine';
import { colors, fontSize, radius, spacing, withAlpha } from '../components/tokens';
import { t } from '../i18n';
import { BOOSTER_ROW_RESERVED_HEIGHT } from './boardTokens';
import { useBoosterStore } from '../state/useBoosterStore';

/** §7.3's tray-hitbox floor reused here — every booster button is a real
 * mid-level action, not a decorative HUD glyph, so it gets the same 64dp
 * minimum rather than the plainer 44dp CLAUDE.md a11y floor. */
const MIN_TOUCH_TARGET = 64;

const GLYPH: Record<BoosterType, string> = { hammer: '🔨', broom: '🧹', hourglass: '⏳' };

export interface BoosterRowProps {
  /** Which booster is currently armed (awaiting a board tap) — highlighted. */
  armed: BoosterType | null;
  /** hourglass is refused on a fixed-`pieceSequence` level (§0 v1.37(v)); the
   * caller (which already holds `GameState.config`) decides this. */
  hourglassDisabled: boolean;
  /** False once the run has ended, or on a mode that doesn't offer boosters
   * (Daily/Endless never mount this row at all — see `GameplayScreen`). */
  interactive: boolean;
  onPress: (type: BoosterType) => void;
}

export function BoosterRow({
  armed,
  hourglassDisabled,
  interactive,
  onPress,
}: BoosterRowProps): React.JSX.Element {
  const counts = useBoosterStore((s) => s.counts);
  const tooltip = useBoosterStore((s) => s.tooltip);
  const dismissTooltip = useBoosterStore((s) => s.dismissTooltip);

  const handlePress = useCallback(
    (type: BoosterType) => {
      if (tooltip) dismissTooltip();
      onPress(type);
    },
    [tooltip, dismissTooltip, onPress],
  );

  return (
    <View style={[styles.row, { height: BOOSTER_ROW_RESERVED_HEIGHT }]}>
      {tooltip ? (
        <Pressable style={styles.tooltip} onPress={dismissTooltip} accessibilityRole="button">
          <Text style={styles.tooltipText}>{t(`booster.tooltip.${tooltip}`)}</Text>
        </Pressable>
      ) : null}
      {(['hammer', 'broom', 'hourglass'] as const).map((type) => {
        const count = counts[type];
        const disabled = !interactive || count <= 0 || (type === 'hourglass' && hourglassDisabled);
        return (
          <Pressable
            key={type}
            onPress={() => handlePress(type)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={t(`booster.label.${type}`, { count })}
            accessibilityState={{ disabled, selected: armed === type }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.button,
              armed === type ? styles.armed : null,
              disabled ? styles.disabled : null,
              pressed && !disabled ? styles.pressed : null,
            ]}
          >
            <Text style={styles.glyph}>{GLYPH[type]}</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{count}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.card - 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: withAlpha(colors.gold, 0.3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  armed: {
    borderColor: colors.gold,
    borderWidth: 2,
    backgroundColor: withAlpha(colors.gold, 0.18),
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  glyph: { fontSize: fontSize.xl },
  countBadge: {
    position: 'absolute',
    right: -4,
    top: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: colors.night, fontSize: fontSize.xs, fontWeight: '900' },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    alignSelf: 'center',
    maxWidth: 280,
    marginBottom: spacing.xs,
    backgroundColor: colors.cream,
    borderRadius: radius.card - 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tooltipText: {
    color: colors.night,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textAlign: 'center',
  },
});
