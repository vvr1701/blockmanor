import { beforeEach, describe, expect, it } from 'vitest';
import { REMOTE_CONFIG_DEFAULTS, REMOTE_CONFIG_TTL_MS } from '@blockmanor/shared';
import { AnalyticsQueue, defaultSender } from '../src/services/analyticsQueue';
import { installId, sessionId } from '../src/services/analyticsIdentity';
import {
  initFirebase,
  isFirebaseConfigured,
  recordError,
  syncRemoteConfig,
} from '../src/services/firebase';
import { useConfigStore } from '../src/state/useConfigStore';
import { firebaseMock, resetFirebaseMock } from './mocks/react-native-firebase';

/**
 * WP-1: `@react-native-firebase/*` transport, Remote Config sync, anonymous
 * auth and the Crashlytics seam. There is no device in this loop — the native
 * modules are the vitest-aliased stand-in in `test/mocks/react-native-firebase.ts`.
 */

let mmkvCounter = 0;
function freshMmkvId(): string {
  mmkvCounter += 1;
  return `firebase-test-${mmkvCounter}`;
}

function drained(queue: AnalyticsQueue, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (queue.getSnapshot().queued === 0) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('queue never drained'));
      setTimeout(check, 5);
    };
    check();
  });
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetFirebaseMock();
  useConfigStore.setState({ snapshot: { ...REMOTE_CONFIG_DEFAULTS }, fetchedAt: null });
});

describe('§14 analytics transport', () => {
  it('a track() call reaches Firebase with installId, sessionId and the idempotency id intact', async () => {
    firebaseMock.configured = true;
    const queue = new AnalyticsQueue({
      sender: defaultSender,
      getCap: () => 500,
      mmkvId: freshMmkvId(),
    });
    queue.track('ftue_step', { step: 2 });
    await drained(queue);

    expect(firebaseMock.logged).toHaveLength(1);
    const sent = firebaseMock.logged[0];
    expect(sent?.name).toBe('ftue_step');
    expect(sent?.params['step']).toBe(2);
    expect(sent?.params['installId']).toBe(installId);
    expect(sent?.params['sessionId']).toBe(sessionId);
    expect(typeof sent?.params['id']).toBe('string');
    expect(sent?.params['id']).toBeTruthy();
  });

  it('rejects (leaving events queued) when no native Firebase app exists — §12.4', async () => {
    firebaseMock.configured = false;
    const queue = new AnalyticsQueue({
      sender: defaultSender,
      getCap: () => 500,
      mmkvId: freshMmkvId(),
    });
    expect(() => queue.track('ftue_complete', {})).not.toThrow();
    await queue.flush();
    expect(firebaseMock.logged).toHaveLength(0);
    expect(queue.getSnapshot().queued).toBe(1);
  });
});

