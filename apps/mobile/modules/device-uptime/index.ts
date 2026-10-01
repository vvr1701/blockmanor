import { requireNativeModule } from 'expo-modules-core';

interface DeviceUptimeModule {
  getUptimeMillis(): number;
}

const native = requireNativeModule<DeviceUptimeModule>('DeviceUptime');

/**
 * Milliseconds since device boot — monotonic, unaffected by the user's wall
 * clock, and (on both platforms) keeps advancing through sleep: Android
 * `SystemClock.elapsedRealtime`, iOS `CLOCK_MONOTONIC_RAW` (sleep-inclusive on
 * Darwin, unlike its Linux namesake — NOT `ProcessInfo.systemUptime`, which
 * pauses on sleep). Resets only on a real device reboot. See §0's lives
 * clock-exploit ruling for why this exists: `apps/mobile/src/services/lives.ts`
 * clamps wall-clock-measured regen time to this, so setting the clock forward
 * no longer mints free lives.
 */
export function getUptimeMillis(): number {
  return native.getUptimeMillis();
}
