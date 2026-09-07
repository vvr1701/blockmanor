/**
 * §7.11 "[Daily Board] tile pulses once on screen entry, max 1 pulse/session."
 * A pulse is per-MOUNT (`DailyBoardTile`'s own effect fires every time it
 * mounts), but the cap is per SESSION — i.e. it must survive Home unmounting
 * and remounting (Play -> Home, Endless -> Home, the level map's "Back to
 * Home" ghost, …) within the same app run. That is state that outlives any
 * one component instance, so it is a module-level flag, not `useState` —
 * reset only by a fresh JS process (a real app relaunch), which is exactly
 * what "session" means here.
 */
let pulsedThisSession = false;

/** Consumes the session's one daily-tile pulse. Returns `true` the first
 * time it is ever called in this process, `false` on every call after. */
export function consumeDailyPulse(): boolean {
  if (pulsedThisSession) return false;
  pulsedThisSession = true;
  return true;
}

/** Test-only: restores the "fresh session" state between test cases. */
export function resetDailyPulseForTest(): void {
  pulsedThisSession = false;
}
