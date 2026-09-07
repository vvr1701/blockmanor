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
 * Mockups (`docs/design/spec/Block Manor Production Spec.dc.html`): panel
 * 10.2 is the in-run composition (`EndlessHud`, passed to `GameplayScreen`'s
 * `header` slot in place of the standard HUD row), panels 10.3a/10.3b are the
 * game-over sheet (`EndlessResultSheet`).
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { track } from '../../services/analytics';
import { useEngineTuning } from '../../game/useEngineTuning';
import { useMetaStore } from '../../state/useMetaStore';
import { GameplayScreen } from '../GameplayScreen';
import { EndlessHud } from './EndlessHud';
import { EndlessResultSheet } from './EndlessResultSheet';

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
  /** Personal best BEFORE this run — what 10.3a's delta and 10.3b's
   * progress-toward-best are both measured against. */
  prevBest: number;
}

export interface EndlessScreenProps {
  /** No router exists yet (App.tsx reaches this screen the same local-state
   * way it already reaches the dev board) — this is that seam back to Home,
   * not a §7.11 navigation concept. */
  onExit: () => void;
}

export function EndlessScreen({ onExit }: EndlessScreenProps): React.JSX.Element {
  const tuning = useEngineTuning();
  // One run = one seed + the personal best as it stood when that run STARTED.
  // The best is snapshotted, not subscribed: `handleEvent` raises the stored
  // best the moment the run ends, and the HUD must keep showing the bar the
  // player was actually chasing. Re-snapshotted by `playAgain`.
  const [run, setRun] = useState(() => ({
    seed: newRunSeed(),
    best: useMetaStore.getState().endlessBest,
  }));
  const config: GameConfig = useMemo(() => ({ mode: 'endless', tuning }), [tuning]);
  const initialState = useMemo(() => createGame(config, run.seed), [config, run.seed]);

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
    setResult({ score: state.score, prevBest });
  }, []);

  const playAgain = useCallback(() => {
    endedRef.current = false;
    setResult(null);
    setRun({ seed: newRunSeed(), best: useMetaStore.getState().endlessBest });
  }, []);

  // §12.9 "invitations, never dead ends": Android's hardware back must leave
  // the mode, not the app. Without this the default handler pops an empty
  // navigation stack and Android kills the process mid-run — the same trap
  // the in-run close button (`EndlessHud`) covers for the on-screen path.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onExit();
      return true;
    });
    return () => sub.remove();
  }, [onExit]);

  // Rendered by `GameplayScreen` inside its own render pass (see its `header`
  // prop) — that is what keeps the live score off this component's state and
  // out of §4.5's one-render-per-placement budget.
  const renderHud = useCallback(
    (state: GameState) => <EndlessHud score={state.score} best={run.best} onExit={onExit} />,
    [run.best, onExit],
  );

  return (
    <View style={styles.fill}>
      <GameplayScreen
        key={run.seed}
        initialState={initialState}
        header={renderHud}
        onEvent={handleEvent}
      />
      {result ? (
        <EndlessResultSheet
          score={result.score}
          prevBest={result.prevBest}
          onPlayAgain={playAgain}
          onHome={onExit}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
