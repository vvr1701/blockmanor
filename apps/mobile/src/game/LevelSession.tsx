/**
 * `LevelSession` — PRD §7.5's progression loop: "Play -> L1 -> win -> advance
 * to L2 -> play." Not a §16.1 canonical screen (no PRD subsection names it);
 * it's the coordinator that mounts `GameplayScreen` for the player's current
 * campaign level (`useMetaStore.currentLevel`, `packages/content` `getLevel`)
 * and, off the terminal `GameEvent[]`/`GameState` `GameplayScreen.onEvent`
 * already reports (same boundary `FtueScreen` and `JuiceLayer` keep — never
 * re-deriving win/lose from the rules), swaps in `WinScreen` or `FailScreen`.
 *
 * §7.10 `LevelMapScreen` is a later session (task brief) — the "Level map"
 * ghost and the "ran past the last shipped level" fallback both call
 * `onExit`, which the mount point (`App.tsx`) wires to Home. Honest, not a
 * stub: Home is a real, already-built destination.
 */
import {
  createGame,
  fillRatio,
  starsFor,
  type EngineTuning,
  type GameEvent,
  type GameState,
} from '@blockmanor/engine';
import { MAX_LEVEL_ID, getLevel, parseLevel, type LevelJson } from '@blockmanor/content';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deriveGoalBar, goalProgressPct, type GoalBarEntry } from './goalBar';
import { FAIL_HOLD_MS, WIN_HOLD_MS } from './juice';
import { useEngineTuning } from './useEngineTuning';
import { GameplayScreen } from '../screens/GameplayScreen';
import { WinScreen } from '../screens/WinScreen';
import { FailScreen } from '../screens/FailScreen';
import { track } from '../services/analytics';
import { useMetaStore } from '../state/useMetaStore';

/** `attempt` tags the engine seed too (not just analytics) — a Stage-1 free
 * Retry (§7.5) should deal a fresh tray, not silently replay the exact same
 * loss (the level's own `seedSalt` still pins ITS identity within the seed
 * string below — `attempt` is the part that varies the run). */
function buildLevelGameState(json: LevelJson, tuning: EngineTuning, attempt: number): GameState {
  return createGame(
    {
      mode: 'level',
      tuning,
      level: parseLevel(json),
      ...(json.pieceSequence ? { pieceSequence: json.pieceSequence } : {}),
    },
    `level-${json.id}-a${attempt}`,
  );
}

type Phase = 'playing' | 'won' | 'lost';

interface TerminalResult {
  score: number;
  stars: number;
  goals: readonly GoalBarEntry[];
}

export interface LevelSessionProps {
  onExit: () => void;
}

