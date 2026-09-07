import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  REMOTE_CONFIG_DEFAULTS,
  REMOTE_CONFIG_TTL_MS,
  type AnalyticsEventName,
  type AnalyticsEvents,
} from '@blockmanor/shared';
import { AnalyticsQueue, analyticsQueue, defaultSender } from '../src/services/analyticsQueue';
import { installId, sessionId } from '../src/services/analyticsIdentity';
import { initFirebase, isFirebaseConfigured, syncRemoteConfig } from '../src/services/firebase';
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

/**
 * B-1: the three transport fields must never collide with a §14 param name —
 * four Core events declare `id` as the LEVEL id, so the idempotency key ships
 * as `event_id`. This is a COMPILE-time guard: if a future §14 event ever
 * declares a param called `installId`, `sessionId` or `event_id`, `pnpm
 * typecheck` fails here rather than the param being silently overwritten in
 * BigQuery.
 */
type TransportParamName = 'installId' | 'sessionId' | 'event_id';
type AnalyticsParamName = {
  [K in AnalyticsEventName]: keyof AnalyticsEvents[K] & string;
}[AnalyticsEventName];
type TransportCollision = Extract<AnalyticsParamName, TransportParamName>;
const noTransportCollision: TransportCollision[] = [];

describe('§14 analytics transport', () => {
  it('no §14 param name collides with a transport field (compile-time)', () => {
    expect(noTransportCollision).toEqual([]);
  });

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
    expect(typeof sent?.params['event_id']).toBe('string');
    expect(sent?.params['event_id']).toBeTruthy();
  });

  it("never clobbers a §14 param: level_start's `id` is the LEVEL id, not the queue id", async () => {
    firebaseMock.configured = true;
    const queue = new AnalyticsQueue({
      sender: defaultSender,
      getCap: () => 500,
      mmkvId: freshMmkvId(),
    });
    queue.track('level_start', { id: 7, attempt: 2 });
    await drained(queue);

    const sent = firebaseMock.logged[0];
    expect(sent?.params['id']).toBe(7);
    expect(sent?.params['attempt']).toBe(2);
    expect(sent?.params['event_id']).not.toBe(7);
    expect(typeof sent?.params['event_id']).toBe('string');
  });

  it('a native send failure keeps the event queued (at-least-once past the JS boundary)', async () => {
    firebaseMock.configured = true;
    firebaseMock.logEventRejects = true;
    const queue = new AnalyticsQueue({
      sender: defaultSender,
      getCap: () => 500,
      mmkvId: freshMmkvId(),
    });
    queue.track('ftue_complete', {});
    await queue.flush();
    await tick();
    expect(firebaseMock.logged).toHaveLength(0);
    expect(queue.getSnapshot().queued).toBe(1);

    // ...and it really is retried once the transport recovers.
    firebaseMock.logEventRejects = false;
    void queue.flush();
    await drained(queue);
    expect(firebaseMock.logged).toHaveLength(1);
  });

  it('an event Firebase can never accept is dropped, not left blocking the queue forever', async () => {
    firebaseMock.configured = true;
    const queue = new AnalyticsQueue({
      sender: defaultSender,
      getCap: () => 500,
      mmkvId: freshMmkvId(),
    });
    // `session_start` is Firebase-reserved (§14 v1.15) — the SDK throws on it.
    queue.track('session_start', {});
    queue.track('ftue_complete', {});
    await drained(queue);

    expect(firebaseMock.logged.map((e) => e.name)).toEqual(['ftue_complete']);
    // The loss still reaches BigQuery as `dropped_count` on the event behind it.
    expect(firebaseMock.logged[0]?.params['dropped_count']).toBe(1);
    expect(queue.getSnapshot().queued).toBe(0);
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
    // A real fetch timestamp, not 0 (which is falsy but not null).
    expect(useConfigStore.getState().fetchedAt ?? 0).toBeGreaterThan(1_700_000_000_000);

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

  it("fetches with §13's 6h TTL, sourced from the shared constant", async () => {
    firebaseMock.configured = true;
    await syncRemoteConfig();
    expect(firebaseMock.fetchCalls).toBe(1);
    // The applied value is 6h (and the whole-object assignment reached the
    // setter — a nested assignment on the getter's copy would leave 12h).
    expect(firebaseMock.settings.minimumFetchIntervalMillis).toBe(6 * 60 * 60 * 1000);
    expect(firebaseMock.settings.fetchTimeoutMillis).toBe(60_000);
    // CLAUDE.md rule 3: the call site must READ the registry constant, not a
    // literal that happens to equal it today. Nothing at runtime can tell
    // those apart, so this asserts on the source.
    // vitest's root is apps/mobile (vitest.config.ts lives there).
    const source = readFileSync('src/services/firebase.ts', 'utf8');
    expect(source).toMatch(/minimumFetchIntervalMillis: REMOTE_CONFIG_TTL_MS/);
    expect(REMOTE_CONFIG_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('coerces by registry type; malformed, unfetched and unknown keys never poison the snapshot', async () => {
    firebaseMock.configured = true;
    firebaseMock.remote = {
      daily_piece_count: { value: '72' },
      flag_endless: { value: 'false' },
      // RNFB's own asBoolean() truthy set — an operator typing `True` in the
      // console must not silently disable a flag.
      flag_share_card: { value: 'True' },
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
    expect(snapshot.flag_share_card).toBe(true);
    expect(snapshot.winstreak_thresholds).toBe('2:1,4:3');
    // malformed number → compiled default stands, NOT 0
    expect(snapshot.mercy_threshold).toBe(REMOTE_CONFIG_DEFAULTS.mercy_threshold);
    expect(snapshot.combo_step).toBe(REMOTE_CONFIG_DEFAULTS.combo_step);
    // never fetched (source `static`) → compiled default stands
    expect(snapshot.streak_repair_price).toBe(REMOTE_CONFIG_DEFAULTS.streak_repair_price);
    // registry completeness: exactly the §13 keys, no server-invented ones
    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(REMOTE_CONFIG_DEFAULTS).sort());
  });

  it('the app-wide analyticsQueue singleton reads its cap from the fetched snapshot', async () => {
    firebaseMock.configured = true;
    firebaseMock.remote = { analytics_queue_cap: { value: '2' } };
    await syncRemoteConfig();

    // Unconfigured from here on: the singleton's real sender rejects, so
    // nothing drains and the cap is the only thing that can bound the queue.
    firebaseMock.configured = false;
    expect(analyticsQueue.getSnapshot().queued).toBe(0);
    for (let i = 0; i < 4; i += 1) analyticsQueue.track(`singleton_e${i}`, {});
    await tick();
    expect(analyticsQueue.getSnapshot().queued).toBe(2);
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

  it('boots with Firebase entirely absent: no throw, no fetch, defaults intact — §12.4', async () => {
    firebaseMock.configured = false;
    expect(isFirebaseConfigured()).toBe(false);
    expect(() => initFirebase()).not.toThrow();
    await syncRemoteConfig();
    await tick();

    expect(firebaseMock.fetchCalls).toBe(0);
    expect(firebaseMock.signInCalls).toBe(0);
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
