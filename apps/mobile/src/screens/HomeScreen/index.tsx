import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { GoldButton } from '../../components/GoldButton';
import { colors, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { useConfigStore } from '../../state/useConfigStore';
import { selectBadges, useMetaStore } from '../../state/useMetaStore';
import { BottomNav } from './BottomNav';
import { DailyBoardTile } from './DailyBoardTile';
import { EndlessCard } from './EndlessCard';
import { EVENT_BANNER_SLOT_HEIGHT } from './homeTokens';
import { consumeDailyPulse } from './homeSession';
import { HudBar } from './HudBar';

/**
 * `HomeScreen` — PRD §7.11 / §16.1, the hub.
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panels
 * "2.1 Home — default" / "2.2 Home — lapsed player" (2.2 is §12.7's lapsed
 * variant, Stage 3 — out of scope here; see the DIVERGENCE note below for
 * what else Stage 1 doesn't build from those two panels).
 *
 * Layout, PRD §7.11 (a)-(g), all seven present:
 * (a) `HudBar` — settings gear, profile avatar, the §0 v1.18 level-map
 *     affordance; coin/life chips are RESERVED SLOTS (§9.1/§9.2, Stage 2),
 *     rendering nothing and reading no Stage-2 state (§0 rule 2a).
 * (b) manor exterior — Stage 1 is the STATIC night manor (`styles.manor*`);
 *     the real per-room renovation reflection is Stage 3 (§3).
 * (c) `DailyBoardTile` — countdown/LIVE seam, red badge dot, streak chip.
 * (d) the ONE gold CTA on this screen — "PLAY — Level N".
 * (e) `EndlessCard`, reused unmodified from `feat/7.6-endless`.
 * (f) event banner slot — reserved, `flag_events` (Stage 4)-gated, empty today.
 * (g) `BottomNav` — only Home renders in Stage 1; the rest are flag-hidden.
 *
 * DIVERGENCE from the mockup, deliberate (CLAUDE.md: PRD wins on content,
 * "layouts follow the approved mockups" governs arrangement — see also
 * `DailyBoardTile`'s own note on the streak chip): panel 2.1 draws the
 * primary CTA ABOVE the event banner and the Daily Board/streak/Manor-Pass/
 * Team-chest tile grid, i.e. mid-screen, not bottom-anchored above the nav.
 * §7.11's own prose gives a literal top-to-bottom letter order —
 * (a)(b)(c)(d)(e)(f)(g) — that would put the CTA ABOVE the Endless card and
 * the event banner slot too. Neither reading is used verbatim: (b) is
 * obviously an absolute full-bleed background layer, not a row sandwiched
 * between (a) and (c), which already shows the prose list isn't a literal
 * DOM order. This build follows the mockup's actual visual arrangement
 * instead (HUD -> event banner slot -> tiles -> CTA -> nav, CTA anchored
 * just above the bottom nav, the largest and lowest non-nav element), since
 * CLAUDE.md hands arrangement to the mockup and content/behavior to the
 * PRD, and both agree on content here. Reported per the task brief's
 * disagreement-reporting instruction.
 *
 * Also NOT built from panel 2.1, both out of (a)-(g)'s scope: the Manor Pass
 * and Team-chest tiles (Stage 3/4 data, and — unlike (f) — §7.11's lettered
 * list names no reserved slot for them) and the event carousel's own content
 * chrome (only its Stage-4-flagged reservation is in scope here).
 *
 * States (CLAUDE.md screen checklist): no loading/error/offline — every
 * input is synchronous cache (`useMetaStore`/`useConfigStore`, both
 * MMKV/bundle-backed, never network — "Home renders from cache instantly, no
 * network wait" per §7.11's own rules line). No empty state either: a fresh
 * install still has a level to play and a Daily Board tile to show — §7.11
 * names no empty-state trigger of its own, and none of §12.9's four listed
 * triggers (percentile / endless-best / team / friends) belong to Home
 * itself. Home's own three Stage-1 states — default, daily-unplayed,
 * daily-complete — are covered in `homeScreen.dailyTile.render.test.tsx`,
 * derived from the two fields the store actually has today
 * (`badges.dailyUnplayed`, `streak`); see that file for how and why.
 */
export interface HomeScreenProps {
  onPlay: () => void;
  /** Wired only when `flag_endless` is on AND the player has passed
   * `endless_unlock_level` (`EndlessCard` renders no press target
   * otherwise) — see `App.tsx` for the no-router seam this calls into. */
  onPlayEndless?: () => void;
  /** (a) HUD map affordance -> §7.10 `LevelMapScreen`. Unlike
   * `onOpenSettings`/`onOpenProfile` below, this IS wired in `App.tsx` —
   * §7.10 already ships, it just had no route FROM Home until this PRD
   * v1.18 addition. */
  onOpenMap: () => void;
  /** §12.1 `SettingsScreen` — its own branch, out of scope here. Optional:
   * the gear renders and is announced either way, but presses no-op until
   * that screen exists. */
  onOpenSettings?: () => void;
  /** §12.3 `ProfileScreen` — same shape as `onOpenSettings`. */
  onOpenProfile?: () => void;
}

export function HomeScreen({
  onPlay,
  onPlayEndless,
  onOpenMap,
  onOpenSettings,
  onOpenProfile,
}: HomeScreenProps): React.JSX.Element {
  const currentLevel = useMetaStore((s) => s.currentLevel);
  const endlessBest = useMetaStore((s) => s.endlessBest);
  const streak = useMetaStore((s) => s.streak);
  const playerName = useMetaStore((s) => s.playerName);
  const avatarId = useMetaStore((s) => s.avatarId);
  // `selectBadges` returns a fresh object every call, and zustand v5's
  // `useSyncExternalStore`-based hook re-renders whenever the selector's
  // RETURN REFERENCE changes — a plain object-returning selector therefore
  // re-renders (and re-invokes itself) on every commit forever. `useShallow`
  // is zustand's own fix: same one-mechanism selector, shallow-compared.
  const badges = useMetaStore(useShallow(selectBadges));

  const dailyBoardFlag = useConfigStore((s) => s.value('flag_daily_board'));
  // §7.6: "Unlocked after Level 10." `currentLevel` is the NEXT level to
  // play (see `home.play` CTA / the FTUE returning-user check above), so
  // "after Level 10" is complete-and-moved-on, i.e. strictly greater than
  // 10 — still locked while `currentLevel === 10` (mid-attempt on it).
  const endlessFlag = useConfigStore((s) => s.value('flag_endless'));
  const unlockLevel = useConfigStore((s) => s.value('endless_unlock_level'));
  const endlessUnlocked = currentLevel > unlockLevel;

  // (f): reserved, empty, Stage-4-flagged — reading a boolean flag is not
  // "Stage-4 STATE" (§0 rule 2a's own worked example is exactly this kind
  // of flag-hidden slot); no event content model is read or rendered.
  const eventsFlag = useConfigStore((s) => s.value('flag_events'));
  // (g) bottom nav gates — see `BottomNav`'s own doc comment for the
  // Team/Shop flag-mapping rationale.
  const manorFlag = useConfigStore((s) => s.value('flag_manor'));
  const economyFlag = useConfigStore((s) => s.value('flag_economy'));

  // §7.11 "tile pulses once on screen entry, max 1 pulse/session" — consumed
  // once per HomeScreen MOUNT (not per render), and only ever `true` the
  // first time in the whole process. `useState`'s lazy initializer runs
  // exactly once per mount, which is what makes "once per entry" (not once
  // ever, not once per render) line up with "at most once per session".
  const [pulseThisEntry] = useState(() => consumeDailyPulse());

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {/* (b) manor exterior — static night manor, Stage 1. Decorative only:
          no art pipeline output exists yet (same note as `LevelMapScreen`'s
          landmark art), so this is token-only "lit windows" dressing, not
          the real per-room reflection §3 adds in Stage 3. */}
      <View
        style={styles.manorBackground}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.manorWindow, styles.manorWindow1]} />
        <View style={[styles.manorWindow, styles.manorWindow2]} />
        <View style={[styles.manorWindow, styles.manorWindow3]} />
      </View>

      <View style={styles.container}>
        <HudBar
          playerName={playerName}
          avatarId={avatarId}
          mapChestReady={badges.mapChestReady}
          onOpenMap={onOpenMap}
          onOpenSettings={onOpenSettings}
          onOpenProfile={onOpenProfile}
        />

        {/* (f) event banner carousel slot — empty in S1/S2, Stage-4-flagged. */}
        {eventsFlag ? <View style={styles.eventBannerSlot} /> : null}

        <View style={styles.tileRow}>
          {/* §7.1.3 / §7.11(c): the tile's data is not this screen's to
              fetch — §8.3 is a different, not-yet-built branch. */}
          {dailyBoardFlag ? (
            <DailyBoardTile
              unplayed={badges.dailyUnplayed}
              streak={streak}
              pulseOnMount={pulseThisEntry}
            />
          ) : null}

          {/* §7.6 / §7.11(e): reused unmodified, flag-gated. */}
          {endlessFlag ? (
            <EndlessCard
              unlocked={endlessUnlocked}
              unlockLevel={unlockLevel}
              currentLevel={currentLevel}
              best={endlessBest}
              onPress={() => onPlayEndless?.()}
            />
          ) : null}
        </View>

        <View style={styles.spacer} />

        {/* (d): the ONE gold button on this screen (mockup panel 2.1's own
            design note). */}
        <GoldButton
          label={t('home.play', { level: currentLevel })}
          onPress={onPlay}
          size="lg"
          style={styles.cta}
        />

        <BottomNav
          manorUnlocked={manorFlag}
          eventsUnlocked={eventsFlag}
          teamUnlocked={eventsFlag}
          shopUnlocked={economyFlag}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.night },
  manorBackground: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  manorWindow: {
    position: 'absolute',
    width: 22,
    height: 30,
    borderRadius: 4,
    backgroundColor: 'rgba(233,196,106,0.12)',
  },
  manorWindow1: { left: '18%', bottom: '30%' },
  manorWindow2: { left: '46%', bottom: '26%' },
  manorWindow3: { left: '72%', bottom: '32%' },
  container: { flex: 1, gap: spacing.md, paddingTop: spacing.sm },
  eventBannerSlot: { height: EVENT_BANNER_SLOT_HEIGHT, marginHorizontal: spacing.md },
  tileRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
  spacer: { flex: 1 },
  cta: { marginHorizontal: spacing.md },
});
