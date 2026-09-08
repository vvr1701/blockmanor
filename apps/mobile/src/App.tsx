import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnalyticsDebugOverlay } from './components/AnalyticsDebugOverlay';
import { colors } from './components/tokens';
import { DEV_BOARD_ENABLED, FTUE_FORCE_REPLAY } from './game/devFlag';
import { createDemoGameState } from './game/demoGameState';
import { LevelSession } from './game/LevelSession';
import { getInstalledVersion, isBelowMinVersion } from './services/appInfo';
import { initFirebase, syncRemoteConfig } from './services/firebase';
import { EndlessScreen } from './screens/EndlessScreen';
import { ForceUpdateScreen } from './screens/ForceUpdateScreen';
import { FtueScreen } from './screens/FtueScreen';
import { GameplayScreen } from './screens/GameplayScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LevelMapScreen } from './screens/LevelMapScreen';
import { MaintenanceScreen } from './screens/MaintenanceScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useConfigStore } from './state/useConfigStore';
import { useMetaStore } from './state/useMetaStore';

/**
 * Root component. Navigation arrives in Stage 1 with the second screen —
 * a router for one screen is scaffolding for later (CLAUDE.md rule 1).
 *
 * The DEV_BOARD_ENABLED board toggle below is NOT that router: it's a debug
 * escape hatch (qa-prd-auditor §7.2 follow-up) so the operator can actually
 * reach `GameplayScreen`'s Skia canvas on a physical device to profile it —
 * nothing else has ever rendered it at runtime. Production still boots
 * straight to `HomeScreen`, unchanged, per the Stage-0 DoD.
 *
 * `GestureHandlerRootView` wraps the whole app (react-native-gesture-handler
 * v2 requirement) from §7.3 on, since `GameplayScreen`'s drag now needs it —
 * harmless everywhere else, `HomeScreen` has no gestures yet.
 */
export default function App(): React.JSX.Element {
  // §4.1/§13 cold-start bootstrap: anonymous auth + the Remote Config fetch.
  // In an effect and never awaited, so first paint doesn't wait on the network
  // (§7.11); a no-op when Firebase is absent (§12.4).
  useEffect(() => {
    initFirebase();
  }, []);
  const [devBoard, setDevBoard] = useState(false);
  // §7.5 progression loop: Home's "PLAY — Level N" CTA mounts `LevelSession`
  // (real level, from `useMetaStore.currentLevel`); its own exit paths ("Level
  // map" ghost, ran past the last shipped level) come back to Home.
  const [playing, setPlaying] = useState(false);
  // §7.10: the level map is reached from §7.5's FailScreen "Level map" ghost
  // AND, since §0 v1.18, Home's own HUD map affordance (§7.11(a)) — both
  // routes share this one local-state seam.
  const [mapOpen, setMapOpen] = useState(false);
  // §7.6: Home → Endless entry has nowhere to navigate TO without a router
  // (none exists yet, same gap `devBoard` above already works around) — same
  // local-state seam, not a preview of §7.11's eventual real navigation.
  const [showEndless, setShowEndless] = useState(false);
  // §12.1: Home's HUD gear AND (via `LevelSession`) `PauseSheet`'s settings
  // shortcut both reach the same local-state seam. Rendered as an OVERLAY
  // sibling (like `AnalyticsDebugOverlay`), not a replacement branch of the
  // ternary below — opening it from mid-level must not unmount `LevelSession`
  // and lose the paused run's in-memory board state.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const demoState = useMemo(() => (DEV_BOARD_ENABLED ? createDemoGameState() : null), []);

  // §7.1 v1.11 skip logic: "returning users (existing cloud/local save)
  // bypass all FTUE." `ftueComplete` is the authoritative persisted flag once
  // a build carries it; `currentLevel > 1` additionally covers a save that
  // predates the flag (zustand's default shallow-merge persist leaves a
  // missing key at its initial-state default, so an old save would otherwise
  // read `ftueComplete: false` and wrongly re-show FTUE to a real returner).
  const ftueComplete = useMetaStore((s) => s.ftueComplete);
  const currentLevel = useMetaStore((s) => s.currentLevel);
  const isReturningUser = ftueComplete || currentLevel > 1;
  const showFtue = FTUE_FORCE_REPLAY || !isReturningUser;

  // §12.5 remote kill switch. Read directly off `useConfigStore` (which
  // always holds at least the compiled §13 default, live-fetched values
  // overlaid on top — never a network wait) and off the LOCAL installed
  // version (`app.config.ts`'s baked-in `version`, not itself remote or
  // network-dependent) — "must not depend on anything that could itself be
  // the thing that is broken" (task brief). `useConfigStore` is a Zustand
  // hook, so a live RC push that lands after cold start (§13's 6h TTL, or a
  // manual `syncRemoteConfig()` retry from `MaintenanceScreen`) re-renders
  // this exact check, which is what makes it a genuinely LIVE gate and not
  // a cold-start-only snapshot.
  const minSupportedVersion = useConfigStore((s) => s.value('min_supported_version'));
  const maintenanceMode = useConfigStore((s) => s.value('maintenance_mode'));
  const belowMinVersion = isBelowMinVersion(getInstalledVersion(), minSupportedVersion);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {/* §12.5 gates BEFORE every other branch below — including the dev
            board escape hatch — so a below-minimum or maintenance build can
            never reach FTUE, Home or gameplay by any route this file knows
            about. `ForceUpdateScreen` takes no dismiss callback and nothing
            else is mounted alongside it, so there is no sibling screen for a
            stray callback or a back-press to reveal (see that screen's own
            doc comment). */}
        {belowMinVersion ? (
          <ForceUpdateScreen minSupportedVersion={minSupportedVersion} />
        ) : maintenanceMode ? (
          <MaintenanceScreen onRetry={syncRemoteConfig} />
        ) : (
          <>
            {DEV_BOARD_ENABLED && devBoard && demoState ? (
              <GameplayScreen initialState={demoState} />
            ) : showFtue ? (
              <FtueScreen />
            ) : playing ? (
              <LevelSession
                onExit={() => setPlaying(false)}
                onLevelMap={() => {
                  setPlaying(false);
                  setMapOpen(true);
                }}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            ) : mapOpen ? (
              <LevelMapScreen
                onPlay={() => {
                  setMapOpen(false);
                  setPlaying(true);
                }}
                onExit={() => setMapOpen(false)}
              />
            ) : showEndless ? (
              <EndlessScreen onExit={() => setShowEndless(false)} />
            ) : (
              <>
                <HomeScreen
                  onPlay={() => setPlaying(true)}
                  onPlayEndless={() => setShowEndless(true)}
                  onOpenMap={() => setMapOpen(true)}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
                {DEV_BOARD_ENABLED ? (
                  <Pressable style={styles.devButton} onPress={() => setDevBoard(true)}>
                    <Text style={styles.devButtonText}>DEV: Board</Text>
                  </Pressable>
                ) : null}
              </>
            )}
            {/* §12.1: an overlay, not a route — see `settingsOpen`'s own
                comment above for why. */}
            {settingsOpen ? (
              <View style={styles.settingsOverlay}>
                <SettingsScreen onExit={() => setSettingsOpen(false)} />
              </View>
            ) : null}
          </>
        )}
        <AnalyticsDebugOverlay />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  settingsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  devButton: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  devButtonText: { color: colors.ok, fontSize: 12, fontWeight: '700' },
});
