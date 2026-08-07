/**
 * Dev-only RENDER-time readout — PRD §4.5 profiling aid.
 *
 * Named precisely: this measures React render→commit wall-clock time, NOT
 * GPU frame time, so it must never be reported as §4.5 "60fps" evidence on
 * its own. §4.5's 60fps *board interaction* budget covers drag/juice frame
 * pacing (§7.3/§7.4), which doesn't exist yet — that budget cannot be signed
 * off from this component at all, on-device or not, until those land.
 *
 * No device access exists in this environment, so no on-device number can be
 * measured or reported here (see the delivery report). This overlay is the
 * instrumentation the OPERATOR reads on a real Redmi-class Android: it times
 * how long each state-driven re-render of the board+tray takes to build and
 * commit, keeps a rolling window, and shows last/avg on-screen. DEV_BOARD_ENABLED-gated
 * and a no-op in production (no timer, no extra state, no render).
 */

import { DEV_BOARD_ENABLED } from './devFlag';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, spacing } from '../components/tokens';
import { DEV_FRAME_STATS_SAMPLE_WINDOW } from './boardTokens';

interface Stats {
  lastMs: number;
  avgMs: number;
  samples: number;
}

/** Measures wall-clock time from "this render started" to "it committed",
 * re-armed every time `dep` changes reference (i.e. every new GameState). */
function useDevRenderTimeStats(dep: unknown): Stats {
  const startedAt = useRef(0);
  const history = useRef<number[]>([]);
  const [stats, setStats] = useState<Stats>({ lastMs: 0, avgMs: 0, samples: 0 });

  if (DEV_BOARD_ENABLED) startedAt.current = performance.now();

  useLayoutEffect(() => {
    if (!DEV_BOARD_ENABLED) return;
    const ms = performance.now() - startedAt.current;
    const list = history.current;
    list.push(ms);
    if (list.length > DEV_FRAME_STATS_SAMPLE_WINDOW) list.shift();
    setStats({
      lastMs: ms,
      avgMs: list.reduce((a, b) => a + b, 0) / list.length,
      samples: list.length,
    });
    // Deliberately keyed on `dep` alone (not `history`/`startedAt` refs) — this
    // effect re-arms once per new GameState, not once per re-render.
  }, [dep]);

  return stats;
}

export function DevRenderTimeStats({ dep }: { dep: unknown }): React.JSX.Element | null {
  const stats = useDevRenderTimeStats(dep);
  if (!DEV_BOARD_ENABLED) return null;
  return (
    <View style={styles.box} pointerEvents="none">
      <Text style={styles.text}>
        render {stats.lastMs.toFixed(1)}ms · avg{stats.samples} {stats.avgMs.toFixed(1)}ms
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  text: { color: colors.ok, fontSize: fontSize.xs },
});
