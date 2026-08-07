import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from './components/tokens';
import { DEV_BOARD_ENABLED } from './game/devFlag';
import { createDemoGameState } from './game/demoGameState';
import { GameplayScreen } from './screens/GameplayScreen';
import { HomeScreen } from './screens/HomeScreen';

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
  const [devBoard, setDevBoard] = useState(false);
  const demoState = useMemo(() => (DEV_BOARD_ENABLED ? createDemoGameState() : null), []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {DEV_BOARD_ENABLED && devBoard && demoState ? (
          <GameplayScreen initialState={demoState} />
        ) : (
          <>
            <HomeScreen />
            {DEV_BOARD_ENABLED ? (
              <Pressable style={styles.devButton} onPress={() => setDevBoard(true)}>
                <Text style={styles.devButtonText}>DEV: Board</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
