import { describe, expect, it } from 'vitest';
import {
  grantKey,
  grantRequestSchema,
  levelWinCoins,
  spendKey,
  spendRequestSchema,
} from '../src/wallet';

describe('§9.1 wallet contract', () => {
  it('prices a level win as base + perStar x stars', () => {
    expect(levelWinCoins(40, 10, 3)).toBe(70);
    expect(levelWinCoins(40, 10, 1)).toBe(50);
  });

  it('keys a grant by its event, so each level and chest pays once', () => {
    expect(grantKey({ source: 'level_win', levelId: 12, stars: 1 })).toBe('level_win:12');
    expect(grantKey({ source: 'level_win', levelId: 12, stars: 3 })).toBe('level_win:12');
    expect(grantKey({ source: 'chest', chestLevel: 10 })).toBe('chest:10');
  });

  it('namespaces client spend keys away from grant keys', () => {
    expect(spendKey('level_win:12')).toBe('spend:level_win:12');
  });

  it('never lets a client request carry an amount or a server-only source', () => {
    const parsed = grantRequestSchema.parse({ source: 'chest', chestLevel: 10, amount: 1e9 });
    expect(parsed).toEqual({ source: 'chest', chestLevel: 10 });
    expect(grantRequestSchema.safeParse({ source: 'daily_complete' }).success).toBe(false);
  });

  it('refuses a free or negative spend and a key Firestore cannot store', () => {
    const ok = { sink: 'continue', amount: 900, idempotencyKey: 'L12:a3:c1' };
    expect(spendRequestSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ amount: 0 }, { amount: -1 }, { idempotencyKey: 'a/b' }]) {
      expect(spendRequestSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
    }
  });
});
