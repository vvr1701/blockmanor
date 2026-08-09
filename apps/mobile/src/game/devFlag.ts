/**
 * Is the debug board reachable, and the render-time overlay drawn?
 *
 * `__DEV__` alone is the wrong gate for the §4.5 measurement it exists to serve:
 * a dev build reports pessimistic numbers (dev-mode React + unminified JS), and a
 * release `preview` APK — the build that gives a HONEST number — has `__DEV__`
 * false, so neither the toggle nor the overlay would appear at all.
 *
 * So: on in dev, plus opt-in at build time for a release profiling build via
 * `EXPO_PUBLIC_DEV_BOARD=1 eas build --profile preview`. Off in production
 * builds, which never set it.
 */
export const DEV_BOARD_ENABLED = __DEV__ || process.env['EXPO_PUBLIC_DEV_BOARD'] === '1';

/**
 * Force the §7.1 FTUE funnel to (re)play even on a device with an existing
 * save — the returning-user skip (App.tsx) is otherwise correct and
 * permanent once `ftueComplete` is persisted, which is exactly what makes it
 * impossible to re-walk the funnel for QA without wiping app data.
 *
 * Deliberately env-var-only, NOT `__DEV__`-on-by-default like
 * `DEV_BOARD_ENABLED` above: `DEV_BOARD_ENABLED` only reveals a manual toggle
 * button, but this flag forces FTUE to show unconditionally, which would
 * make Home unreachable during ordinary dev iteration if it defaulted on. So
 * it needs an explicit opt-in even in a dev build — same env-var mechanism
 * and the same reason as `DEV_BOARD_ENABLED`: this has to differ between a
 * dev/QA build and a release build, so it MUST be a build-time env var
 * declared in `eas.json`'s `preview` profile `env` block, never a local
 * shell variable — EAS builds on a remote worker that never sees the local
 * environment.
 */
export const FTUE_FORCE_REPLAY = process.env['EXPO_PUBLIC_FTUE_FORCE_REPLAY'] === '1';