export function LevelSession({ onExit }: LevelSessionProps): React.JSX.Element | null {
  const currentLevel = useMetaStore((s) => s.currentLevel);
  const setCurrentLevel = useMetaStore((s) => s.setCurrentLevel);
  const tuning = useEngineTuning();

  const [attempt, setAttempt] = useState(1);
  const [phase, setPhase] = useState<Phase>('playing');
  const [result, setResult] = useState<TerminalResult | null>(null);

  const json = useMemo(() => getLevel(currentLevel), [currentLevel]);
  const initialState = useMemo(
    () => (json ? buildLevelGameState(json, tuning, attempt) : null),
    [json, tuning, attempt],
  );

  // Wall-clock duration for `level_complete.duration_s` (§14) — app-layer
  // only; packages/engine stays `Date.now`-free (CLAUDE.md hard rule 2).
  const startedAtRef = useRef(Date.now());

  // §7.5 audit M-2: `GameplayScreen`'s own `JuiceLayer` fires the win/fail
  // celebration off the SAME terminal event `handleEvent` below reads, but
  // swapping `phase` unmounts `GameplayScreen` (and `JuiceLayer` with it) on
  // the very next commit — tearing the animation down before it plays. This
  // timer holds the board on-screen for exactly as long as that beat needs
  // (`WIN_HOLD_MS`/`FAIL_HOLD_MS`, §7.4) before the phase actually swaps.
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPhaseTimer = useCallback(() => {
    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearPhaseTimer, [clearPhaseTimer]);

  useEffect(() => {
    startedAtRef.current = Date.now();
    setPhase('playing');
    setResult(null);
    clearPhaseTimer();
    if (json) track('level_start', { id: json.id, attempt });
  }, [json, attempt, clearPhaseTimer]);

  // Past the shipped range (or a corrupt save) — nothing honest to play;
  // exit rather than render a dead end (§12.9).
  useEffect(() => {
    if (!json) onExit();
  }, [json, onExit]);

  const handleEvent = useCallback(
    (events: readonly GameEvent[], state: GameState) => {
      if (!json) return;
      // §8.2/§4.3: `'won'` (a goal reached 0) and `'completed'` (a fixed
      // `pieceSequence` ran dry with the board still alive — goal-less
      // scripted levels only, e.g. a stale save still pointed at FTUE's
      // L1-L3, §7.5 audit B-1) are both terminal outcomes `LevelSession` must
      // resolve to a screen. §8.2's own wording — "outlived the board" — is
      // win-shaped, so `'completed'` routes to `WinScreen` too. Neither is
      // re-derived: both read straight off the engine's own `status` /
      // `GameEvent[]`.
      if (state.status === 'won') {
        const won = events.find(
          (e): e is Extract<GameEvent, { type: 'LEVEL_WON' }> => e.type === 'LEVEL_WON',
        );
        // §4.3: `status === 'won'` and a `LEVEL_WON` event are set together,
        // in the same `applyPlacement` branch, always — never independently.
        // A `??` fallback here would be a second, silently-diverging source
        // of truth for score/stars (§7.5 audit mn-5); fail loud instead, the
        // engine contract is broken if this is ever missing.
        if (!won) {
          throw new Error(
            '[LevelSession] engine status is "won" with no LEVEL_WON event — §4.3 contract violation',
          );
        }
        const duration_s = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
        track('level_complete', {
          id: json.id,
          score: won.score,
          stars: won.stars,
          duration_s,
          continues: 0,
          boosters_used: 0,
        });
        setResult({ score: won.score, stars: won.stars, goals: [] });
        clearPhaseTimer();
        phaseTimerRef.current = setTimeout(() => setPhase('won'), WIN_HOLD_MS);
      } else if (state.status === 'completed') {
        // No `LEVEL_WON` event exists on this path (only `SEQUENCE_EXHAUSTED`,
        // which carries no `stars`) — `starsFor` is the one source for stars
        // here, not a second opinion alongside an event that doesn't exist.
        const stars = starsFor(state.score, state.config.level?.stars);
        const duration_s = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
        track('level_complete', {
          id: json.id,
          score: state.score,
          stars,
          duration_s,
          continues: 0,
          boosters_used: 0,
        });
        setResult({ score: state.score, stars, goals: [] });
        clearPhaseTimer();
        phaseTimerRef.current = setTimeout(() => setPhase('won'), WIN_HOLD_MS);
      } else if (state.status === 'lost') {
        const goals = deriveGoalBar(state);
        track('level_fail', {
          id: json.id,
          goal_progress_pct: goalProgressPct(goals),
          fill_ratio: fillRatio(state.board),
        });
        setResult({ score: state.score, stars: 0, goals });
        clearPhaseTimer();
        phaseTimerRef.current = setTimeout(() => setPhase('lost'), FAIL_HOLD_MS);
      }
    },
    [json, clearPhaseTimer],
  );

  const handleNext = useCallback(() => {
    // §7.5 audit M-1: `MAX_LEVEL_ID` is the last shipped level — advancing
    // past it persists a `currentLevel` `getLevel` can never resolve, which
    // bricks Home's "PLAY — Level N" CTA forever (§12.9 dead end).
    // §7.10's `LevelMapScreen` (the honest "what's next past L60" screen) is
    // a later session; until it exists, the one real action at the content
    // ceiling is the same one every other "nothing honest to play" path in
    // this file already takes — back to the real, already-built Home.
    if (currentLevel >= MAX_LEVEL_ID) {
      onExit();
      return;
    }
    setCurrentLevel(currentLevel + 1);
    setAttempt(1);
  }, [currentLevel, setCurrentLevel, onExit]);

  const handleRetry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  if (!json || !initialState) return null;

  if (phase === 'won' && result) {
    return (
      <WinScreen
        score={result.score}
        stars={result.stars}
        onNext={handleNext}
        isLastLevel={currentLevel >= MAX_LEVEL_ID}
      />
    );
  }
  if (phase === 'lost' && result) {
    return (
      <FailScreen
        levelId={json.id}
        goals={result.goals}
        onRetry={handleRetry}
        onLevelMap={onExit}
      />
    );
  }

  return (
    <GameplayScreen
      key={`${json.id}-${attempt}`}
      initialState={initialState}
      onEvent={handleEvent}
    />
  );
}
