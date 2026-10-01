/**
 * Minimal `device-uptime` stand-in — see vitest.config.ts. A real device's
 * uptime keeps advancing on its own; tests that care about the clamp drive it
 * explicitly via `setMockUptime`/`advanceMockUptime`, everything else can
 * ignore it entirely (it defaults to 0 and never moves on its own).
 */
let uptimeMs = 0;

export function getUptimeMillis(): number {
  return uptimeMs;
}

export function setMockUptime(ms: number): void {
  uptimeMs = ms;
}

export function resetMockUptime(): void {
  uptimeMs = 0;
}
