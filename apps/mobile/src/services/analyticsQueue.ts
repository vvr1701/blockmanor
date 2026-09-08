import { AppState } from 'react-native';
import { reportNetworkResult } from './connectivity';
import { MMKV } from 'react-native-mmkv';
import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import { useConfigStore } from '../state/useConfigStore';
import { installId, newId, sessionId } from './analyticsIdentity';
import { getFirebaseAnalytics } from './firebase';

/**
 * §14 analytics-infra runtime queue — apps/mobile side of the on-device
 * dispatch pipeline (the typed layer lives in `packages/shared/src/analytics.ts`
 * and is untouched here). Bounded ring buffer, drop-oldest over cap,
 * at-least-once delivery with a per-event idempotency key, an in-flight
 * guard against concurrent double-sends, and MMKV persistence so a killed
 * app doesn't lose its tail.
 */

export interface QueuedEvent {
  /** Per-event idempotency key (requirement 4) — GA4 has no dedupe key of
   * its own, so this travels as a param for downstream dedupe if needed. */
  id: string;
  name: string;
  params: Record<string, unknown>;
  installId: string;
  sessionId: string;
  /** apps/mobile, not packages/engine — Date.now() here is fine (CLAUDE.md
   * rule 2 only bans it inside the pure engine). */
  ts: number;
}

/** Resolves once the event is durably sent; rejects (never throws
 * synchronously) on any failure. Must not be assumed instant. */
export type AnalyticsSender = (event: QueuedEvent) => Promise<void>;

/**
 * §14 requirement 6: consent gating seam (§10.4, Stage 2). NO-OP
 * pass-through only — reads no Stage-2 state, builds no consent logic
 * (CLAUDE.md hard rule 1: later-stage behavior stays out until its own
 * stage). A Stage-2 PR replaces this function's body with a real check;
 * every event passes today.
 */
export function isAnalyticsConsentGranted(): boolean {
  return true;
}

/**
 * A send that will NEVER succeed on a retry — Firebase rejects the event name
 * itself (reserved name, reserved prefix, or a name failing its
 * `/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/` rule), which it reports by throwing
 * synchronously before any native call. `flush()` drops these instead of
 * retrying the head forever; anything else is treated as transient.
 */
export class PermanentSendError extends Error {}

/**
 * The three non-§14 fields every dispatched event carries (§14 requirements 3
 * and 4). Exported as a named helper ONLY so the compile-time collision guard
 * in `firebase.test.ts` can derive its param names from `TransportField`
 * rather than restating them: a hand-written union drifts, and an audit
 * proved it — a fourth field named `step` (a real `ftue_step` param) passed
 * both `tsc` and all 370 tests.
 *
 * The idempotency id ships as `event_id`, never `id`: four §14 Core events
 * declare `id` as the LEVEL id, and sending it as `id` put a random UUID in
 * the column the §14 level funnel is built on.
 */
export function transportFields(event: QueuedEvent): {
  installId: string;
  sessionId: string;
  event_id: string;
} {
  return { installId: event.installId, sessionId: event.sessionId, event_id: event.id };
}

/** The param names `transportFields` occupies — the collision guard's input. */
export type TransportField = keyof ReturnType<typeof transportFields>;

