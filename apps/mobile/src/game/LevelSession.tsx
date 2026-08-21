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
import { getLevel, parseLevel, type LevelJson } from '@blockmanor/content';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deriveGoalBar, type GoalBarEntry } from './goalBar';
import { useEngineTuning } from './useEngineTuning';
import { GameplayScreen } from '../screens/GameplayScreen';
import { WinScreen } from '../screens/WinScreen';
import { FailScreen } from '../screens/FailScreen';
import { track } from '../services/analytics';
import { useMetaStore } from '../state/useMetaStore';

/** `attempt` tags the engine seed too (not just analytics) — a Stage-1 free
 * Retry (§7.5) should deal a fresh tray, not silently replay the exact same
 * loss (the level's `seedSalt` still pins its identity; only the run varies). */
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

  useEffect(() => {
    startedAtRef.current = Date.now();
    setPhase('playing');
    setResult(null);
    if (json) track('level_start', { id: json.id, attempt });
  }, [json, attempt]);

  // Past the shipped range (or a corrupt save) — nothing honest to play;
  // exit rather than render a dead end (§12.9).
  useEffect(() => {
    if (!json) onExit();
  }, [json, onExit]);

  const handleEvent = useCallback(
    (events: readonly GameEvent[], state: GameState) => {
      if (!json) return;
      if (state.status === 'won') {
        const won = events.find(
          (e): e is Extract<GameEvent, { type: 'LEVEL_WON' }> => e.type === 'LEVEL_WON',
        );
        const score = won?.score ?? state.score;
        const stars = won?.stars ?? starsFor(state.score, state.config.level?.stars);
        const duration_s = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
        track('level_complete', {
          id: json.id,
          score,
          stars,
          duration_s,
          continues: 0,
          boosters_used: 0,
        });
        setResult({ score, stars, goals: [] });
        setPhase('won');
      } else if (state.status === 'lost') {
        const goals = deriveGoalBar(state);
        const totalGoal = goals.reduce((sum, g) => sum + g.total, 0);
        const doneGoal = goals.reduce((sum, g) => sum + (g.total - g.remaining), 0);
        const goal_progress_pct = totalGoal > 0 ? Math.round((100 * doneGoal) / totalGoal) : 0;
        track('level_fail', { id: json.id, goal_progress_pct, fill_ratio: fillRatio(state.board) });
        setResult({ score: state.score, stars: 0, goals });
        setPhase('lost');
      }
    },
    [json],
  );

  const handleNext = useCallback(() => {
    setCurrentLevel(currentLevel + 1);
    setAttempt(1);
  }, [currentLevel, setCurrentLevel]);

  const handleRetry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  if (!json || !initialState) return null;

  if (phase === 'won' && result) {
    return <WinScreen score={result.score} stars={result.stars} onNext={handleNext} />;
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
