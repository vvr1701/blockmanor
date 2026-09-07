/**
 * `BottomNav` — PRD §7.11(g): "Home · Manor(S3) · Events(S4) · Team(S4) ·
 * Shop(S2) — locked tabs hidden, not greyed."
 *
 * Presentational: `HomeScreen` reads the §13 flags and passes plain
 * booleans, same split `EndlessCard`/`DailyBoardTile` already use. Each
 * later-stage tab is `{flagOn ? <Tab/> : null}` — exactly the "flag-hidden
 * nav slot" §0 rule 2a names as in-scope for this build. All four are
 * `false` today (every flag they read defaults `false` per §13's registry),
 * so in Stage 1 only Home renders — matching the PRD text exactly.
 *
 * `Team` gates on its own `flag_team` (§13, PRD v1.20) — each tab now names
 * its flag inline in §7.11(g) itself, precisely so Team and Events can move
 * independently: turning Events on for Stage 4 must not silently unhide
 * Team too, which reusing one flag for both would have done invisibly.
 *
 * `Shop`(S2) gates on `flag_economy`, the broader "the wallet exists" flag
 * (§13 Economy group) rather than `flag_iap` (§13 IAP group), since the shop
 * itself is reachable — and meaningful — the moment coins exist, before any
 * purchase flow does.
 *
 * None of the four routes to a real screen: `ManorScreen`/`EventsScreen`/
 * `TeamScreen`/`ShopScreen` don't exist yet (their own PRD sections are out
 * of scope here), and every flag they gate on is `false` in Stage 1 regardless
 * — so there is nothing to route to even in principle until those land.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, spacing } from '../../components/tokens';
import { t } from '../../i18n';

const MIN_TOUCH_TARGET = 44;

export interface BottomNavProps {
  manorUnlocked: boolean;
  eventsUnlocked: boolean;
  teamUnlocked: boolean;
  shopUnlocked: boolean;
}

interface TabDef {
  key: string;
  labelKey:
    'home.nav.home' | 'home.nav.manor' | 'home.nav.events' | 'home.nav.team' | 'home.nav.shop';
  glyph: string;
}

const HOME_TAB: TabDef = { key: 'home', labelKey: 'home.nav.home', glyph: '🏠' };
const MANOR_TAB: TabDef = { key: 'manor', labelKey: 'home.nav.manor', glyph: '🏰' };
const EVENTS_TAB: TabDef = { key: 'events', labelKey: 'home.nav.events', glyph: '🎉' };
const TEAM_TAB: TabDef = { key: 'team', labelKey: 'home.nav.team', glyph: '👥' };
const SHOP_TAB: TabDef = { key: 'shop', labelKey: 'home.nav.shop', glyph: '🛒' };

export function BottomNav({
  manorUnlocked,
  eventsUnlocked,
  teamUnlocked,
  shopUnlocked,
}: BottomNavProps): React.JSX.Element {
  const tabs: TabDef[] = [
    HOME_TAB,
    ...(manorUnlocked ? [MANOR_TAB] : []),
    ...(eventsUnlocked ? [EVENTS_TAB] : []),
    ...(teamUnlocked ? [TEAM_TAB] : []),
    ...(shopUnlocked ? [SHOP_TAB] : []),
  ];

  return (
    <View style={styles.row}>
      {tabs.map((tab) => (
        <View key={tab.key} style={styles.tab} accessible accessibilityLabel={t(tab.labelKey)}>
          <Text style={tab.key === 'home' ? styles.glyphActive : styles.glyph}>{tab.glyph}</Text>
          <Text style={tab.key === 'home' ? styles.labelActive : styles.label}>
            {t(tab.labelKey)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tab: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  glyph: { fontSize: fontSize.md, color: colors.muted },
  glyphActive: { fontSize: fontSize.md, color: colors.gold },
  label: { fontSize: fontSize.xs, fontWeight: '800', color: colors.muted },
  labelActive: { fontSize: fontSize.xs, fontWeight: '800', color: colors.gold },
});
