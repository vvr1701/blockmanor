import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from './components/tokens';
import { createDemoGameState } from './game/demoGameState';
import { GameplayScreen } from './screens/GameplayScreen';
import { HomeScreen } from './screens/HomeScreen';

/**
 * Root component. Navigation arrives in Stage 1 with the second screen —
 * a router for one screen is scaffolding for later (CLAUDE.md rule 1).
 *
 * The `__DEV__`-only board toggle below is NOT that router: it's a debug
 * escape hatch (qa-prd-auditor §7.2 follow-up) so the operator can actually
 * reach `GameplayScreen`'s Skia canvas on a physical device to profile it —
 * nothing else has ever rendered it at runtime. Production still boots
 * straight to `HomeScreen`, unchanged, per the Stage-0 DoD.
 */
export default function App(): React.JSX.Element {
  const [devBoard, setDevBoard] = useState(false);
  const demoState = useMemo(() => (__DEV__ ? createDemoGameState() : null), []);

  return (
    <SafeAreaProvider>
      {__DEV__ && devBoard && demoState ? (
        <GameplayScreen state={demoState} />
      ) : (
        <>
          <HomeScreen />
          {__DEV__ ? (
            <Pressable style={styles.devButton} onPress={() => setDevBoard(true)}>
              <Text style={styles.devButtonText}>DEV: Board</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
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
