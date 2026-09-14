/**
 * Daily Board flow — PRD §8.3: gate → play-start → PLAY (reuses
 * `GameplayScreen`, §16.1 "no second board screen") → run ends → submit →
 * `DailyResultScreen` → "Continue to levels".
 *
 * Owns only the flow. Every server rule lives behind `services/dailyClient`
 * (board read before play-start, rejection routing, the persisted log), and
 * every §8.5/§8.6 number shown comes back from the server.
 *
 * "Abandoning mid-run (app kill) = attempt consumed; move log up to that point
 * is submitted on next open": each placement is persisted as it happens, and
 * this screen submits any leftover run as soon as it opens. Quitting from the
 * pause sheet ends the run the same way — there is no restart (one attempt).
 */

import { createGame, type GameEvent, type GameState } from '@blockmanor/engine';
import { dailyPlaySeed } from '@blockmanor/shared';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { RetryToast } from '../components/RetryToast';
import { t } from '../i18n';
import { track } from '../services/analytics';
import {
  readLastResult,
  readPendingRun,
  readPlayedDates,
  recordDailyMove,
  resolvePendingAttempt,
  startDailyRun,
  submitPendingRun,
  type DailySubmitOutcome,
} from '../services/dailyClient';
import { useMetaStore } from '../state/useMetaStore';
import { DailyGateScreen, type DailyGateStatus } from '../screens/DailyGateScreen';
import { DailyResultScreen } from '../screens/DailyResultScreen';
import { GameplayScreen, type PauseControls } from '../screens/GameplayScreen';
import { StreakScreen } from '../screens/StreakScreen';
import { DailyHud } from './DailyHud';
import { StreakMilestoneSheet } from './StreakMilestoneSheet';
import { streakEvents } from './streak';

/** The countdown only shows minutes, so a 30s tick is always current. */
const CLOCK_TICK_MS = 30_000;

export const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

type Phase =
  | { kind: 'gate'; status: DailyGateStatus }
  | { kind: 'playing'; state: GameState }
  | { kind: 'result'; score: number; percentile: number | null; streak: number }
  | { kind: 'streak'; playedDates: ReadonlySet<string> | null };

export interface DailySessionProps {
  onExit: () => void;
  onLevels: () => void;
  onOpenSettings?: () => void;
  /** Injected clock for tests. */
  now?: () => number;
}

function NOOP(): void {}

