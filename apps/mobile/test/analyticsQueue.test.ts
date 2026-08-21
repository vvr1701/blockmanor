import { AppState } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import { describe, expect, it } from 'vitest';
import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import {
  AnalyticsQueue,
  defaultSender,
  isAnalyticsConsentGranted,
  type QueuedEvent,
} from '../src/services/analyticsQueue';

/**
 * `tsc --noEmit` (unlike vitest) resolves `react-native` to the real
 * `@types/react-native`, which has no `__emit` — that's a test-only
 * addition on the vitest-aliased mock (`test/mocks/react-native.ts`). This
 * narrow cast is only so the real typecheck job passes; the runtime value
 * under vitest IS the mock, which really does have `__emit`.
 */
const MockAppState = AppState as unknown as {
  __emit: (state: 'background' | 'active' | 'inactive') => void;
};

/** Fresh MMKV id per test — the mock's store is a module-level singleton
 * keyed by id, so a shared id would leak state between tests. */
let mmkvCounter = 0;
function freshMmkvId(): string {
  mmkvCounter += 1;
  return `analytics-queue-test-${mmkvCounter}`;
}

/** A sender that resolves a few ms later, never instantly — exercises the
 * async drain path instead of a same-tick short-circuit. */
function deferredSender(): {
  sender: (event: QueuedEvent) => Promise<void>;
  calls: QueuedEvent[];
} {
  const calls: QueuedEvent[] = [];
  const sender = (event: QueuedEvent): Promise<void> => {
    calls.push(event);
    return new Promise((resolve) => setTimeout(resolve, 5));
  };
  return { sender, calls };
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

describe('AnalyticsQueue', () => {
  it('drop-oldest at the cap, with dropped_count attached to the next dispatched event', async () => {
    const calls: QueuedEvent[] = [];
    const unblockE0Ref: { current: (() => void) | null } = { current: null };
    const sender = (event: QueuedEvent): Promise<void> => {
      calls.push(event);
      // Only e0 is held open (simulating "in flight"); every later event
      // sends and resolves immediately once the drain loop reaches it.
      if (event.name === 'e0') {
        return new Promise((resolve) => {
          unblockE0Ref.current = resolve;
        });
      }
      return Promise.resolve();
    };
    const queue = new AnalyticsQueue({ sender, getCap: () => 3, mmkvId: freshMmkvId() });

    // e0: sent immediately, holds the sender promise open — cap eviction
    // below must never rip an in-flight event out from under its own send.
    queue.track('e0', {});
    await Promise.resolve();
    expect(calls).toHaveLength(1);

    // Cap is 3, and e0 (in flight) permanently occupies one of those 3
    // slots — so of e1..e5 pushed behind it, 3 must be dropped (oldest of
    // the *non*-in-flight ones first) to stay at the cap, leaving [e0, e4, e5].
    queue.track('e1', {});
    queue.track('e2', {});
    queue.track('e3', {});
    queue.track('e4', {});
    queue.track('e5', {});

    expect(queue.getSnapshot().queued).toBe(3);
    expect(queue.getSnapshot().events.map((e) => e.name)).toEqual(['e0', 'e4', 'e5']);
    expect(queue.getSnapshot().pendingDroppedCount).toBe(3); // e1, e2, e3 dropped

    unblockE0Ref.current?.(); // let e0's send resolve — drain can now reach e4, e5
    await drained(queue);

    expect(calls.map((c) => c.name)).toEqual(['e0', 'e4', 'e5']);
    const e4Delivered = calls.find((c) => c.name === 'e4');
    expect(e4Delivered?.params['dropped_count']).toBe(3);
    // Only the event that actually carried it — not every event after.
    const e5Delivered = calls.find((c) => c.name === 'e5');
    expect(e5Delivered?.params['dropped_count']).toBeUndefined();
    expect(queue.getSnapshot().pendingDroppedCount).toBe(0);
  });

  it('MAJOR-1b: drops that land during an in-flight send are subtracted, not zeroed, off the carrying event', async () => {
    // Reproduces the audit repro exactly: cap 2, hold a send open, force
    // drops both before AND during that in-flight send. The old code
    // (`this.pendingDroppedCount = 0` on delivery) wiped whatever accrued
    // during the await; the fix subtracts only what that event carried.
    const held = new Set<string>();
    const resolvers = new Map<string, () => void>();
    const calls: QueuedEvent[] = [];
    const sender = (event: QueuedEvent): Promise<void> => {
      calls.push(event);
      if (held.has(event.name)) {
        return new Promise((resolve) => resolvers.set(event.name, resolve));
      }
      return Promise.resolve();
    };
    const queue = new AnalyticsQueue({ sender, getCap: () => 2, mmkvId: freshMmkvId() });

    held.add('e0');
    queue.track('e0', {});
    await Promise.resolve(); // e0 now in flight, holding the drain loop open

    // Cap 2, e0 occupies one slot in flight — e1 then e2 overflow it:
    // events settle to [e0, e3], 2 dropped (e1, e2) BEFORE e3 ever dispatches.
    queue.track('e1', {});
    queue.track('e2', {});
    queue.track('e3', {});
    expect(queue.getSnapshot().pendingDroppedCount).toBe(2);

    // e3 becomes the next carrier — also held open, so drops can land WHILE
    // it's in flight, not just before it was dispatched.
    held.add('e3');
    resolvers.get('e0')!(); // let e0's send resolve, drain reaches e3
    await new Promise((resolve) => setTimeout(resolve, 0));

    const e3Dispatched = calls.find((c) => c.name === 'e3');
    expect(e3Dispatched?.params['dropped_count']).toBe(2); // "carrying event dispatched = 2"

    // While e3's send is still awaiting, force 2 MORE drops (e4, then e5;
    // e6 survives as the new tail) — the exact "4 total, 2 mid-flight" repro.
    queue.track('e4', {});
    queue.track('e5', {});
    queue.track('e6', {});
    expect(queue.getSnapshot().pendingDroppedCount).toBe(4); // "pending during in-flight send = 4"

    resolvers.get('e3')!(); // let e3's send resolve
    await drained(queue);

    // All 4 drops must reach the wire — split across whichever events
    // actually carried them, never silently zeroed.
    const totalDroppedOnWire = calls
      .map((c) => c.params['dropped_count'])
      .filter((v): v is number => typeof v === 'number')
      .reduce((sum, v) => sum + v, 0);
    expect(totalDroppedOnWire).toBe(4);
    expect(queue.getSnapshot().pendingDroppedCount).toBe(0);
  });

  it('in-flight guard: two track() calls in one tick send exactly once each, never a double-send', async () => {
    const { sender, calls } = deferredSender();
    const queue = new AnalyticsQueue({ sender, getCap: () => 500, mmkvId: freshMmkvId() });

    queue.track('a', { v: 1 });
    queue.track('b', { v: 2 });

    await drained(queue);

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.name)).toEqual(['a', 'b']);
    // No id sent twice.
    expect(new Set(calls.map((c) => c.id)).size).toBe(2);
  });

  it('per-event removal: a failing head blocks nothing already delivered, and only the head stays queued', async () => {
    let failNext = true;
    const calls: QueuedEvent[] = [];
    const sender = (event: QueuedEvent): Promise<void> => {
      calls.push(event);
      if (event.name === 'bad' && failNext) {
        failNext = false;
        return Promise.reject(new Error('nope'));
      }
      return Promise.resolve();
    };
    const queue = new AnalyticsQueue({ sender, getCap: () => 500, mmkvId: freshMmkvId() });

    queue.track('bad', {});
    await Promise.resolve();
    await Promise.resolve();

    // 'bad' failed and stays at the head; a later successful flush should
    // retry it and then continue.
    expect(queue.getSnapshot().queued).toBe(1);
    await queue.flush();
    expect(queue.getSnapshot().queued).toBe(0);
    expect(calls.filter((c) => c.name === 'bad')).toHaveLength(2); // one failed attempt, one success
  });

  it('the no-transport degradation path: defaultSender rejects, leaving events queued (no crash)', async () => {
    const queue = new AnalyticsQueue({
      sender: defaultSender,
      getCap: () => 500,
      mmkvId: freshMmkvId(),
    });
    expect(() => queue.track('untransportable', {})).not.toThrow();
    await queue.flush();
    expect(queue.getSnapshot().queued).toBe(1); // still queued — never silently dropped or "sent"
  });

  it('queue persistence and rehydration across a simulated restart', async () => {
    const id = freshMmkvId();
    const stuckSender = (): Promise<void> => new Promise(() => undefined); // never resolves
    const first = new AnalyticsQueue({ sender: stuckSender, getCap: () => 500, mmkvId: id });
    first.track('will_survive_restart', { x: 1 });
    await Promise.resolve();
    expect(first.getSnapshot().queued).toBe(1);

    // Simulate restart: a brand new AnalyticsQueue instance over the SAME
    // MMKV id, as a real cold start would construct at module load.
    const calls: QueuedEvent[] = [];
    const second = new AnalyticsQueue({
      sender: (e) => {
        calls.push(e);
        return Promise.resolve();
      },
      getCap: () => 500,
      mmkvId: id,
    });
    expect(second.getSnapshot().queued).toBe(1);
    await drained(second);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('will_survive_restart');
  });

  it('rehydrates cleanly (empty queue, no throw) from a corrupt persisted payload', () => {
    const id = freshMmkvId();
    const storage = new MMKV({ id });
    storage.set('analytics.queue.v1', '{not valid json');
    expect(
      () => new AnalyticsQueue({ sender: defaultSender, getCap: () => 500, mmkvId: id }),
    ).not.toThrow();
  });

  it('MINOR-1: the cap is applied on rehydrate, not left over-cap until the next track()', async () => {
    const id = freshMmkvId();
    const storage = new MMKV({ id });
    const events: QueuedEvent[] = Array.from({ length: 40 }, (_, i) => ({
      id: `persisted-${i}`,
      name: `e${i}`,
      params: {},
      installId: 'install',
      sessionId: 'session',
      ts: i,
    }));
    storage.set('analytics.queue.v1', JSON.stringify({ events, pendingDroppedCount: 0 }));

    // cap=5, persisted 40 -> queued must be 5 the moment the queue is
    // constructed, not 40 (the audit's exact repro numbers).
    const queue = new AnalyticsQueue({ sender: defaultSender, getCap: () => 5, mmkvId: id });
    expect(queue.getSnapshot().queued).toBe(5);
    // The oldest were dropped, not the newest — same drop-oldest policy as
    // live eviction, and each drop is counted.
    expect(queue.getSnapshot().events.map((e) => e.name)).toEqual([
      'e35',
      'e36',
      'e37',
      'e38',
      'e39',
    ]);
    expect(queue.getSnapshot().pendingDroppedCount).toBe(35);
  });

  it('MINOR-2: a NaN or non-numeric cap falls back to the [RC] registry default, not "unbounded"', () => {
    const nanCapId = freshMmkvId();
    const nanCapQueue = new AnalyticsQueue({
      sender: defaultSender,
      getCap: () => Number.NaN,
      mmkvId: nanCapId,
    });
    for (let i = 0; i < 502; i += 1) nanCapQueue.track(`e${i}`, {});
    // Default is 500 (REMOTE_CONFIG_DEFAULTS.analytics_queue_cap) — 502
    // tracked must evict down to it, not stay unbounded at 502.
    expect(nanCapQueue.getSnapshot().queued).toBe(REMOTE_CONFIG_DEFAULTS.analytics_queue_cap);
    expect(nanCapQueue.getSnapshot().pendingDroppedCount).toBe(2);

    const stringCapId = freshMmkvId();
    // Simulates an un-coerced Remote Config string value reaching `getCap`.
    const stringCapQueue = new AnalyticsQueue({
      sender: defaultSender,
      getCap: () => 'lots' as unknown as number,
      mmkvId: stringCapId,
    });
    for (let i = 0; i < 502; i += 1) stringCapQueue.track(`e${i}`, {});
    expect(stringCapQueue.getSnapshot().queued).toBe(REMOTE_CONFIG_DEFAULTS.analytics_queue_cap);
    expect(stringCapQueue.getSnapshot().pendingDroppedCount).toBe(2);
  });

  it('MINOR-3: a rehydrated id-less event is filtered out, not left to mass-delete every id-less sibling on send', async () => {
    const id = freshMmkvId();
    const storage = new MMKV({ id });
    const events = [
      { id: undefined, name: 'orphan_1', params: {}, installId: 'i', sessionId: 's', ts: 1 },
      { id: undefined, name: 'orphan_2', params: {}, installId: 'i', sessionId: 's', ts: 2 },
      { id: 'good-1', name: 'good', params: {}, installId: 'i', sessionId: 's', ts: 3 },
    ];
    storage.set('analytics.queue.v1', JSON.stringify({ events, pendingDroppedCount: 0 }));

    const calls: QueuedEvent[] = [];
    const queue = new AnalyticsQueue({
      sender: (e) => {
        calls.push(e);
        return Promise.resolve();
      },
      getCap: () => 500,
      mmkvId: id,
    });

    // Both id-less entries are dropped at rehydrate — only the structurally
    // valid one survives and sends.
    expect(queue.getSnapshot().queued).toBe(1);
    await drained(queue);
    expect(calls.map((c) => c.name)).toEqual(['good']);
  });

  it('AppState background transition retries a previously-failed send', async () => {
    let shouldFail = true;
    const calls: QueuedEvent[] = [];
    const sender = (event: QueuedEvent): Promise<void> => {
      calls.push(event);
      return shouldFail ? Promise.reject(new Error('down')) : Promise.resolve();
    };
    const queue = new AnalyticsQueue({
      sender,
      getCap: () => 500,
      mmkvId: freshMmkvId(),
      flushOnBackground: true,
    });

    queue.track('bg_event', {});
    // Let the doomed first attempt (triggered by `track()` itself) settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(queue.getSnapshot().queued).toBe(1); // still queued — the send failed
    expect(calls).toHaveLength(1);

    shouldFail = false; // "transport recovers" — irrelevant to what triggers the retry
    MockAppState.__emit('background');
    await drained(queue);

    expect(calls).toHaveLength(2);
    expect(queue.getSnapshot().queued).toBe(0);
  });

  it('consent gate is a no-op pass-through (always true today)', () => {
    expect(isAnalyticsConsentGranted()).toBe(true);
  });
});
