import {
  clampParamValueLengths,
  type AnalyticsEventName,
  type AnalyticsEvents,
} from '@blockmanor/shared';
import { analyticsQueue } from './analyticsQueue';

/**
 * Analytics emission seam (PRD §14, CLAUDE.md rule 4). This is the same
 * typed call every feature fires through — signature unchanged, so no call
 * site changes for this PR. The body now hands off to the §14 runtime
 * queue (`analyticsQueue.ts`): clamp dynamic string param values to
 * Firebase's 100-char cap (the one runtime piece of the §14 compile-time
 * guard in `packages/shared`, §14 requirement 1), then enqueue for at-least-
 * once delivery with identity, bounded drop-oldest, and MMKV persistence
 * (requirements 2-4). `__DEV__`/preview-APK visibility of what's queued
 * lives in `AnalyticsDebugOverlay`, not here.
 */
export function track<K extends AnalyticsEventName>(name: K, params: AnalyticsEvents[K]): void {
  const clamped = clampParamValueLengths(params);
  analyticsQueue.track(name, clamped as unknown as Record<string, unknown>);
}
