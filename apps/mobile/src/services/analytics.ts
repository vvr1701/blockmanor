import type { AnalyticsEventName, AnalyticsEvents } from '@blockmanor/shared';

/**
 * Analytics emission seam (PRD §14, CLAUDE.md rule 4). A full analytics
 * service (typed layer -> local ring buffer -> dev-only debug overlay ->
 * queued dispatcher with a cap) is its own follow-up PR, immediately after
 * this one — do NOT build that here. This is only the minimal typed call
 * every feature fires through today (console in dev, the nearest thing to a
 * debug view this app currently has); that PR replaces the body, not the
 * call sites, so nothing upstream changes.
 */
export function track<K extends AnalyticsEventName>(name: K, params: AnalyticsEvents[K]): void {
  if (__DEV__) {
    console.log(`[analytics] ${name}`, params);
  }
}
