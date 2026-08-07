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