/**
 * §14 transport — `@react-native-firebase/analytics` (operator-approved; the
 * `firebase` JS SDK cannot do Analytics on React Native).
 *
 * Uses the Analytics INSTANCE method, not the modular `logEvent()` free
 * function: the latter is typed `void` and does `void analytics.logEvent(...)`
 * internally (RNFB 26.4.0 `analytics/lib/index.ts`), discarding the promise —
 * awaiting it would resolve instantly and the queue would delete an event that
 * never reached Firebase, breaking the §14 at-least-once guarantee. The
 * instance method returns the real promise.
 *
 * Carries `installId`, `sessionId` and the idempotency id (as `event_id`)
 * through as params (§14 requirements 3 and 4): a bare
 * `logEvent(event.name, event.params)` would silently drop all three. The
 * transport fields go FIRST and `...event.params` LAST so a §14 param can
 * never be clobbered by transport metadata — four §14 Core events already
 * declare `id` as the LEVEL id, which is why the idempotency key is NOT sent
 * as `id`. `firebase.test.ts` carries a compile-time guard that reds if any
 * §14 param name ever collides with one of these three.
 *
 * Rejects — never resolves falsely — when no native Firebase app is present,
 * so the queue's normal failure path (stop draining, leave events queued,
 * retry next flush) still runs honestly offline (§12.4) and the debug overlay
 * never lies about delivery.
 */
export const defaultSender: AnalyticsSender = async (event) => {
  const analytics = getFirebaseAnalytics();
  if (!analytics) throw new Error('analytics transport not configured — no native Firebase app');
  let sent: Promise<void>;
  try {
    sent = analytics.logEvent(event.name, {
      ...transportFields(event),
      // LAST, always. `transportFields` names the §14 collision guard's whole
      // input, but ordering is the second, independent protection: even a
      // field the guard has not yet learned about cannot clobber a §14 param
      // from here. The two cover each other's gaps — see the tests pinning
      // both, added after an audit found each individually reversible.
      ...event.params,
    });
  } catch (error) {
    // Name/param validation throws synchronously and will never pass on a
    // retry — surface it as permanent so one bad event can't wedge the queue.
    //
    // NIT-C, named because it is a SILENT total-loss shape: RNFB also throws
    // synchronously here when the Analytics native module is not linked (an
    // app registered without the pod/Gradle plugin). Every event is then
    // classified permanent and dropped, and `dropped_count` never reaches
    // BigQuery because nothing ever dispatches — so the funnel is empty rather
    // than visibly broken. Dropping still beats wedging (it IS permanent for
    // the process), and the honest fix is not a code change: a preview APK
    // shows it immediately in the debug overlay, which is why CLAUDE.md's
    // "analytics events verified in debug view" DoD is a device gate.
    throw new PermanentSendError(error instanceof Error ? error.message : String(error));
  }
  await sent;
  // §12.4: a completed send is the app's most reliable "we are online" fact.
  reportNetworkResult(true);
};

interface PersistedQueueV1 {
  events: QueuedEvent[];
  pendingDroppedCount: number;
}

export interface AnalyticsQueueOptions {
  sender: AnalyticsSender;
  /** [RC] `analytics_queue_cap` — read live, never hardcoded at the call site. */
  getCap: () => number;
  /** Distinct id per instance under test so parallel queues in one test file
   * don't share the mocked MMKV's persisted state. Defaults to the app's
   * single real storage namespace. */
  mmkvId?: string;
  /** Injectable for deterministic `ts` in tests; defaults to `Date.now`. */
  now?: () => number;
  /** Subscribe to app background/inactive for a lifecycle flush. Off by
   * default in tests unless a case needs it, on for the app singleton. */
  flushOnBackground?: boolean;
}

const PERSIST_KEY = 'analytics.queue.v1';

export class AnalyticsQueue {
  private readonly sender: AnalyticsSender;
  private readonly getCap: () => number;
  private readonly storage: MMKV;
  private readonly now: () => number;
  private events: QueuedEvent[] = [];
  private pendingDroppedCount = 0;
  /** In-flight guard (audit MAJOR-2): only one drain loop runs at a time;
   * a `track()` mid-drain just appends — the running loop will reach it. */
  private flushing = false;
  /** id of the event currently awaited by `sender`, if any — protects it
   * from cap eviction: it has already been handed to the sender, so it must
   * never be double-counted as "dropped" out from under an in-flight send. */
  private inFlightId: string | null = null;

