import { MMKV } from 'react-native-mmkv';

/**
 * §14 analytics-infra requirement 3: "identity before auth exists." No
 * Firebase Anonymous Auth is wired yet (that lands with §8's daily board),
 * so every event needs a device-stable identifier of its own so a per-user
 * funnel (e.g. `ftue_step` step-by-step) can be assembled in BigQuery before
 * auth exists. No PII in either id — both are opaque random strings.
 */

const storage = new MMKV({ id: 'blockmanor' });
const INSTALL_ID_KEY = 'analytics.installId';

/** Opaque random id — not a UUID library dependency for a handful of bits
 * of entropy that only need to be locally-unique, never globally verified. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Exported so a test can call it directly to simulate "restart, read the
 * already-persisted id back" without needing a real process restart. */
export function loadOrCreateInstallId(): string {
  const existing = storage.getString(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = newId();
  storage.set(INSTALL_ID_KEY, id);
  return id;
}

/** Stable across app restarts (MMKV-persisted) — one per device install. */
export const installId: string = loadOrCreateInstallId();

/** Fresh every cold start (module load = process start) — never persisted. */
export const sessionId: string = newId();
