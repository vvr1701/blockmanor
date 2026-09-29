/**
 * §9.1 wallet callables against the Firestore emulator. Every claim here is
 * about persisted state — "idempotent" is what the database refuses to apply
 * twice — so a mocked Firestore would prove the mock.
 */

import {
  REMOTE_CONFIG_DEFAULTS,
  USERS_COLLECTION,
  WALLET_TX_SUBCOLLECTION,
} from '@blockmanor/shared';
import { CHEST_LEVELS, FIRST_POST_FTUE_LEVEL, MAX_LEVEL_ID } from '@blockmanor/content';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const rc = vi.hoisted(() => ({
  /** Keys the "console" has set; anything absent reads as a registry default. */
  remote: {} as Record<string, number | boolean>,
  unreadable: false,
}));

vi.mock('firebase-admin/remote-config', () => ({
  getRemoteConfig: () => ({
    getServerTemplate: async () => {
      if (rc.unreadable) throw new Error('RC down');
      return {
        evaluate: () => ({
          getValue: (key: string) => ({
            getSource: () => (key in rc.remote ? 'remote' : 'default'),
            asNumber: () => Number(rc.remote[key] ?? 0),
            asBoolean: () => rc.remote[key] === true,
          }),
        }),
      };
    },
  }),
}));

const { grantCoinsFor, spendCoinsFor } = await import('../src/wallet/wallet');

const UID = 'alice';
const NOW = Date.UTC(2026, 8, 29, 12);
const D = REMOTE_CONFIG_DEFAULTS;
const db = () => getFirestore();
const userRef = (uid = UID) => db().collection(USERS_COLLECTION).doc(uid);
const ledger = (key: string) => userRef().collection(WALLET_TX_SUBCOLLECTION).doc(key);
const stored = async () => (await userRef().get()).get('wallet') as unknown;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is unset — run via `firebase emulators:exec`');
  }
  if (getApps().length === 0) initializeApp({ projectId: 'demo-blockmanor' });
});

beforeEach(async () => {
  rc.remote = { flag_economy: true };
  rc.unreadable = false;
  await db().recursiveDelete(db().collection(USERS_COLLECTION));
});

const win = (levelId: number, stars: number) => ({ source: 'level_win', levelId, stars });

describe('§9.1 sources', () => {
  it('pays a level win base + per-star x stars, on top of the new-player balance', async () => {
    const result = await grantCoinsFor(UID, win(12, 3), NOW);
    const amount = D.coins_level_win_base + D.coins_per_star * 3;
    expect(result).toEqual({
      coins: D.starting_coin_balance + amount,
      rev: 1,
      amount,
      applied: true,
    });
    expect(await stored()).toEqual({ coins: D.starting_coin_balance + amount, rev: 1 });
    expect((await ledger('level_win:12').get()).data()).toMatchObject({
      kind: 'grant',
      source: 'level_win',
      amount,
      coinsAfter: D.starting_coin_balance + amount,
    });
  });

  it('prices from LIVE Remote Config, never the client', async () => {
    rc.remote = {
      flag_economy: true,
      coins_level_win_base: 7,
      coins_per_star: 2,
      starting_coin_balance: 100,
    };
    // An `amount` in the payload is ignored — zod strips unknown keys.
    const result = await grantCoinsFor(UID, { ...win(6, 2), amount: 1_000_000 }, NOW);
    expect(result).toMatchObject({ coins: 111, amount: 11 });
  });

  it('pays a chest coins_chest, once per chest', async () => {
    const chest = CHEST_LEVELS[0];
    const first = await grantCoinsFor(UID, { source: 'chest', chestLevel: chest }, NOW);
    expect(first).toMatchObject({ coins: D.starting_coin_balance + D.coins_chest, applied: true });
    const again = await grantCoinsFor(UID, { source: 'chest', chestLevel: chest }, NOW);
    expect(again).toMatchObject({ coins: first.coins, applied: false });
  });

  it('falls back to §13 defaults per key for an out-of-bounds value', async () => {
    rc.remote = { flag_economy: true, coins_per_star: -5, coins_level_win_base: 2.5 };
    const typo = await grantCoinsFor(UID, win(6, 1), NOW);
    expect(typo.amount).toBe(D.coins_level_win_base + D.coins_per_star);
  });
});

describe('§9.1 idempotency', () => {
  it('a replayed level win pays once, even with different stars', async () => {
    const first = await grantCoinsFor(UID, win(12, 1), NOW);
    const replay = await grantCoinsFor(UID, win(12, 3), NOW);
    expect(replay).toEqual({ ...first, applied: false });
    expect(await stored()).toEqual({ coins: first.coins, rev: 1 });
  });

  it('concurrent calls with one key apply exactly once', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => grantCoinsFor(UID, win(20, 2), NOW)),
    );
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    const amount = D.coins_level_win_base + D.coins_per_star * 2;
    expect(await stored()).toEqual({ coins: D.starting_coin_balance + amount, rev: 1 });
  });

  it('a spend key replayed returns the current balance and moves nothing', async () => {
    const spend = { sink: 'continue', amount: 100, idempotencyKey: 'c-1' };
    const first = await spendCoinsFor(UID, spend, NOW);
    expect(first).toMatchObject({ coins: D.starting_coin_balance - 100, applied: true });
    const again = await spendCoinsFor(UID, spend, NOW);
    expect(again).toMatchObject({ coins: first.coins, applied: false });
  });

  it('refuses a spend key reused for a different amount', async () => {
    await spendCoinsFor(UID, { sink: 'continue', amount: 100, idempotencyKey: 'k' }, NOW);
    await expect(
      spendCoinsFor(UID, { sink: 'continue', amount: 1, idempotencyKey: 'k' }, NOW),
    ).rejects.toMatchObject({ details: { reason: 'key-conflict' } });
  });

  it('a client spend key cannot squat on a grant key', async () => {
    await spendCoinsFor(UID, { sink: 'booster', amount: 1, idempotencyKey: 'level_win:12' }, NOW);
    await expect(grantCoinsFor(UID, win(12, 3), NOW)).resolves.toMatchObject({ applied: true });
  });
});

