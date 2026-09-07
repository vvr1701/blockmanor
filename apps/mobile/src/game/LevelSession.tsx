/**
 * `LevelSession` — PRD §7.5's progression loop: "Play -> L1 -> win -> advance
 * to L2 -> play." Not a §16.1 canonical screen (no PRD subsection names it);
 * it's the coordinator that mounts `GameplayScreen` for the player's current
 * campaign level (`useMetaStore.currentLevel`, `packages/content` `getLevel`)
 * and, off the terminal `GameEvent[]`/`GameState` `GameplayScreen.onEvent`
 * already reports (same boundary `FtueScreen` and `JuiceLayer` keep — never
 * re-deriving win/lose from the rules), swaps in `WinScreen` or `FailScreen`.
 *
 * §7.10's `LevelMapScreen` now exists, so §7.5's "Level map" ghost routes
 * there via the optional `onLevelMap` prop; the "ran past the last shipped
 * level" fallback still calls `onExit` (Home), which is the mount point's
 * own choice.
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
 * Retry (§7.5, normative as of §0 v1.17) deals a FRESH tray rather than
 * silently replaying the exact same loss: the level's own `seedSalt` still
 * pins ITS identity within the seed string below, `attempt` is the part that
 * varies the run. §1 P2 — never punish without an exit. */
function buildLevelGameState(json: LevelJson, tuning: EngineTuning, attempt: number): GameState {
  return createGame(
    {
      mode: 'level',
      tuning,
      level: parseLevel(json),
      ...(json.pieceSequence ? { pieceSequence: json.pieceSequence } : {}),
    },
    levelRunSeed(json.id, attempt),
  );
}

/** The engine run seed for one attempt at one level. `attempt` is deliberately
 * part of it (§0 v1.17 ruling B) — drop it and Retry replays the identical
 * losing draw. The level's identity is pinned separately: `createGame` mixes
 * `level.seedSalt` (§7.7) into the RNG seed. */
export function levelRunSeed(levelId: number, attempt: number): string {
  return `level-${levelId}-a${attempt}`;
}

/** The attempt number the NEXT run of `levelId` gets (§0 v1.17): one past
 * whatever survived in MMKV, or 1 for a level never started on this install.
 *
 * Both guards below exist for a truncated or hand-edited MMKV blob only —
 * zustand runs `migrate` for OLDER versions, never at the current one, so a
 * corrupt `attempts` on a v2 blob reaches this read exactly as written:
 * `null` would throw on mount (a §12.9 dead end), and a string would
 * concatenate (`'x' + 1 === 'x1'`), leaking a non-number into the typed
 * `level_start.attempt` §14 param. This is the single read of `attempts` in
 * the app, so guarding here covers every caller. */
function nextAttempt(levelId: number): number {
  const prev = (useMetaStore.getState().attempts ?? {})[String(levelId)];
  return (typeof prev === 'number' && Number.isFinite(prev) ? prev : 0) + 1;
}

type Phase = 'playing' | 'won' | 'lost';

interface TerminalResult {
  score: number;
  stars: number;
  goals: readonly GoalBarEntry[];
}

export interface LevelSessionProps {
  onExit: () => void;
  /** §7.5's "Level map" ghost, and the destination for a level past the
   * shipped range. Optional so existing mounts keep the pre-§7.10 behaviour
   * (everything routes to `onExit`); `App.tsx` passes the real map. */
  onLevelMap?: () => void;
}

export function LevelSession({ onExit, onLevelMap }: LevelSessionProps): React.JSX.Element | null {
  const currentLevel = useMetaStore((s) => s.currentLevel);
  const setCurrentLevel = useMetaStore((s) => s.setCurrentLevel);
  const tuning = useEngineTuning();

  // §0 v1.17: the attempt counter is PERSISTED per level id, not session
  // state — `level_start{attempt}` is the denominator §7.9's "first attempt"
  // win-rate target and §3's per-level quit rate are read from, so a counter
  // that resets on relaunch emits a false second `attempt: 1`.
  //
  // `attempts` itself is read non-reactively (`nextAttempt` -> `getState()`),
  // only the stable action is subscribed: this component owns the counter for
  // the level it is playing, so subscribing to the value would re-render it
  // solely in response to its own writes — and would turn the
  // write-at-run-start below into a render loop. The write happens in the
  // run-start effect, never during render.
  const persistAttempt = useMetaStore((s) => s.setAttempt);
  // §7.10: the level map's medallions render "1-3 stars", and §7.5's
  // WinScreen computed stars that died with the session. This is the write
  // that gives them something to render. Same non-reactive discipline as
  // `attempts`: only the stable action is subscribed.
  const persistStars = useMetaStore((s) => s.setLevelStars);
  const [attempt, setAttempt] = useState(() => nextAttempt(currentLevel));
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
    if (json) {
      // Advanced at run START, not on fail and not on the Retry tap: an
      // ABANDONED run is exactly the shape of a quit (§3's per-level quit
      // rate) and must count, and the first run after a relaunch is a new
      // run. §0 v1.17.
      persistAttempt(json.id, attempt);
      track('level_start', { id: json.id, attempt });
    }
  }, [json, attempt, clearPhaseTimer, persistAttempt]);

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
        persistStars(json.id, won.stars);
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
        persistStars(json.id, stars);
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
    [json, clearPhaseTimer, persistStars],
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
    // Not `1`: a level reached a second time (today only via a corrected or
    // rolled-back save — §7.10's map specs medallions, chests and
    // scroll-to-current, no replay affordance) resumes its own persisted
    // count rather than faking a first attempt. §0 v1.17 (i).
    setAttempt(nextAttempt(currentLevel + 1));
  }, [currentLevel, setCurrentLevel, onExit]);

  const handleRetry = useCallback(() => {
    // The same persisted read `handleNext` uses, not `a + 1` off session
    // state: those agree today only because the run-start effect always
    // writes before a Retry can be tapped — an invariant a reader would have
    // to reconstruct. One source of truth for "what attempt is next" instead.
    setAttempt(nextAttempt(currentLevel));
  }, [currentLevel]);

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
        onLevelMap={onLevelMap ?? onExit}
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
