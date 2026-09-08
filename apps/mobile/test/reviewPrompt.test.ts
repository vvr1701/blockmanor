/**
 * §12.10 acceptance: the prompt fires only after a 3-star win with win-streak
 * >= 3, and each of the four suppressions is asserted SEPARATELY (§0 rule 6a
 * — a criterion may not lean on a neighbour's assertions).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FAIL_HEAVY_WINDOW_MS,
  requestReview,
  shouldPromptReview,
  type ReviewEligibility,
} from '../src/services/reviewPrompt';
import { resetStoreReviewMock, storeReviewMock } from './mocks/expo-store-review';

const NOW = 1_700_000_000_000;

/** The one state in which §12.10 says "yes". Every case below changes exactly
 * one field, so a failure names the rule that broke. */
const eligible: ReviewEligibility = {
  enabled: true,
  stars: 3,
  winStreak: 3,
  installedVersion: '0.1.0',
  promptedVersion: '',
  recentFails: 0,
  lastFailAt: 0,
  lastPurchaseAt: 0,
  now: NOW,
};

beforeEach(resetStoreReviewMock);

describe('§12.10 review prompt eligibility', () => {
  it('fires on a 3-star win with win-streak 3', () => {
    expect(shouldPromptReview(eligible)).toBe(true);
  });

  it('does NOT fire below 3 stars', () => {
    expect(shouldPromptReview({ ...eligible, stars: 2 })).toBe(false);
  });

  it('does NOT fire below win-streak 3', () => {
    expect(shouldPromptReview({ ...eligible, winStreak: 2 })).toBe(false);
  });

  // --- the four suppressions, one test each ---

  it('suppression 1: never twice on the same version', () => {
    expect(shouldPromptReview({ ...eligible, promptedVersion: '0.1.0' })).toBe(false);
    // ...but a NEW build is eligible again.
    expect(shouldPromptReview({ ...eligible, promptedVersion: '0.0.9' })).toBe(true);
  });

  it('suppression 2: never within 24h of a >=3-fail session', () => {
    const failHeavy = { ...eligible, recentFails: 3, lastFailAt: NOW - 1000 };
    expect(shouldPromptReview(failHeavy)).toBe(false);
    // Just outside the window: eligible again.
    expect(shouldPromptReview({ ...failHeavy, lastFailAt: NOW - FAIL_HEAVY_WINDOW_MS })).toBe(true);
    // Two fails is not fail-heavy, however recent.
    expect(shouldPromptReview({ ...failHeavy, recentFails: 2 })).toBe(true);
  });

  it('suppression 3: never after spending money', () => {
    expect(shouldPromptReview({ ...eligible, lastPurchaseAt: NOW - 1 })).toBe(false);
  });

  it('suppression 4: never when review_prompt_enabled is false', () => {
    expect(shouldPromptReview({ ...eligible, enabled: false })).toBe(false);
  });

  it('the 24h window is 24 hours, not merely "a window"', () => {
    expect(FAIL_HEAVY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('§12.10 native request', () => {
  it('asks the store when an action is available', async () => {
    expect(await requestReview()).toBe(true);
    expect(storeReviewMock.requests).toBe(1);
  });

  it('reports false — and does not ask — when the store has no action', async () => {
    storeReviewMock.available = false;
    expect(await requestReview()).toBe(false);
    expect(storeReviewMock.requests).toBe(0);
  });

  it('never throws out of a review prompt', async () => {
    storeReviewMock.throwOnRequest = true;
    await expect(requestReview()).resolves.toBe(false);
  });
});
