/**
 * Minimal `@react-native-firebase/*` stand-in — see vitest.config.ts, which
 * aliases app / auth / analytics / remote-config all to this one
 * file (the real packages are native modules and throw outside an RN runtime).
 * There is no device in the test loop, so this is the only way the transport,
 * the Remote Config sync and the offline degradation get exercised at all.
 *
 * Defaults to UNCONFIGURED (no `google-services.json`), which is exactly the
 * §12.4 offline path every existing render test now boots through.
 */

interface MockUser {
  uid: string;
}

export const firebaseMock = {
  /** false = no native app, i.e. no google-services.json baked in. */
  configured: false,
  /** Set non-null to simulate a persisted anonymous session after relaunch. */
  currentUser: null as MockUser | null,
  signInCalls: 0,
  logged: [] as { name: string; params: Record<string, unknown> }[],
  /** Remote Config payload: key -> raw string value (+ optional source). */
  remote: {} as Record<string, { value: string; source?: string }>,
  fetchCalls: 0,
  /** Native RNFB defaults (12h / 60s) — what stands if nothing sets them. */
  settings: { minimumFetchIntervalMillis: 43_200_000, fetchTimeoutMillis: 60_000 },
  /** Set to make `logEvent` reject asynchronously (native send failure). */
  logEventRejects: false,
  /** Names the real SDK refuses SYNCHRONOUSLY — reserved or malformed. */
  reservedEventNames: ['session_start', 'first_open', 'app_remove'],
  /** Simulate the native module blowing up rather than returning empty. */
  throwOnGetApps: false,
};

export function resetFirebaseMock(): void {
  firebaseMock.configured = false;
  firebaseMock.currentUser = null;
  firebaseMock.signInCalls = 0;
  firebaseMock.logged = [];
  firebaseMock.remote = {};
  firebaseMock.fetchCalls = 0;
  firebaseMock.settings = { minimumFetchIntervalMillis: 43_200_000, fetchTimeoutMillis: 60_000 };
  firebaseMock.logEventRejects = false;
  firebaseMock.throwOnGetApps = false;
}

// --- app ---
export function getApps(): { name: string }[] {
  if (firebaseMock.throwOnGetApps) throw new Error('native Firebase module unavailable');
  return firebaseMock.configured ? [{ name: '[DEFAULT]' }] : [];
}

export function getApp(): { name: string } {
  if (!firebaseMock.configured) throw new Error('no Firebase app');
  return { name: '[DEFAULT]' };
}

// --- auth ---
export function getAuth(): { currentUser: MockUser | null } {
  return {
    get currentUser() {
      return firebaseMock.currentUser;
    },
  };
}

export async function signInAnonymously(_auth: unknown): Promise<{ user: MockUser }> {
  firebaseMock.signInCalls += 1;
  firebaseMock.currentUser = { uid: 'anon-uid' };
  return { user: firebaseMock.currentUser };
}

// --- analytics ---
/**
 * The Analytics INSTANCE, as production uses it. `logEvent` mirrors the real
 * module: it validates the name SYNCHRONOUSLY (throwing on a reserved or
 * malformed one, RNFB `analytics/lib/index.ts`) and otherwise returns a
 * promise that can reject for a native send failure.
 */
export function getAnalytics(): {
  logEvent: (name: string, params: Record<string, unknown>) => Promise<void>;
} {
  return {
    logEvent(name, params) {
      if (firebaseMock.reservedEventNames.includes(name)) {
        throw new Error(`the event name '${name}' is reserved and can not be used.`);
      }
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name)) {
        throw new Error(`invalid event name '${name}'.`);
      }
      if (firebaseMock.logEventRejects) return Promise.reject(new Error('native send failed'));
      firebaseMock.logged.push({ name, params });
      return Promise.resolve();
    },
  };
}

// --- remote config ---
/**
 * `settings` models the real module's GETTER, which returns a fresh copy each
 * read, and its SETTER, which is the only path that actually applies a change
 * (RNFB `remote-config/lib/index.ts`). A mock exposing one shared mutable
 * object made a discarded nested assignment look like it worked.
 */
export function getRemoteConfig(): {
  settings: { minimumFetchIntervalMillis: number; fetchTimeoutMillis: number };
} {
  return {
    get settings() {
      return { ...firebaseMock.settings };
    },
    set settings(next: { minimumFetchIntervalMillis: number; fetchTimeoutMillis: number }) {
      firebaseMock.settings = { ...next };
    },
  };
}

export async function fetchAndActivate(_remoteConfig: unknown): Promise<boolean> {
  firebaseMock.fetchCalls += 1;
  return true;
}

export function getAll(
  _remoteConfig: unknown,
): Record<string, { getSource: () => string; asString: () => string }> {
  const out: Record<string, { getSource: () => string; asString: () => string }> = {};
  for (const [key, entry] of Object.entries(firebaseMock.remote)) {
    out[key] = {
      getSource: () => entry.source ?? 'remote',
      asString: () => entry.value,
    };
  }
  return out;
}