describe('§13 Remote Config', () => {
  it('a fetched value overrides its compiled default at a real call site', async () => {
    firebaseMock.configured = true;
    firebaseMock.remote = { analytics_queue_cap: { value: '3' } };
    await syncRemoteConfig();

    expect(useConfigStore.getState().value('analytics_queue_cap')).toBe(3);
    expect(useConfigStore.getState().fetchedAt).not.toBeNull();

    // The real call site: the queue reads its cap through the store (never the
    // literal 500), so the fetched 3 must actually bind eviction.
    const queue = new AnalyticsQueue({
      sender: () => new Promise<void>(() => undefined), // never resolves
      getCap: () => useConfigStore.getState().value('analytics_queue_cap'),
      mmkvId: freshMmkvId(),
    });
    for (let i = 0; i < 5; i += 1) queue.track(`e${i}`, {});
    expect(queue.getSnapshot().queued).toBe(3);
    expect(queue.getSnapshot().pendingDroppedCount).toBe(2);
  });

  it('fetches with the §13 6h TTL, read from the shared constant', async () => {
    firebaseMock.configured = true;
    await syncRemoteConfig();
    expect(firebaseMock.fetchCalls).toBe(1);
    expect(firebaseMock.settings.minimumFetchIntervalMillis).toBe(REMOTE_CONFIG_TTL_MS);
    expect(REMOTE_CONFIG_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('coerces by registry type; malformed, unfetched and unknown keys never poison the snapshot', async () => {
    firebaseMock.configured = true;
    firebaseMock.remote = {
      daily_piece_count: { value: '72' },
      flag_endless: { value: 'false' },
      winstreak_thresholds: { value: '2:1,4:3' },
      mercy_threshold: { value: 'not-a-number' },
      combo_step: { value: '   ' },
      streak_repair_price: { value: '99', source: 'static' },
      not_a_registry_key: { value: '1' },
    };
    await syncRemoteConfig();

    const snapshot = useConfigStore.getState().snapshot;
    expect(snapshot.daily_piece_count).toBe(72);
    expect(snapshot.flag_endless).toBe(false);
    expect(snapshot.winstreak_thresholds).toBe('2:1,4:3');
    // malformed number → compiled default stands, NOT 0
    expect(snapshot.mercy_threshold).toBe(REMOTE_CONFIG_DEFAULTS.mercy_threshold);
    expect(snapshot.combo_step).toBe(REMOTE_CONFIG_DEFAULTS.combo_step);
    // never fetched (source `static`) → compiled default stands
    expect(snapshot.streak_repair_price).toBe(REMOTE_CONFIG_DEFAULTS.streak_repair_price);
    // registry completeness: exactly the §13 keys, no server-invented ones
    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(REMOTE_CONFIG_DEFAULTS).sort());
  });

  it('applySnapshot accepts a non-default value (RemoteConfigSnapshot widening)', () => {
    useConfigStore
      .getState()
      .applySnapshot({ mercy_threshold: 0.91, flag_endless: false, latest_version: '9.9.9' }, 123);
    expect(useConfigStore.getState().value('mercy_threshold')).toBe(0.91);
    expect(useConfigStore.getState().fetchedAt).toBe(123);
  });
});

describe('§4.1 cold-start bootstrap', () => {
  it('signs in anonymously once, and never again once a session survives relaunch', async () => {
    firebaseMock.configured = true;
    initFirebase();
    await tick();
    expect(firebaseMock.signInCalls).toBe(1);

    // Simulated relaunch: native auth persisted `currentUser`, counters reset.
    firebaseMock.signInCalls = 0;
    initFirebase();
    await tick();
    expect(firebaseMock.signInCalls).toBe(0);
    expect(firebaseMock.currentUser?.uid).toBe('anon-uid');
  });

  it('reports to Crashlytics through the §12.8 seam, wrapping non-Errors', () => {
    firebaseMock.configured = true;
    recordError(new Error('boom'));
    recordError('string failure');
    expect(firebaseMock.recorded.map((e) => e.message)).toEqual(['boom', 'string failure']);
  });

  it('boots with Firebase entirely absent: no throw, no fetch, defaults intact — §12.4', async () => {
    firebaseMock.configured = false;
    expect(isFirebaseConfigured()).toBe(false);
    expect(() => initFirebase()).not.toThrow();
    expect(() => recordError(new Error('boom'))).not.toThrow();
    await syncRemoteConfig();
    await tick();

    expect(firebaseMock.fetchCalls).toBe(0);
    expect(firebaseMock.signInCalls).toBe(0);
    expect(firebaseMock.recorded).toHaveLength(0);
    expect(useConfigStore.getState().value('mercy_threshold')).toBe(
      REMOTE_CONFIG_DEFAULTS.mercy_threshold,
    );
    expect(useConfigStore.getState().fetchedAt).toBeNull();
  });

  it('survives the native module throwing outright, not just being absent', () => {
    firebaseMock.throwOnGetApps = true;
    expect(isFirebaseConfigured()).toBe(false);
    expect(() => initFirebase()).not.toThrow();
  });
});
