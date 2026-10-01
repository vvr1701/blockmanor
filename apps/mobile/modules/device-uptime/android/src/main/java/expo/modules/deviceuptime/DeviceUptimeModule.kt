package expo.modules.deviceuptime

import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exposes `SystemClock.elapsedRealtime()` — milliseconds since boot, a
 * monotonic clock the OS keeps advancing through sleep, unaffected by the
 * user's wall clock. See the JS `index.ts` for why this exists.
 */
class DeviceUptimeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DeviceUptime")

    Function("getUptimeMillis") {
      SystemClock.elapsedRealtime().toDouble()
    }
  }
}