export function DailySession({
  onExit,
  onLevels,
  onOpenSettings,
  now = Date.now,
}: DailySessionProps): React.JSX.Element {
  const [clock, setClock] = useState(now);
  const date = utcDate(clock);
  const streak = useMetaStore((s) => s.streak);
  const [toast, setToast] = useState(false);
  const longest = useMetaStore((s) => s.longestStreak);
  // §8.6: set when the server credits day 7/30/100; cleared by its sheet.
  const [milestone, setMilestone] = useState<number | null>(null);
  const endedRef = useRef(false);

  const playedToday = (): boolean => readLastResult()?.date === utcDate(now());
  const [phase, setPhase] = useState<Phase>(() => ({
    kind: 'gate',
    status: readPendingRun()
      ? { kind: 'busy', message: 'submittingPending' }
      : playedToday()
        ? { kind: 'played' }
        : { kind: 'ready' },
  }));

  /** Applies a submission outcome: meta on acceptance, then where to land. */
  const settle = useCallback(
    (outcome: DailySubmitOutcome, showResult: boolean) => {
      if (outcome.kind === 'accepted') {
        const { result } = outcome;
        const meta = useMetaStore.getState();
        for (const event of streakEvents(meta.streak, result)) {
          track(event.name, { n: event.n });
          if (event.name === 'streak_milestone' && showResult) setMilestone(event.n);
        }
        meta.setStreak(result.streak);
        meta.setBadge('dailyUnplayed', false);
        if (result.percentile !== null) meta.recordDailyPercentile(result.percentile);
        if (showResult) {
          setPhase({
            kind: 'result',
            score: result.score,
            percentile: result.percentile,
            streak: result.streak,
          });
          return;
        }
      }
      if (outcome.kind === 'offline') setToast(true);
      const played = outcome.kind === 'rejected' && outcome.reason === 'already-submitted';
      setPhase({
        kind: 'gate',
        status:
          played || readLastResult()?.date === utcDate(now())
            ? { kind: 'played' }
            : { kind: 'ready' },
      });
    },
    [now],
  );

  useEffect(() => {
    track('daily_view', {});
    const pending = readPendingRun();
    if (pending) {
      // A run for TODAY that was killed mid-play shows its result; an older one
      // only clears the way (§0 v1.26(a)).
      void submitPendingRun().then((o) => settle(o, pending.date === utcDate(now())));
    }
    const id = setInterval(() => setClock(now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const play = useCallback(async () => {
    setToast(false);
    setPhase({ kind: 'gate', status: { kind: 'busy', message: null } });
    let outcome = await startDailyRun(date);
    if (outcome.kind === 'refused' && outcome.reason === 'pending-attempt') {
      // §0 v1.26(a): clear the older day first — its stored log if we have it,
      // the empty log otherwise (`resolvePendingAttempt`).
      settle(
        outcome.pendingDate
          ? await resolvePendingAttempt(outcome.pendingDate)
          : await submitPendingRun(),
        false,
      );
      outcome = await startDailyRun(date);
    }
    if (outcome.kind === 'ready') {
      endedRef.current = false;
      setPhase({ kind: 'playing', state: createGame(outcome.config, dailyPlaySeed(date)) });
      return;
    }
    if (outcome.kind === 'offline') {
      setToast(true);
      setPhase({ kind: 'gate', status: { kind: 'ready' } });
      return;
    }
    setPhase({
      kind: 'gate',
      status:
        outcome.reason === 'attempt-consumed' || outcome.reason === 'pending-attempt'
          ? { kind: 'played' }
          : { kind: 'unavailable', reason: outcome.reason },
    });
  }, [date, settle]);

  const openStreak = useCallback(() => {
    setPhase({ kind: 'streak', playedDates: null });
    void readPlayedDates(utcDate(now()).slice(0, 7)).then((playedDates) =>
      setPhase((p) => (p.kind === 'streak' ? { kind: 'streak', playedDates } : p)),
    );
  }, [now]);

  const backToGate = useCallback(() => {
    setPhase({
      kind: 'gate',
      status: readLastResult()?.date === utcDate(now()) ? { kind: 'played' } : { kind: 'ready' },
    });
  }, [now]);

  const finish = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    settle(await submitPendingRun(), true);
  }, [settle]);

  const handleEvent = useCallback(
    (events: readonly GameEvent[], state: GameState) => {
      for (const e of events) {
        if (e.type === 'PIECE_PLACED')
          recordDailyMove({ pieceIndex: e.pieceIndex, r: e.r, c: e.c });
      }
      if (state.status !== 'playing') void finish();
    },
    [finish],
  );

  const pauseControls = useMemo<PauseControls>(
    () => ({
      onQuit: () => void finish(),
      onOpenSettings: onOpenSettings ?? NOOP,
      confirmQuit: 'daily',
    }),
    [finish, onOpenSettings],
  );

  const renderHud = useCallback(
    (state: GameState, openPause: () => void) => (
      <DailyHud score={state.score} onOpenPause={openPause} />
    ),
    [],
  );

  return (
    <View style={styles.fill}>
      {phase.kind === 'playing' ? (
        <GameplayScreen
          initialState={phase.state}
          header={renderHud}
          onEvent={handleEvent}
          pause={pauseControls}
        />
      ) : phase.kind === 'result' ? (
        <>
          <DailyResultScreen
            score={phase.score}
            percentile={phase.percentile}
            streak={phase.streak}
            onContinue={onLevels}
          />
          {milestone !== null ? (
            <StreakMilestoneSheet streak={milestone} onContinue={() => setMilestone(null)} />
          ) : null}
        </>
      ) : phase.kind === 'streak' ? (
        <StreakScreen
          streak={streak}
          longest={longest}
          month={date.slice(0, 7)}
          playedDates={phase.playedDates}
          onPlay={backToGate}
          onBack={backToGate}
        />
      ) : (
        <DailyGateScreen
          date={date}
          now={clock}
          streak={streak}
          yesterdayPercentile={readLastResult()?.percentile ?? null}
          status={phase.status}
          onPlay={() => void play()}
          onBack={onExit}
          onOpenStreak={openStreak}
        />
      )}
      {toast ? (
        <RetryToast
          message={t('daily.error.offline')}
          onDismiss={() => setToast(false)}
          onRetry={() => void play()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
