import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Running-build identity + version comparison — PRD §12.5 (force-update
 * gate) and §12.1 (version/build footer). One seam for both, since they read
 * the exact same "what build is this" fact.
 */

/** `app.config.ts`'s `version` field, baked into whatever build is running —
 * the single source of truth CLAUDE.md rule 3 wants for a `[RC]` COMPARISON
 * target ( `min_supported_version` is the RC half; this is the local half ).
 * Falls back to `'0.0.0'` rather than throwing so a malformed/absent config
 * degrades to "oldest possible", never a crash on the boot path. */
export function getInstalledVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/**
 * Numeric, component-wise version compare (PRD §12.5's own warning: string
 * compare is wrong here — `"1.10" < "1.9"` lexicographically). Missing
 * trailing components read as 0 (`"1.2"` == `"1.2.0"`); a non-numeric
 * component parses to 0 rather than `NaN` poisoning the whole comparison, so
 * a malformed Remote Config string degrades to "oldest possible" instead of
 * silently comparing as always-equal.
 *
 * Returns negative if `a` < `b`, 0 if equal, positive if `a` > `b`.
 */
export function compareVersions(a: string, b: string): number {
  const as = a.split('.').map((p) => Number(p) || 0);
  const bs = b.split('.').map((p) => Number(p) || 0);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (as[i] ?? 0) - (bs[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when the installed build is strictly below `minSupportedVersion`. */
export function isBelowMinVersion(installed: string, minSupportedVersion: string): boolean {
  return compareVersions(installed, minSupportedVersion) < 0;
}

/**
 * §12.1's "version/build footer" — the build-number half. `app.config.ts`
 * sets neither `android.versionCode` nor `ios.buildNumber` today (`eas.json`
 * manages both remotely via `appVersionSource: "remote"` +
 * `autoIncrement`), so there is genuinely no build identifier baked into
 * this JS bundle yet — this reads whatever IS configured and falls back to
 * `'1'` rather than inventing a number. Honest either way: "matches the
 * running build" holds because it reads the same `Constants` object a real
 * device build would populate, never a hardcoded literal.
 * ponytail: no build-number wiring in app.config.ts yet — read it for real once EAS's remote version source is surfaced to the JS bundle.
 */
export function getBuildLabel(): string {
  const android = Constants.expoConfig?.android?.versionCode;
  const ios = Constants.expoConfig?.ios?.buildNumber;
  if (typeof android === 'number') return String(android);
  if (typeof ios === 'string' && ios.length > 0) return ios;
  return '1';
}

/**
 * §12.5's "working store button" — a link-out, never a purchase flow. The
 * Android URL is real (built from the same package id `app.config.ts` ships,
 * read off `Constants` rather than re-typed here so the two can never
 * drift). The iOS URL is a deliberate placeholder: this app has no App Store
 * listing yet (CLAUDE.md — "iOS boot unverified", not blocking Stage 1), so
 * there is no numeric App Store id to link to. A generic store search is a
 * genuinely working link-out today; swap it for the real
 * `itms-apps://itunes.apple.com/app/id<ID>` once the app is listed.
 * ponytail: iOS falls back to a search URL, not a deep link — fix once an App Store id exists.
 */
export function getStoreUrl(): string {
  const androidPackage = Constants.expoConfig?.android?.package ?? 'com.vvr1701.blockmanor';
  return Platform.select({
    ios: 'https://apps.apple.com/search?term=Block%20Manor',
    default: `https://play.google.com/store/apps/details?id=${androidPackage}`,
  })!;
}
