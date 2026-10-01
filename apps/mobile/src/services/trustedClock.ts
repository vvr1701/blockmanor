import { getUptimeMillis } from 'device-uptime';
import { MMKV } from 'react-native-mmkv';

/**
 * §9.2 lives regen used the raw wall clock, the only clock offline — but that
 * made setting the clock forward a zero-tampering, zero-skill exploit for
 * free lives (§0 v1.42(e)). `getUptimeMillis()` (device-uptime, a local Expo
 * native module) is monotonic and unaffected by the wall clock, so `trustedNow`
 * credits elapsed time as whichever of (wall-clock elapsed, uptime elapsed)
 * since the last call is LESS (§0 v1.43) — a forward wall-clock jump no
 * longer mints lives, while a real offline period (both clocks agree) still
 * credits correctly.
 *
 * Residual, disclosed gap: a real device reboot resets uptime near zero, so a
 * clock change made in the same window as a reboot falls back to trusting the
 * wall clock for that one transition (§0 v1.43).
 */

const storage = new MMKV({ id: 'blockmanor' });
const KEY = 'trustedClock.anchor';

interface Anchor {
  wall: number;
  uptime: number;
}

function readAnchor(): Anchor | null {
  const raw = storage.getString(KEY);
  return raw ? (JSON.parse(raw) as Anchor) : null;
}

export function trustedNow(wallNow: number = Date.now()): number {
  const uptime = getUptimeMillis();
  const anchor = readAnchor();
  if (!anchor) {
    storage.set(KEY, JSON.stringify({ wall: wallNow, uptime }));
    return wallNow;
  }
  const wallElapsed = wallNow - anchor.wall;
  const uptimeElapsed = uptime - anchor.uptime;
  const rebooted = uptimeElapsed < 0;
  const credited = rebooted ? wallElapsed : Math.min(wallElapsed, uptimeElapsed);
  const trusted = anchor.wall + credited;
  storage.set(KEY, JSON.stringify({ wall: trusted, uptime }));
  return trusted;
}

/** Test-only: forgets the anchor so the next `trustedNow()` re-initializes. */
export function resetTrustedClock(): void {
  storage.delete(KEY);
}
