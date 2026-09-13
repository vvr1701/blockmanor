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
 *
 * §12.2 convergence (was its own bespoke close button + `BackHandler`; both
 * deleted once `GameplayScreen`'s `pause` prop existed to share): `onRestart`
 * is `playAgain` and `onQuit` goes straight to `onExit`, ignoring the `moves`
 * count `PauseControls.onQuit` hands up — Endless has no `level_quit` event
 * to attach it to (§14 only names `endless_end{score,best}`, fired by
 * `handleEvent` on a natural game-over, not on a mid-run quit). Endless has
 * no goals, so `PauseSheet`'s ">50% done" confirm can never fire here — a
 * mid-run exit always leaves immediately, forfeiting the live score with no
 * confirmation. Whether that deserves its own confirm is a §7.6 amendment,
 * not this refactor's call (`PauseSheet`'s own header flagged this exact
 * question). `onOpenSettings` is optional, same "no-op seam until the caller
 * wires a real destination" shape `HomeScreen`'s `HudBar` already uses —
 * `App.tsx` is out of scope for this change and does not pass one.
 */

import { createGame, type GameConfig, type GameEvent, type GameState } from '@blockmanor/engine';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { track } from '../../services/analytics';
import { useEngineTuning } from '../../game/useEngineTuning';
import { useMetaStore } from '../../state/useMetaStore';
import { GameplayScreen, type PauseControls } from '../GameplayScreen';
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

/** Stable no-op for `pauseControls.onOpenSettings` when no caller supplies
 * one — same "seam, no-op when unset" shape `HomeScreen`'s `HudBar` uses. */
function NOOP(): void {}

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
  /** §12.2's "settings shortcut" -> §12.1's `SettingsScreen`. Optional, same
   * no-op-when-unset seam `HomeScreen`'s `HudBar` already uses — no current
   * caller wires a real destination. */
  onOpenSettings?: () => void;
}

export function EndlessScreen({ onExit, onOpenSettings }: EndlessScreenProps): React.JSX.Element {
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

  // The live score, so a run the player abandons can still be ended with it.
  // A ref, not state: §4.5's one-render-per-placement budget is untouched and
  // `GameplayScreen` still owns the score.
  const scoreRef = useRef(0);

  // §7.6 / §0 v1.25: a run ENDS exactly once — when the board fills, or when
  // the player quits or restarts it. Either way the score folds into the
  // personal best and `endless_end` fires. Before this, quitting a
  // record-setting run discarded the record and the run never reached
  // analytics. Returns the best as it stood before the run, or null if the
  // run had already ended.
  const endRun = useCallback((score: number): number | null => {
    if (endedRef.current) return null;
    endedRef.current = true;
    const prevBest = useMetaStore.getState().endlessBest;
    useMetaStore.getState().setEndlessBest(score);
    track('endless_end', { score, best: Math.max(prevBest, score) });
    return prevBest;
  }, []);

  const handleEvent = useCallback(
    (_events: readonly GameEvent[], state: GameState) => {
      scoreRef.current = state.score;
      if (state.status === 'playing') return;
      const prevBest = endRun(state.score);
      if (prevBest !== null) setResult({ score: state.score, prevBest });
    },
    [endRun],
  );

  const playAgain = useCallback(() => {
    endedRef.current = false;
    scoreRef.current = 0;
    setResult(null);
    setRun({ seed: newRunSeed(), best: useMetaStore.getState().endlessBest });
  }, []);

  // §12.2 convergence: `GameplayScreen` owns the single `BackHandler`
  // subscription for any caller passing `pause` (§12.9 "invitations, never
  // dead ends" — Android's hardware back opens the pause sheet rather than
  // popping an empty navigation stack and killing the app mid-run). Restart
  // deals a fresh run; quit skips `PauseSheet`'s confirm (Endless has no
  // goals, so it can never pass the >50% gate) and leaves straight to Home —
  // safe without a confirm, because leaving ENDS the run and keeps its score.
  const pauseControls = useMemo<PauseControls>(
    () => ({
      // Abandoning a live run still ends it (§0 v1.25). `endRun` is a no-op if
      // the board had already filled.
      onRestart: () => {
        endRun(scoreRef.current);
        playAgain();
      },
      onQuit: () => {
        endRun(scoreRef.current);
        onExit();
      },
      onOpenSettings: onOpenSettings ?? NOOP,
    }),
    [playAgain, onExit, onOpenSettings, endRun],
  );

  // Rendered by `GameplayScreen` inside its own render pass (see its `header`
  // prop) — that is what keeps the live score off this component's state and
  // out of §4.5's one-render-per-placement budget. `openPause` is
  // `GameplayScreen`'s own, already gated on `canPause` by that screen — this
  // header replaces the default HUD row (with its own pause glyph) entirely,
  // so it is the only way back to the sheet.
  const renderHud = useCallback(
    (state: GameState, openPause: () => void) => (
      <EndlessHud score={state.score} best={run.best} onOpenPause={openPause} />
    ),
    [run.best],
  );

  return (
    <View style={styles.fill}>
      <GameplayScreen
        key={run.seed}
        initialState={initialState}
        header={renderHud}
        onEvent={handleEvent}
        pause={pauseControls}
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
