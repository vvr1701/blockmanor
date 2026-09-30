/**
 * §9.3 pre-level booster slot (×1): "a single booster pre-selected before a
 * level starts". Minimal viable UI (per this session's scope note) — a plain
 * `ModalSheet` list of the player's owned boosters plus a Skip, shown by
 * `LevelSession` right before a campaign level mounts, ONLY when the player
 * owns at least one booster (nothing to pick otherwise).
 *
 * PRD-AMENDMENT-NEEDED (flagged in this session's report, not decided
 * silently): §9.3 says this selection is "applied automatically" — literal
 * only for `hourglass` (no target needed). For `hammer`/`broom`,
 * `GameplayScreen` arms the booster on mount instead of blind-firing at an
 * unseen cell/row — the player's first board tap spends it. This component
 * only collects the CHOICE; `LevelSession` decides what "applied
 * automatically" means per type.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BoosterType } from '@blockmanor/engine';
import { GhostButton } from '../components/GhostButton';
import { GoldButton } from '../components/GoldButton';
import { ModalSheet } from '../components/ModalSheet';
import { colors, fontSize, radius, spacing, withAlpha } from '../components/tokens';
import { t } from '../i18n';
import type { BoosterCounts } from '../state/useBoosterStore';

const GLYPH: Record<BoosterType, string> = { hammer: '🔨', broom: '🧹', hourglass: '⏳' };
const TYPES: readonly BoosterType[] = ['hammer', 'broom', 'hourglass'];

export interface BoosterPreLevelSheetProps {
  counts: BoosterCounts;
  /** Pre-highlighted choice — the win-streak system's "pre-filled next
   * level" grant (§9.3), if any and still owned. */
  initialSelection: BoosterType | null;
  /** hourglass is refused on a fixed-`pieceSequence` level (§0 v1.37(v)). */
  hourglassDisabled: boolean;
  /** `null` = no booster armed for this level (skip/none owned). */
  onConfirm: (type: BoosterType | null) => void;
}

export function BoosterPreLevelSheet({
  counts,
  initialSelection,
  hourglassDisabled,
  onConfirm,
}: BoosterPreLevelSheetProps): React.JSX.Element {
  const [selected, setSelected] = useState<BoosterType | null>(
    initialSelection && counts[initialSelection] > 0 ? initialSelection : null,
  );
  const handleConfirm = useCallback(() => onConfirm(selected), [onConfirm, selected]);
  const handleSkip = useCallback(() => onConfirm(null), [onConfirm]);

  return (
    <ModalSheet sheetAlign="center">
      <Text style={styles.title}>{t('booster.preLevel.title')}</Text>
      <View style={styles.list}>
        {TYPES.map((type) => {
          const owned = counts[type];
          const disabled = owned <= 0 || (type === 'hourglass' && hourglassDisabled);
          return (
            <Pressable
              key={type}
              disabled={disabled}
              onPress={() => setSelected(type)}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected: selected === type }}
              style={[
                styles.row,
                selected === type ? styles.rowSelected : null,
                disabled ? styles.rowDisabled : null,
              ]}
            >
              <Text style={styles.glyph}>{GLYPH[type]}</Text>
              <Text style={styles.rowLabel}>{t(`booster.name.${type}`)}</Text>
              <Text style={styles.rowCount}>×{owned}</Text>
            </Pressable>
          );
        })}
      </View>
      <GoldButton label={t('booster.preLevel.confirm')} onPress={handleConfirm} size="md" />
      <GhostButton
        label={t('booster.preLevel.skip')}
        onPress={handleSkip}
        variant="onLight"
        style={styles.skip}
      />
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    textAlign: 'center',
    color: colors.night,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card - 2,
    borderWidth: 2,
    borderColor: withAlpha(colors.night, 0.12),
  },
  rowSelected: { borderColor: colors.goldDeep, backgroundColor: withAlpha(colors.gold, 0.18) },
  rowDisabled: { opacity: 0.35 },
  glyph: { fontSize: fontSize.xl },
  rowLabel: { flex: 1, color: colors.night, fontSize: fontSize.md, fontWeight: '700' },
  rowCount: { color: colors.night, fontSize: fontSize.md, fontWeight: '800' },
  skip: { alignSelf: 'center', marginTop: spacing.xs },
});