  constructor(options: AnalyticsQueueOptions) {
    this.sender = options.sender;
    this.getCap = options.getCap;
    this.storage = new MMKV({ id: options.mmkvId ?? 'blockmanor' });
    this.now = options.now ?? Date.now;
    this.rehydrate();
    if (options.flushOnBackground) {
      AppState.addEventListener('change', (state) => {
        if (state === 'background' || state === 'inactive') void this.flush();
      });
    }
    // A killed app can leave a persisted tail behind it; retry it now
    // instead of waiting for the next `track()` or background transition.
    if (this.events.length > 0) void this.flush();
  }

  /** Queue one event. Cap comes from Remote Config (`analytics_queue_cap`,
   * [RC], default 500) via `getCap` — never a hardcoded literal here. */
  track(name: string, params: Record<string, unknown>): void {
    if (!isAnalyticsConsentGranted()) return;
    const event: QueuedEvent = {
      id: newId(),
      name,
      params,
      installId,
      sessionId,
      ts: this.now(),
    };
    this.events.push(event);
    this.evictToCap();
    this.persist();
    void this.flush();
  }

  /** MINOR-2: `getCap()` is Remote Config today, and RC delivers strings —
   * the fetch/coercion layer doesn't exist yet. A NaN/non-numeric cap must
   * never disable eviction (`length > NaN` is always false), so fall back
   * to the §13 registry default rather than a bare literal (CLAUDE.md rule
   * 3). Same fallback for a numeric-but-not-finite cap (Infinity, -Infinity). */
  private resolveCap(): number {
    const raw = this.getCap();
    const cap =
      typeof raw === 'number' && Number.isFinite(raw)
        ? raw
        : REMOTE_CONFIG_DEFAULTS.analytics_queue_cap;
    return Math.max(0, Math.floor(cap));
  }

  /** Drop-oldest eviction down to the current cap. Shared by `track()`
   * (MINOR-2) and `rehydrate()` (MINOR-1: a blob persisted under a larger
   * cap must not load whole and stay over-cap until the next `track()`). */
  private evictToCap(): void {
    const cap = this.resolveCap();
    while (this.events.length > cap) {
      // Never evict the event currently in flight — it's already been
      // handed to the sender, so it's "sent", not a candidate to drop.
      const victimIndex = this.events[0]?.id === this.inFlightId ? 1 : 0;
      const victim = this.events[victimIndex];
      if (!victim) break;
      this.events.splice(victimIndex, 1);
      this.pendingDroppedCount += 1;
    }
  }

  /** Read-only snapshot for the debug overlay — never the live arrays. */
  getSnapshot(): { queued: number; pendingDroppedCount: number; events: QueuedEvent[] } {
    return {
      queued: this.events.length,
      pendingDroppedCount: this.pendingDroppedCount,
      events: [...this.events],
    };
  }