describe('§9.1 spend primitive', () => {
  it('refuses to go below zero and writes nothing', async () => {
    await expect(
      spendCoinsFor(
        UID,
        { sink: 'continue', amount: D.starting_coin_balance + 1, idempotencyKey: 'x' },
        NOW,
      ),
    ).rejects.toMatchObject({ details: { reason: 'insufficient-funds' } });
    expect((await userRef().get()).exists).toBe(false);
    expect((await ledger('spend:x').get()).exists).toBe(false);
  });

  it('may spend the balance to exactly zero', async () => {
    const all = { sink: 'continue', amount: D.starting_coin_balance, idempotencyKey: 'all' };
    await expect(spendCoinsFor(UID, all, NOW)).resolves.toMatchObject({ coins: 0 });
  });

  it.each([0, -50, 1.5])('rejects a non-positive or fractional amount (%s)', async (amount) => {
    await expect(
      spendCoinsFor(UID, { sink: 'continue', amount, idempotencyKey: 'n' }, NOW),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

describe('§9.1 refusals', () => {
  it('refuses every mutation while flag_economy is off (§13, default off)', async () => {
    rc.remote = {};
    await expect(grantCoinsFor(UID, win(12, 3), NOW)).rejects.toMatchObject({
      details: { reason: 'economy-disabled' },
    });
    await expect(
      spendCoinsFor(UID, { sink: 'continue', amount: 1, idempotencyKey: 'a' }, NOW),
    ).rejects.toMatchObject({ details: { reason: 'economy-disabled' } });
    expect((await userRef().get()).exists).toBe(false);
  });

  it('treats an unreadable Remote Config as the default: economy off', async () => {
    rc.unreadable = true;
    await expect(grantCoinsFor(UID, win(12, 3), NOW)).rejects.toMatchObject({
      details: { reason: 'economy-disabled' },
    });
  });

  it('refuses levels and chests that do not exist', async () => {
    for (const bad of [
      win(MAX_LEVEL_ID + 1, 3),
      { source: 'chest', chestLevel: 11 },
      { source: 'chest', chestLevel: MAX_LEVEL_ID + 10 },
    ]) {
      await expect(grantCoinsFor(UID, bad, NOW)).rejects.toMatchObject({
        details: { reason: 'unknown-event' },
      });
    }
  });

  it('refuses FTUE level wins (L1, L5) and writes nothing (§9.1, §0 v1.35a)', async () => {
    for (const levelId of [1, 5]) {
      await expect(grantCoinsFor(UID, win(levelId, 3), NOW)).rejects.toMatchObject({
        details: { reason: 'unknown-event' },
      });
      expect((await ledger(`level_win:${levelId}`).get()).exists).toBe(false);
    }
    expect(await stored()).toBeUndefined();
  });

  it('still pays the first post-FTUE level', async () => {
    expect(FIRST_POST_FTUE_LEVEL).toBe(6);
    const amount = D.coins_level_win_base + D.coins_per_star * 3;
    await expect(grantCoinsFor(UID, win(FIRST_POST_FTUE_LEVEL, 3), NOW)).resolves.toMatchObject({
      coins: D.starting_coin_balance + amount,
      applied: true,
    });
    expect((await ledger('level_win:6').get()).exists).toBe(true);
  });

  it.each([
    [{ source: 'daily_complete', date: '2026-09-29' }],
    [{ source: 'rewarded_ad' }],
    [{ source: 'iap', amount: 5000 }],
    [win(12, 0)],
    [win(12, 4)],
    [win(0, 3)],
  ])('refuses a source or shape the client may not ask for: %j', async (req) => {
    await expect(grantCoinsFor(UID, req, NOW)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('never "repairs" a malformed stored wallet back to the starting balance', async () => {
    await userRef().set({ wallet: { coins: -3, rev: 2 } });
    await expect(grantCoinsFor(UID, win(12, 3), NOW)).rejects.toMatchObject({ code: 'internal' });
    expect(await stored()).toEqual({ coins: -3, rev: 2 });
  });

  it('leaves the rest of the user document alone', async () => {
    await userRef().set({ streak: 4, lastStreakDate: '2026-09-28' });
    await grantCoinsFor(UID, win(12, 3), NOW);
    expect((await userRef().get()).data()).toMatchObject({
      streak: 4,
      lastStreakDate: '2026-09-28',
    });
  });
});
