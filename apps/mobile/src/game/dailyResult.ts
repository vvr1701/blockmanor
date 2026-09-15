import type { SubmitResult } from '@blockmanor/shared';
import { track } from '../services/analytics';
import { onReconnect } from '../services/connectivity';
import { readPendingRun, submitPendingRun } from '../services/dailyClient';
import { useMetaStore } from '../state/useMetaStore';
import { streakEvents } from './streak';

/**
 * Folds an accepted §8.5 result into this device's meta, however it arrived —
 * the Daily screen, or a queued submission flushed on reconnect (§12.4).
 * Returns the milestone just reached (7/30/100), if any, for the celebration.
 */
let lastAppliedDate: string | null = null;

export function applyAcceptedDaily(result: SubmitResult): number | null {
  // Once per board: two callers sharing one submission must not double-count.
  if (lastAppliedDate === result.date) return null;
  lastAppliedDate = result.date;
  const meta = useMetaStore.getState();
  let milestone: number | null = null;
  for (const event of streakEvents(meta.streak, result)) {
    track(event.name, { n: event.n });
    if (event.name === 'streak_milestone') milestone = event.n;
  }
  meta.setStreak(result.streak);
  meta.setBadge('dailyUnplayed', false);
  if (result.percentile !== null) meta.recordDailyPercentile(result.percentile);
  return milestone;
}

/** Test-only: the once-per-date guard is module state. */
export function resetAppliedDaily(): void {
  lastAppliedDate = null;
}

/**
 * §12.4 "queued daily submission flush on reconnect": a run that ended offline
 * is sent as soon as the network is back, not only when the Daily screen opens.
 */
export function watchDailyReconnectFlush(): () => void {
  return onReconnect(() => {
    if (!readPendingRun()) return;
    void submitPendingRun().then((outcome) => {
      if (outcome.kind === 'accepted') applyAcceptedDaily(outcome.result);
    });
  });
}
