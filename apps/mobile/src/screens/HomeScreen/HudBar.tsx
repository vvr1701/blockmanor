/**
 * `HudBar` — PRD §7.11(a): "coins/lives from S2; settings gear; profile
 * avatar; level-map affordance (§0 v1.18)".
 *
 * Coins/lives are Stage-2 data (§9.1/§9.2) and are NOT read here — the two
 * `HUD_ECONOMY_SLOT_WIDTH` boxes are pure layout reservation (§0 rule 2a),
 * so their icons drop in later without reflowing this bar. Settings and
 * Profile are their own §16.1 screens (§12.1/§12.3) on other branches; the
 * gear/avatar are seams (`onOpenSettings`/`onOpenProfile` no-op when unset —
 * App.tsx has nothing to route them to yet), same shape as the map
 * affordance's `onOpenMap`, which IS wired (§7.10 already ships).
 *
 * Order follows the PRD's own enumeration order for (a): gear, avatar, map
 * (the map affordance is named last, as the v1.18 addition to the sentence).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BadgeDot } from '../../components/Badge';
import { blockColors, colors, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { HUD_ECONOMY_SLOT_WIDTH, HUD_ICON_SIZE } from './homeTokens';

const AVATAR_COLORS = Object.values(blockColors);

export interface HudBarProps {
  playerName: string | null;
  avatarId: number | null;
  /** `selectBadges(useMetaStore).mapChestReady` — true renders the red dot. */
  mapChestReady: boolean;
  onOpenMap: () => void;
  onOpenSettings?: (() => void) | undefined;
  onOpenProfile?: (() => void) | undefined;
}

export function HudBar({
  playerName,
  avatarId,
  mapChestReady,
  onOpenMap,
  onOpenSettings,
  onOpenProfile,
}: HudBarProps): React.JSX.Element {
  const avatarColor =
    avatarId !== null ? AVATAR_COLORS[avatarId % AVATAR_COLORS.length] : colors.night2;
  const avatarInitial = playerName ? playerName.trim().slice(0, 1).toUpperCase() : null;
  // The avatar chip's fill is a bright block color once `avatarId` is set
  // (a guest's is the dark `night2` default) — `colors.cream` on a bright
  // fill fails WCAG (as low as 1.40:1 on `colors.gold`), so the ink flips
  // with the fill rather than staying fixed. Applies to BOTH the initial and
  // the person-glyph fallback (a named avatar with no claimed name is a real
  // save shape — §7.1.3 lets a guest pick colors and still decline a name).
  const avatarInk = avatarId !== null ? colors.night : colors.cream;

  return (
    <View style={styles.row}>
      {/* §9.1/§9.2 (S2) — reserved, renders nothing, reads no Stage-2 state. */}
      <View style={styles.economySlot} />
      <View style={styles.economySlot} />

      <View style={styles.spacer} />

      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel={t('home.hud.settingsLabel')}
        hitSlop={4}
        style={styles.iconChip}
      >
        <Text style={styles.iconGlyph}>{'⚙'}</Text>
      </Pressable>

      <Pressable
        onPress={onOpenProfile}
        accessibilityRole="button"
        accessibilityLabel={t('home.hud.profileLabel')}
        hitSlop={4}
        style={[styles.iconChip, styles.avatarChip, { backgroundColor: avatarColor }]}
      >
        {avatarInitial ? (
          <Text style={[styles.avatarInitial, { color: avatarInk }]}>{avatarInitial}</Text>
        ) : (
          <Text style={[styles.iconGlyph, { color: avatarInk }]}>{'👤'}</Text>
        )}
      </Pressable>

      <Pressable
        onPress={onOpenMap}
        accessibilityRole="button"
        accessibilityLabel={
          mapChestReady ? t('home.hud.mapLabelChestReady') : t('home.hud.mapLabel')
        }
        hitSlop={4}
        style={styles.iconChip}
      >
        <Text style={styles.iconGlyph}>{'🗺️'}</Text>
        {mapChestReady ? <BadgeDot label={t('home.hud.mapBadgeLabel')} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  economySlot: { width: HUD_ECONOMY_SLOT_WIDTH, height: HUD_ICON_SIZE },
  spacer: { flex: 1 },
  iconChip: {
    width: HUD_ICON_SIZE,
    height: HUD_ICON_SIZE,
    borderRadius: radius.card,
    backgroundColor: 'rgba(10,14,30,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarChip: { borderColor: 'rgba(255,255,255,0.25)' },
  iconGlyph: { fontSize: fontSize.md, color: colors.cream },
  avatarInitial: { fontSize: fontSize.md, fontWeight: '900' },
});