  /** Drains the queue in order, one send in flight at a time. Stops (does
   * not throw, does not spin) on the first failed send, leaving the rest
   * queued for the next `track()` or lifecycle flush to retry. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.events.length > 0) {
        const head = this.events[0];
        if (!head) break;
        const outgoing = this.attachDroppedCount(head);
        // MAJOR-1b: snapshot the amount THIS event actually carries, right
        // when it's attached — not "whatever pendingDroppedCount is once the
        // await resolves". Drops that land while this send is in flight bump
        // pendingDroppedCount further; only the amount captured here is this
        // event's to clear.
        const attached = outgoing !== head ? this.pendingDroppedCount : 0;
        this.inFlightId = head.id;
        let permanentlyUnsendable = false;
        try {
          await this.sender(outgoing);
        } catch (error) {
          // Transient (offline, native error): leave it queued, try later.
          if (!(error instanceof PermanentSendError)) break;
          // Permanent (Firebase rejects the event name itself): retrying can
          // only fail again, and `flush()` is strict head-of-line, so keeping
          // it would block every later event on this install forever. Drop it.
          permanentlyUnsendable = true;
        } finally {
          this.inFlightId = null;
        }
        // Per-event removal (requirement 4): only this id, only after ITS
        // own send resolved — never a batch-wide clear.
        this.events = this.events.filter((e) => e.id !== head.id);
        if (permanentlyUnsendable) {
          // Counted like a cap eviction so the loss still reaches BigQuery as
          // `dropped_count` on the next event that does dispatch (§14 v1.15).
          // `attached` is deliberately NOT cleared: this event never landed.
          this.pendingDroppedCount += 1;
          continue;
        }
        // Subtract, never zero — a drop attached to a LATER event (from
        // in-flight overflow) must survive this delivery.
        if (attached > 0)
          this.pendingDroppedCount = Math.max(0, this.pendingDroppedCount - attached);
      }
    } finally {
      // MINOR-4: one persist per drain, not one per sent event. A full
      // JSON.stringify + blocking MMKV write per event is O(n²) work on a
      // long drain, and the drain that matters fires from the constructor
      // at cold start (§4.5 budget). At-least-once delivery already
      // tolerates a crash mid-drain — the idempotency key covers a resend.
      // REG-1: reset the in-flight guard BEFORE persisting. If persist()
      // throws (disk full, encryption error), a reset that came after it
      // would never run, leaving `flushing` stuck true and killing every
      // subsequent send for the life of the process. Safe to reorder:
      // persist() only reads state that is already final here.
      this.flushing = false;
      // REG-1 (second half): a persistence failure must never escape into app
      // code. Analytics is best-effort — the queue stays correct in memory and
      // the next persist retries. Throwing here would surface an MMKV disk
      // error as an unhandled rejection in whatever happened to call track().
      try {
        this.persist();
      } catch {
        // deliberately swallowed; see above
      }
    }
  }

  /** MAJOR-1: attaches the drop-oldest overflow counter as a PARAM on the
   * next event actually dispatched (not a new §14 event, not device-only). */
  private attachDroppedCount(event: QueuedEvent): QueuedEvent {
    if (this.pendingDroppedCount <= 0) return event;
    return { ...event, params: { ...event.params, dropped_count: this.pendingDroppedCount } };
  }

  private persist(): void {
    const payload: PersistedQueueV1 = {
      events: this.events,
      pendingDroppedCount: this.pendingDroppedCount,
    };
    this.storage.set(PERSIST_KEY, JSON.stringify(payload));
  }

  private rehydrate(): void {
    const raw = this.storage.getString(PERSIST_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PersistedQueueV1;
      const events = Array.isArray(parsed.events) ? parsed.events : [];
      // MINOR-3: a structurally-valid-but-semantically-wrong blob (an
      // id-less or name-less entry) must not survive rehydrate — `flush()`
      // removes by `id`, and an `undefined` head id would match every other
      // id-less event's `filter`, mass-deleting them on the first send.
      this.events = events.filter(
        (e): e is QueuedEvent =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as QueuedEvent).id === 'string' &&
          (e as QueuedEvent).id.length > 0 &&
          typeof (e as QueuedEvent).name === 'string',
      );
      this.pendingDroppedCount = Number.isFinite(parsed.pendingDroppedCount)
        ? parsed.pendingDroppedCount
        : 0;
      // MINOR-1: apply the (possibly lowered, since cold start) cap now —
      // otherwise a blob persisted under a larger cap loads whole and stays
      // over-cap until the next `track()`.
      this.evictToCap();
    } catch {
      // Corrupt persisted payload — degrade to an empty queue rather than crash boot.
      this.events = [];
      this.pendingDroppedCount = 0;
    }
  }
}

/** App-wide singleton. Real MMKV namespace, live [RC] cap, background flush
 * on, Firebase Analytics transport (see `defaultSender` above). */
export const analyticsQueue = new AnalyticsQueue({
  sender: defaultSender,
  getCap: () => useConfigStore.getState().value('analytics_queue_cap'),
  flushOnBackground: true,
});
