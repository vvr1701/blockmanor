import { getAnalytics } from '@react-native-firebase/analytics';
import { getApp, getApps } from '@react-native-firebase/app';
import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import { fetchAndActivate, getAll, getRemoteConfig } from '@react-native-firebase/remote-config';
import {
  REMOTE_CONFIG_DEFAULTS,
  REMOTE_CONFIG_TTL_MS,
  type RemoteConfigKey,
  type RemoteConfigSnapshot,
  type RemoteConfigValue,
} from '@blockmanor/shared';
import { useConfigStore } from '../state/useConfigStore';

/**
 * Firebase wiring (PRD §4.1) — `@react-native-firebase/*`, not the `firebase`
 * JS SDK: on React Native the JS SDK cannot provide Analytics, Remote Config,
 * Crashlytics or Messaging (they need browser APIs).
 *
 * Native config comes from `google-services.json` / `GoogleService-Info.plist`
 * baked in at build time by the config plugin (app.config.ts), so there is no
 * JS-side credential object any more.
 *
 * EVERYTHING here degrades to a no-op when Firebase is absent — PRD §12.4:
 * levels and endless stay fully playable with no connectivity and no project.
 */

/** The native app, or null when no `google-services.json` was baked in. */
export function getFirebaseApp(): ReturnType<typeof getApp> | null {
  try {
    return getApps().length > 0 ? getApp() : null;
  } catch {
    return null;
  }
}

/** True when a native Firebase app is present (see google-services.json). */
export function isFirebaseConfigured(): boolean {
  return getFirebaseApp() !== null;
}

/** Analytics instance for the §14 transport, or null when unconfigured. */
export function getFirebaseAnalytics(): ReturnType<typeof getAnalytics> | null {
  if (!isFirebaseConfigured()) return null;
  try {
    return getAnalytics();
  } catch {
    return null;
  }
}

/**
 * PRD §4.1 Anonymous Auth. Idempotent: the native SDK persists the session, so
 * a relaunch already has `currentUser` and this signs in exactly once per
 * install. Awaited by nobody — §7.11 "Home renders from cache instantly".
 */
async function signInAnonymouslyOnce(): Promise<void> {
  try {
    const auth = getAuth();
    if (auth.currentUser) return;
    await signInAnonymously(auth);
  } catch {
    // offline or no project — §12.4, the app plays on without a uid
  }
}

/**
 * Maps fetched RC values onto the §13 registry. Iterates the registry (not the
 * fetched payload), so an unknown server key can never enter the snapshot, and
 * coerces to the type of that key's default. Keys that were never fetched
 * (source `static`) and numeric keys whose remote value isn't a finite number
 * keep their compiled default rather than poisoning a call site with 0.
 */
function coerceSnapshot(
  values: Record<string, { getSource: () => string; asString: () => string }>,
): Partial<RemoteConfigSnapshot> {
  const out: Record<string, RemoteConfigValue> = {};
  for (const key of Object.keys(REMOTE_CONFIG_DEFAULTS) as RemoteConfigKey[]) {
    const entry = values[key];
    if (!entry || entry.getSource() === 'static') continue;
    const raw = entry.asString();
    const fallback: RemoteConfigValue = REMOTE_CONFIG_DEFAULTS[key];
    if (typeof fallback === 'number') {
      // `Number('')` is 0, not NaN — an empty remote value must fall back to
      // the default, not silently zero out a price or a threshold.
      const parsed = raw.trim() === '' ? Number.NaN : Number(raw);
      if (!Number.isFinite(parsed)) continue;
      out[key] = parsed;
    } else if (typeof fallback === 'boolean') {
      // Same truthy set as RNFB's `Value.asBoolean()`, so a flag typed as
      // `True`/`yes` in the Firebase console doesn't silently read false.
      out[key] = ['true', '1', 't', 'y', 'yes'].includes(raw.trim().toLowerCase());
    } else {
      out[key] = raw;
    }
  }
  return out as Partial<RemoteConfigSnapshot>;
}

/**
 * PRD §13: "fetch on cold start + 6h TTL; snapshot into `useConfigStore`".
 * The TTL is the §13 constant from packages/shared, never a literal here
 * (CLAUDE.md rule 3).
 */
export async function syncRemoteConfig(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    const remoteConfig = getRemoteConfig();
    // `settings` is a getter that returns a NEW object each read (RNFB 26.4.0
    // `remote-config/lib/index.ts`), so `settings.minimumFetchIntervalMillis =
    // x` mutates a temporary and is silently discarded, leaving the native 12h
    // default. Only whole-object assignment reaches the setter.
    remoteConfig.settings = {
      ...remoteConfig.settings,
      minimumFetchIntervalMillis: REMOTE_CONFIG_TTL_MS,
    };
    await fetchAndActivate(remoteConfig);
    useConfigStore.getState().applySnapshot(coerceSnapshot(getAll(remoteConfig)), Date.now());
  } catch {
    // Fetch failed (offline, no project) — the compiled §13 defaults stand.
  }
}

/**
 * Cold-start bootstrap. Fire-and-forget by design: nothing here is awaited by
 * the render path, so first paint never waits on the network (§7.11).
 */
export function initFirebase(): void {
  if (!isFirebaseConfigured()) return;
  void signInAnonymouslyOnce();
  void syncRemoteConfig();
}
