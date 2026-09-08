/**
 * §12.10 in-app review prompt.
 *
 * The whole subsection is a set of REFUSALS — four suppressions on top of one
 * trigger — so eligibility is a pure function that takes every input
 * explicitly. Nothing here reads a store or a clock: a rule about "not within
 * 24h" that reads `Date.now()` internally cannot be tested at the boundary,
 * and the boundary is the entire point.
 */
import * as StoreReview from 'expo-store-review';

/** §12.10: "never within 24h of a fail-heavy session (>=3 fails)". */
export const FAIL_HEAVY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const FAIL_HEAVY_COUNT = 3;
/** §12.10: "triggered only after a 3-star win while win-streak >= 3". */
export const REVIEW_MIN_STARS = 3;
export const REVIEW_MIN_WIN_STREAK = 3;

export interface ReviewEligibility {
  /** `[RC] review_prompt_enabled`. */
  enabled: boolean;
  /** Stars for the win that just happened. */
  stars: number;
  winStreak: number;
  /** The running build, from `appInfo.getInstalledVersion()`. */
  installedVersion: string;
  /** The build we last prompted on, or '' if never — "max once per version". */
  promptedVersion: string;
  /** Fails recorded in the current session. */
  recentFails: number;
  /** Epoch ms of the most recent fail, or 0. */
  lastFailAt: number;
  /** Epoch ms of the most recent purchase, or 0. Always 0 in Stage 1 — there
   * is no purchase flow until §10.3 — but the rule is stated here rather than
   * bolted on in Stage 2, because "never after spending money" is a promise
   * about the whole history, not about the current stage. */
  lastPurchaseAt: number;
  now: number;
}

/** Every §12.10 condition, each independently able to refuse. */
export function shouldPromptReview(e: ReviewEligibility): boolean {
  if (!e.enabled) return false;
  if (e.stars < REVIEW_MIN_STARS) return false;
  if (e.winStreak < REVIEW_MIN_WIN_STREAK) return false;
  // Max once per version — an empty `promptedVersion` means never prompted.
  if (e.promptedVersion === e.installedVersion) return false;
  if (e.recentFails >= FAIL_HEAVY_COUNT && e.now - e.lastFailAt < FAIL_HEAVY_WINDOW_MS) {
    return false;
  }
  // Asking someone to rate you right after they paid you reads as buying the
  // review, and both stores treat that as manipulation.
  if (e.lastPurchaseAt > 0) return false;
  return true;
}

/**
 * Fires the native prompt. Both stores may silently decline to show it — that
 * is their quota, not our failure — so this reports only that we ASKED, which
 * is what "max once per version" must be recorded against. Recording only
 * shown prompts would let a quota-suppressed ask retry forever.
 */
export async function requestReview(): Promise<boolean> {
  try {
    if (!(await StoreReview.hasAction())) return false;
    await StoreReview.requestReview();
    return true;
  } catch {
    // A review prompt is never worth taking the app down for.
    return false;
  }
}
