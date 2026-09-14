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
  /** §12.8: every Crashlytics report, in order. */
  crashes: [] as { message: string; context?: string }[],
  /** §8.3 Firestore documents by path; a missing path reads as not-exists. */
  docs: {} as Record<string, unknown>,
  /** Set to make `getDoc` reject (e.g. `firestore/permission-denied`). */
  docError: null as { code: string } | null,
  /** §8.3 callables by name; throw `{ code, details }` to model an HttpsError. */
  callables: {} as Record<string, (data: unknown) => unknown>,
  calls: [] as { name: string; data: unknown }[],
  /** §8.7 messaging: iOS permission answer (1 authorized, 0 denied), token, and
   * the notification the app was opened from. */
  messagingAuth: 1,
  fcmToken: 'fcm-token-1',
  initialNotification: null as { data?: Record<string, string> } | null,
  openedHandlers: [] as ((m: { data?: Record<string, string> }) => void)[],
  tokenRefreshHandlers: [] as ((token: string) => void)[],
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
  firebaseMock.crashes = [];
  firebaseMock.docs = {};
  firebaseMock.docError = null;
  firebaseMock.callables = {};
  firebaseMock.calls = [];
  firebaseMock.messagingAuth = 1;
  firebaseMock.fcmToken = 'fcm-token-1';
  firebaseMock.initialNotification = null;
  firebaseMock.openedHandlers = [];
  firebaseMock.tokenRefreshHandlers = [];
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

// --- crashlytics (§12.8) ---

export function getCrashlytics(): { readonly __crashlytics: true } {
  return { __crashlytics: true };
}

let pendingContext: string | undefined;

export function log(_crashlytics: unknown, message: string): void {
  pendingContext = message;
}

export function recordError(_crashlytics: unknown, error: Error): void {
  firebaseMock.crashes.push({
    message: error.message,
    ...(pendingContext ? { context: pendingContext } : {}),
  });
  pendingContext = undefined;
}

// --- firestore (§8.3) ---

export function getFirestore(): { readonly __firestore: true } {
  return { __firestore: true };
}

export function doc(_db: unknown, path: string): { path: string } {
  return { path };
}

export async function getDoc(ref: {
  path: string;
}): Promise<{ exists: () => boolean; data: () => unknown }> {
  if (firebaseMock.docError)
    throw Object.assign(new Error(firebaseMock.docError.code), firebaseMock.docError);
  const data = firebaseMock.docs[ref.path];
  return { exists: () => data !== undefined, data: () => data };
}

// --- functions (§8.3) ---

export function getFunctions(): { readonly __functions: true } {
  return { __functions: true };
}

export function httpsCallable(
  _functions: unknown,
  name: string,
): (data: unknown) => Promise<{ data: unknown }> {
  return async (data) => {
    firebaseMock.calls.push({ name, data });
    const handler = firebaseMock.callables[name];
    if (!handler) throw Object.assign(new Error('not-found'), { code: 'not-found' });
    return { data: await handler(data) };
  };
}

interface MockConstraint {
  field: string;
  op: '>=' | '<=';
  value: string;
}

export function collection(_db: unknown, path: string): { path: string } {
  return { path };
}

export function documentId(): string {
  return '__name__';
}

export function where(field: string, op: '>=' | '<=', value: string): MockConstraint {
  return { field, op, value };
}

export function query(
  ref: { path: string },
  ...constraints: MockConstraint[]
): { path: string; constraints: MockConstraint[] } {
  return { path: ref.path, constraints };
}

/** Direct children of the collection path, filtered by document-id range only. */
export async function getDocs(q: {
  path: string;
  constraints: MockConstraint[];
}): Promise<{ docs: { id: string; data: () => Record<string, unknown> }[] }> {
  if (firebaseMock.docError) {
    throw Object.assign(new Error(firebaseMock.docError.code), firebaseMock.docError);
  }
  const prefix = `${q.path}/`;
  const docs = Object.entries(firebaseMock.docs)
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map(([path, data]) => ({
      id: path.slice(prefix.length),
      data: () => data as Record<string, unknown>,
    }))
    .filter(({ id }) =>
      q.constraints.every((c) =>
        c.field !== '__name__' ? true : c.op === '>=' ? id >= c.value : id <= c.value,
      ),
    );
  return { docs };
}

// --- messaging (§8.7) ---

export function getMessaging(): { readonly __messaging: true } {
  return { __messaging: true };
}

export async function requestPermission(_m: unknown): Promise<number> {
  return firebaseMock.messagingAuth;
}

export async function getToken(_m: unknown): Promise<string> {
  return firebaseMock.fcmToken;
}

export function onTokenRefresh(_m: unknown, handler: (token: string) => void): () => void {
  firebaseMock.tokenRefreshHandlers.push(handler);
  return () => undefined;
}

export async function getInitialNotification(
  _m: unknown,
): Promise<{ data?: Record<string, string> } | null> {
  return firebaseMock.initialNotification;
}

export function onNotificationOpenedApp(
  _m: unknown,
  handler: (m: { data?: Record<string, string> }) => void,
): () => void {
  firebaseMock.openedHandlers.push(handler);
  return () => undefined;
}
