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
 * Residual, disclosed gap (§0 v1.44 — corrects v1.43's "narrowly-timed"
 * claim, which a qa-prd-auditor review showed was wrong): a real device
 * reboot resets uptime near zero, so the gap BEFORE a reboot can never be
 * verified and is never credited — not "a clock change timed to coincide
 * with a reboot", but every reboot, unconditionally. This costs an honest
 * player regen they are "owed" for time spent fully powered off (there is no
 * clock of any kind that survives a power cycle), but it is SAFE: nothing
 * about a reboot ever credits MORE than the uptime actually accrued since
 * that reboot, so it cannot be used to mint extra lives. An earlier version
 * of this function instead measured the reboot-crossing gap against the
 * wall clock, which let a stale backward-clock adjustment get "cashed in" at
 * the next reboot, however much later — that is the bug v1.44 fixes.
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
  const uptimeElapsed = uptime - anchor.uptime;
  const rebooted = uptimeElapsed < 0;
  // A reboot breaks the uptime chain, so nothing before it is verifiable —
  // credit only the time since THIS boot (never the wall-clock gap, which
  // may carry a stale lag from an earlier backward-clock adjustment).
  const credited = rebooted ? uptime : Math.min(wallNow - anchor.wall, uptimeElapsed);
  const trusted = anchor.wall + credited;
  storage.set(KEY, JSON.stringify({ wall: trusted, uptime }));
  return trusted;
}

/** Test-only: forgets the anchor so the next `trustedNow()` re-initializes. */
export function resetTrustedClock(): void {
  storage.delete(KEY);
}
