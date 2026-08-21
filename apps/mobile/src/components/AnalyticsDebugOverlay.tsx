import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { analyticsQueue } from '../services/analyticsQueue';
import { DEV_BOARD_ENABLED } from '../game/devFlag';
import { colors, fontSize, radius, spacing } from './tokens';

/**
 * §14 requirement 5: debug view of the on-device analytics queue. Gated by
 * `DEV_BOARD_ENABLED` — the existing build-time flag (`apps/mobile/src/game/
 * devFlag.ts`), NOT `__DEV__`, so it's reachable in a `preview` profile APK
 * (`__DEV__` is false there) and not a second flag (CLAUDE.md rule 3 spirit:
 * one flag, one meaning). Renders nothing when the flag is off — mount it
 * unconditionally from `App.tsx`, same as the `DEV: Board` button.
 *
 * Audit MINOR fix: poll only while expanded — collapsed, it does nothing on
 * a timer, so it doesn't perturb the §4.5 perf measurement `DEV_BOARD_ENABLED`
 * also gates.
 */
const POLL_MS = 500; // 2Hz, only while `open`

interface Snapshot {
  queued: number;
  pendingDroppedCount: number;
}

export function AnalyticsDebugOverlay(): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => analyticsQueue.getSnapshot());

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setSnapshot(analyticsQueue.getSnapshot()), POLL_MS);
    return () => clearInterval(id);
  }, [open]);

  if (!DEV_BOARD_ENABLED) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Pressable
        style={styles.toggle}
        accessibilityRole="button"
        accessibilityLabel="Toggle analytics debug overlay"
        onPress={() => {
          setSnapshot(analyticsQueue.getSnapshot());
          setOpen((v) => !v);
        }}
      >
        <Text style={styles.toggleText}>ANALYTICS {open ? '▲' : '▼'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.panel}>
          <Text style={styles.row}>queued: {snapshot.queued}</Text>
          <Text style={styles.row}>dropped (pending): {snapshot.pendingDroppedCount}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 40,
    left: 16,
  },
  toggle: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.night2,
    borderRadius: radius.card,
  },
  toggleText: {
    color: colors.cream,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  panel: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.night,
    borderRadius: radius.card,
    minWidth: 160,
  },
  row: {
    color: colors.muted,
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
});
