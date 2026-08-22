/**
 * `EndlessScreen` — PRD §7.6 / §16.1. "Pure Block Blast mode: no goals,
 * mercy RNG on, personal best tracked."
 *
 * Engine config is the whole of §7.6's contract: `mode: 'endless'`, no
 * `level` (so `createGame` seeds `goals: []` — §7.2's goal bar renders
 * nothing, matching "no goals") and no `pieceSequence` (so mercy §6.4 and
 * the tray redraw guarantee §6.3 are both live, matching "mercy RNG on").
 * Nothing here re-implements or overrides an engine rule.
 *
 * Coordinator overlap (flagged per this PR's brief): this screen owns its
 * own tiny "watch `GameplayScreen.onEvent`, react to the terminal status"
 * loop, the same shape `FtueScreen`'s step machine already uses. `FtueScreen`
 * advances through five scripted levels; this only ever has ONE run and a
 * restart button, so a shared coordinator would be more machinery than
 * either caller needs today. A later pass that also lands §7.5's
 * `LevelSession` (win/fail) is the natural point to converge all three call
 * sites onto one "own a GameState, forward events, expose an ended result"
 * hook — deliberately not done here to avoid guessing that unmerged
 * branch's shape.
 */

import { createGame, type GameConfig, type GameEvent, type GameState } from '@blockmanor/engine';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, radius, spacing } from '../../components/tokens';
import { t } from '../../i18n';
import { track } from '../../services/analytics';
import { useEngineTuning } from '../../state/useEngineTuning';
import { useMetaStore } from '../../state/useMetaStore';
import { GameplayScreen } from '../GameplayScreen';

/** §15 a11y: every interactive element ≥44dp regardless of visual size. */
const MIN_TOUCH = 44;

/** Client-only seed — Endless has no server re-simulation (§13 scope note),
 * so unlike a level/daily seed this never needs to be reproducible. Fresh
 * per run so "Play again" doesn't replay the same board. `packages/engine`
 * itself never calls `Math.random` (CLAUDE.md rule 2); this is the app layer
 * choosing entropy for a config it hands the pure engine, same boundary
 * `createRng` documents. */
function newRunSeed(): string {
  return `endless-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface EndlessResult {
  score: number;
  /** Personal best AFTER this run — matches `endless_end`'s `best` param and
   * what `useMetaStore.endlessBest` now holds. */
  best: number;
  isNewBest: boolean;
}

export interface EndlessScreenProps {
  /** No router exists yet (App.tsx reaches this screen the same local-state
   * way it already reaches the dev board) — this is that seam back to Home,
   * not a §7.11 navigation concept. */
  onExit: () => void;
}

export function EndlessScreen({ onExit }: EndlessScreenProps): React.JSX.Element {
  const tuning = useEngineTuning();
  const [seed, setSeed] = useState(newRunSeed);
  const config: GameConfig = useMemo(() => ({ mode: 'endless', tuning }), [tuning]);
  const initialState = useMemo(() => createGame(config, seed), [config, seed]);

  const [result, setResult] = useState<EndlessResult | null>(null);
  // `onEvent` can in principle fire again for the same terminal state (a
  // GameplayScreen re-render with unchanged `state` does not re-notify per
  // its own ref-identity guard, but this is the belt to that belt-and-braces
  // suspenders) — guards `endless_end`/`setEndlessBest` to exactly once/run.
  const endedRef = useRef(false);

  const handleEvent = useCallback((_events: readonly GameEvent[], state: GameState) => {
    if (state.status === 'playing' || endedRef.current) return;
    endedRef.current = true;
    const prevBest = useMetaStore.getState().endlessBest;
    const best = Math.max(prevBest, state.score);
    useMetaStore.getState().setEndlessBest(state.score);
    track('endless_end', { score: state.score, best });
    setResult({ score: state.score, best, isNewBest: state.score > prevBest });
  }, []);

  const playAgain = useCallback(() => {
    endedRef.current = false;
    setResult(null);
    setSeed(newRunSeed());
  }, []);

  return (
    <View style={styles.fill}>
      <GameplayScreen key={seed} initialState={initialState} onEvent={handleEvent} />
      {result ? (
        <View style={styles.overlay} accessible accessibilityViewIsModal>
          <View style={styles.card}>
            <Text style={styles.scoreLabel}>{t('endless.result.scoreLabel')}</Text>
            <Text style={styles.score}>{result.score}</Text>
            <Text style={styles.bestLine}>
              {result.isNewBest
                ? t('endless.result.newBest')
                : t('endless.result.best', { best: result.best })}
            </Text>
            <Pressable
              style={styles.cta}
              onPress={playAgain}
              accessibilityRole="button"
              accessibilityLabel={t('endless.result.playAgain')}
            >
              <Text style={styles.ctaText}>{t('endless.result.playAgain')}</Text>
            </Pressable>
            <Pressable
              style={styles.ghost}
              onPress={onExit}
              accessibilityRole="button"
              accessibilityLabel={t('endless.result.home')}
            >
              <Text style={styles.ghostText}>{t('endless.result.home')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,11,24,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius.sheet,
    padding: spacing.lg,
    backgroundColor: colors.night2,
    borderWidth: 1,
    borderColor: 'rgba(233,196,106,0.35)',
    alignItems: 'center',
  },
  scoreLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  score: {
    marginTop: spacing.xs,
    fontFamily: fontFamily.body,
    fontWeight: '900',
    fontSize: fontSize.xxl,
    color: colors.cream,
    fontVariant: ['tabular-nums'],
  },
  bestLine: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.gold,
    fontVariant: ['tabular-nums'],
  },
  cta: {
    marginTop: spacing.lg,
    width: '100%',
    minHeight: MIN_TOUCH,
    borderRadius: radius.card,
    backgroundColor: colors.gold,
    borderBottomWidth: 3,
    borderBottomColor: colors.goldDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: colors.night, fontSize: fontSize.md, fontWeight: '800' },
  ghost: {
    marginTop: spacing.sm,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
