/**
 * `MaintenanceScreen` — PRD §12.5 / §16.1: "`maintenance_mode` flag → butler
 * with toolbox screen." Unlike `ForceUpdateScreen`, this one is meant to
 * self-clear: the mockup's own footnote (panel "9.4 Maintenance / update")
 * says "Maintenance is dismissible with a retry" — Retry re-fetches live
 * Remote Config, and if ops has flipped `maintenance_mode` back off, the
 * gate in `App.tsx` reacts to the same `useConfigStore` read and unmounts
 * this screen on its own; there is no local "hide myself" escape hatch here.
 *
 * Mockup: `docs/design/spec/Block Manor Production Spec.dc.html`, panel "9.4
 * Maintenance / update" — cream card, "butler with toolbox" art slot, "Back
 * in a moment" title, reassurance body. The panel's "Back at 11:30 IST" chip
 * is NOT reproduced: it names a wall-clock ETA with no `[RC]` key backing it
 * (§13's App-lifecycle group has no such key), and a hardcoded or invented
 * time would be a lie the operator never actually configured.
 *
 * States (CLAUDE.md screen checklist): loading is `checking` below — the one
 * network call this screen makes (`onRetry`, a re-fetch) disables the button
 * and swaps its label rather than leaving it double-tappable. No empty
 * state: the screen always has its one fact (maintenance is on) and its one
 * action. No distinct error state: `onRetry`'s promise settling with
 * maintenance still on IS the error state, and it reads identically to "just
 * try again" — the same screen, the same one action, never a dead end. No
 * distinct offline state for the same reason `ForceUpdateScreen` has none:
 * `syncRemoteConfig` already degrades to a silent no-op offline (§12.4), so
 * a retry with no connectivity just leaves this screen exactly as it was,
 * with Retry still there to press again.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GoldButton } from '../../components/GoldButton';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';

export interface MaintenanceScreenProps {
  /** Re-fetches live Remote Config (`syncRemoteConfig`, §services/firebase).
   * Not called directly from here so this component stays a pure render +
   * callback, matching every other screen's shape (`FailScreen.onRetry`,
   * `PauseSheet.onResume`, ...) rather than reaching into a service itself. */
  onRetry: () => Promise<void>;
}

export function MaintenanceScreen({ onRetry }: MaintenanceScreenProps): React.JSX.Element {
  const [checking, setChecking] = useState(false);

  const handleRetry = useCallback(() => {
    setChecking(true);
    void onRetry().finally(() => setChecking(false));
  }, [onRetry]);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('maintenance.title')}</Text>
        <Text style={styles.body}>{t('maintenance.body')}</Text>
        <GoldButton
          label={checking ? t('maintenance.checking') : t('maintenance.retry')}
          onPress={handleRetry}
          disabled={checking}
          size="lg"
          style={styles.cta}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    backgroundColor: colors.cream,
    borderRadius: radius.sheet,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    color: colors.night,
    fontFamily: fontFamily.display,
    fontWeight: '700',
    fontSize: fontSize.xl,
    textAlign: 'center',
  },
  body: {
    color: 'rgba(19,24,48,0.7)', // colors.night @ 70% — 5.98:1 on cream, the repo's on-light ink
    fontSize: fontSize.sm,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  cta: { width: '100%', marginTop: spacing.md },
});
