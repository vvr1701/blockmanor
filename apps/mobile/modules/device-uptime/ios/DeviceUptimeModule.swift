import ExpoModulesCore

/**
 * Exposes `ProcessInfo.systemUptime` — seconds since boot, a monotonic clock
 * unaffected by the user's wall clock. See the JS `index.ts` for why this
 * exists. Converted to milliseconds to match the Android side.
 */
public class DeviceUptimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeviceUptime")

    Function("getUptimeMillis") { () -> Double in
      ProcessInfo.processInfo.systemUptime * 1000
    }
  }
}
