/**
 * The `onCall` wrappers themselves. Every other daily test calls the injected
 * bodies (`startDailyAttempt`, `submitDailyAttempt`) directly, which leaves the
 * one line that makes these callables per-player — the auth check — untested.
 * §8.3/§8.5 attempts, submissions and streaks are all keyed by uid, so an
 * unauthenticated request must never reach the body.
 *
 * A unit test, not an emulator test: the check runs before any Firestore or
 * secret access, which is exactly the property being asserted.
 */
import { describe, expect, it } from 'vitest';
import { dailyPlayStart } from '../src/daily/playStart';
import { dailySubmit } from '../src/daily/submit';
import { grantCoins, spendCoins } from '../src/wallet/wallet';

const unauthenticated = (data: unknown) => ({ data, auth: undefined }) as never;

describe('daily callables require sign-in', () => {
  it('dailyPlayStart rejects an unauthenticated request before doing anything', async () => {
    await expect(dailyPlayStart.run(unauthenticated({ date: '2026-08-09' }))).rejects.toMatchObject(
      {
        code: 'unauthenticated',
      },
    );
  });

  it('dailySubmit rejects an unauthenticated request before doing anything', async () => {
    await expect(
      dailySubmit.run(unauthenticated({ date: '2026-08-09', moves: [], claimedScore: 0 })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('§9.1 grantCoins and spendCoins reject an unauthenticated request', async () => {
    await expect(
      grantCoins.run(unauthenticated({ source: 'level_win', levelId: 12, stars: 3 })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(
      spendCoins.run(unauthenticated({ sink: 'continue', amount: 1, idempotencyKey: 'k' })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
