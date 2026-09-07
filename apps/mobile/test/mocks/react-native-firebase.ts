/**
 * Minimal `@react-native-firebase/*` stand-in — see vitest.config.ts, which
 * aliases app / auth / analytics / remote-config / crashlytics all to this one
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
  /** The live settings object `getRemoteConfig()` hands back — the TTL is set
   * by assigning `minimumFetchIntervalMillis` on it (RNFB's modular API has no
   * `setConfigSettings`, matching the Firebase web SDK). */
  settings: { minimumFetchIntervalMillis: 0, fetchTimeoutMillis: 60000 },
  recorded: [] as Error[],
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
  firebaseMock.settings = { minimumFetchIntervalMillis: 0, fetchTimeoutMillis: 60000 };
  firebaseMock.recorded = [];
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
export function getAnalytics(): { kind: 'analytics' } {
  return { kind: 'analytics' };
}

export async function logEvent(
  _analytics: unknown,
  name: string,
  params: Record<string, unknown>,
): Promise<void> {
  firebaseMock.logged.push({ name, params });
}

// --- remote config ---
export function getRemoteConfig(): { settings: { minimumFetchIntervalMillis: number } } {
  return { settings: firebaseMock.settings };
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

// --- crashlytics ---
export function getCrashlytics(): { kind: 'crashlytics' } {
  return { kind: 'crashlytics' };
}

export function recordError(_crashlytics: unknown, error: Error): void {
  firebaseMock.recorded.push(error);
}
