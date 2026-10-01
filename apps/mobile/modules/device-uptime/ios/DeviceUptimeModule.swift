import ExpoModulesCore

/**
 * Exposes `CLOCK_MONOTONIC_RAW` — milliseconds since boot, a monotonic clock
 * unaffected by the user's wall clock. See the JS `index.ts` for why this
 * exists.
 *
 * NOT `ProcessInfo.systemUptime`/`mach_absolute_time`: those pause while the
 * device sleeps, which would silently deny real regen to any honest player
 * whose phone was locked for a while (a qa-prd-auditor finding on the first
 * version of this module, PRD §0 v1.44). On Darwin, `CLOCK_MONOTONIC_RAW` is
 * the sleep-INCLUSIVE clock (the same one `mach_continuous_time()` exposes) —
 * the opposite of what its name means on Linux.
 */
public class DeviceUptimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeviceUptime")

    Function("getUptimeMillis") { () -> Double in
      Double(clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)) / 1_000_000
    }
  }
}
