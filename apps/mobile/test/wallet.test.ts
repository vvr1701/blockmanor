import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/analytics', () => ({ track: vi.fn() }));

import { REMOTE_CONFIG_DEFAULTS, type SubmitResult, type WalletResult } from '@blockmanor/shared';
import { applyAcceptedDaily, resetAppliedDaily } from '../src/game/dailyResult';
import { track } from '../src/services/analytics';
import { resetConnectivity } from '../src/services/connectivity';
import {
  flushPendingGrants,
  grantCoins,
  spendCoins,
  syncWallet,
  watchWalletSync,
} from '../src/services/wallet';
import { useConfigStore } from '../src/state/useConfigStore';
import { selectBalance, useWalletStore } from '../src/state/useWalletStore';
import { firebaseMock, resetFirebaseMock } from './mocks/react-native-firebase';

/**
 * §9.1 client wallet: optimistic with rollback, against the RNFB stand-in.
 * The server's half (pricing, idempotency, rules) is proven against the
 * emulator in backend/functions; this pins what the app does with its answers.
 */

const D = REMOTE_CONFIG_DEFAULTS;
const START = D.starting_coin_balance;
const WIN_12_3 = { source: 'level_win', levelId: 12, stars: 3 } as const;
const OPTIMISTIC = D.coins_level_win_base + D.coins_per_star * 3;
const flush = () => new Promise((r) => setTimeout(r, 0));
const balance = () => selectBalance(useWalletStore.getState(), START);
const served = (coins: number, rev: number, amount: number, applied = true): WalletResult => ({
  coins,
  rev,
  amount,
  applied,
});
const rejection = (reason: string) =>
  Object.assign(new Error(reason), { code: 'functions/failed-precondition', details: { reason } });

beforeEach(() => {
  vi.mocked(track).mockClear();
  resetFirebaseMock();
  resetConnectivity();
  resetAppliedDaily();
  firebaseMock.configured = true;
  firebaseMock.currentUser = { uid: 'alice' };
  useConfigStore.setState({ snapshot: { ...D, flag_economy: true }, fetchedAt: null });
  useWalletStore.setState({ coins: null, rev: 0, pending: {}, held: 0 });
});

describe('§9.1 grants', () => {
  it('does nothing at all while flag_economy is off (§13)', async () => {
    useConfigStore.setState({ snapshot: { ...D } });
    grantCoins(WIN_12_3);
    await flush();
    expect(firebaseMock.calls).toEqual([]);
    expect(useWalletStore.getState().pending).toEqual({});
  });

  it('never asks for FTUE (L1–L5) coins — no call, no optimistic credit (§9.1)', async () => {
    grantCoins({ source: 'level_win', levelId: 5, stars: 3 });
    await flush();
    expect(firebaseMock.calls).toEqual([]);
    expect(useWalletStore.getState().pending).toEqual({});
  });

  it('credits optimistically, then adopts the SERVER balance and fires coins_earned once', async () => {
    let resolve: (r: WalletResult) => void = () => {};
    firebaseMock.callables['grantCoins'] = () => new Promise<WalletResult>((r) => (resolve = r));
    grantCoins(WIN_12_3);
    // Before the server answers: already shown.
    expect(balance()).toBe(START + OPTIMISTIC);
    expect(firebaseMock.calls).toEqual([{ name: 'grantCoins', data: WIN_12_3 }]);
    expect(track).not.toHaveBeenCalled();

    // The server priced it differently (a live RC push the client has not fetched).
    resolve(served(START + 99, 1, 99));
    await flush();
    expect(balance()).toBe(START + 99);
    expect(useWalletStore.getState().pending).toEqual({});
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('coins_earned', { source: 'level_win', amount: 99 });
  });

  it('rolls back on a server rejection and fires nothing', async () => {
    firebaseMock.callables['grantCoins'] = () => {
      throw rejection('economy-disabled');
    };
    grantCoins(WIN_12_3);
    await flush();
    expect(balance()).toBe(START);
    expect(useWalletStore.getState().pending).toEqual({});
    expect(track).not.toHaveBeenCalled();
  });

  it('rolls back on invalid-argument too — a final answer, not a fault', async () => {
    firebaseMock.callables['grantCoins'] = () => {
      throw Object.assign(new Error('bad'), { code: 'functions/invalid-argument' });
    };
    grantCoins(WIN_12_3);
    await flush();
    expect(useWalletStore.getState().pending).toEqual({});
  });

  it('keeps an offline grant pending and pays it on the next flush (§12.4)', async () => {
    firebaseMock.callables['grantCoins'] = () => {
      throw Object.assign(new Error('unavailable'), { code: 'functions/unavailable' });
    };
    grantCoins(WIN_12_3);
    await flush();
    expect(balance()).toBe(START + OPTIMISTIC);
    expect(Object.keys(useWalletStore.getState().pending)).toEqual(['level_win:12']);

    firebaseMock.callables['grantCoins'] = () => served(START + OPTIMISTIC, 1, OPTIMISTIC);
    await flushPendingGrants();
    expect(useWalletStore.getState()).toMatchObject({ coins: START + OPTIMISTIC, pending: {} });
    expect(track).toHaveBeenCalledWith('coins_earned', { source: 'level_win', amount: OPTIMISTIC });
  });

  it('a replayed key (already applied server-side) settles without a second coins_earned', async () => {
    firebaseMock.callables['grantCoins'] = () => served(START + OPTIMISTIC, 1, OPTIMISTIC, false);
    grantCoins(WIN_12_3);
    await flush();
    expect(useWalletStore.getState().pending).toEqual({});
    expect(track).not.toHaveBeenCalled();
  });

  it('queues one pending grant per key, however often the win is reported', async () => {
    firebaseMock.callables['grantCoins'] = () => new Promise(() => {});
    grantCoins(WIN_12_3);
    grantCoins(WIN_12_3);
    expect(balance()).toBe(START + OPTIMISTIC);
  });

  it('prices a chest from coins_chest', () => {
    firebaseMock.callables['grantCoins'] = () => new Promise(() => {});
    grantCoins({ source: 'chest', chestLevel: 10 });
    expect(balance()).toBe(START + D.coins_chest);
  });

  it('never adopts a server balance older than one already adopted', () => {
    useWalletStore.getState().applyServer({ coins: 700, rev: 5 });
    useWalletStore.getState().applyServer({ coins: 100, rev: 4 });
    expect(useWalletStore.getState()).toMatchObject({ coins: 700, rev: 5 });
  });
});

describe('§9.1 spend primitive', () => {
  it('holds the coins while in flight and adopts the server balance on success', async () => {
    let resolve: (r: WalletResult) => void = () => {};
    firebaseMock.callables['spendCoins'] = () => new Promise<WalletResult>((r) => (resolve = r));
    const done = spendCoins('continue', 200, 'L12:a1:c1');
    expect(balance()).toBe(START - 200);
    resolve(served(START - 200, 1, 200));
    await expect(done).resolves.toBe('spent');
    expect(useWalletStore.getState()).toMatchObject({ coins: START - 200, held: 0 });
    expect(firebaseMock.calls[0]?.data).toEqual({
      sink: 'continue',
      amount: 200,
      idempotencyKey: 'L12:a1:c1',
    });
    // Server-confirmed as newly applied: counted once.
    expect(vi.mocked(track).mock.calls).toEqual([
      ['coins_spent', { sink: 'continue', amount: 200 }],
    ]);
  });

  it('a replayed spend key (already applied) fires no second coins_spent', async () => {
    firebaseMock.callables['spendCoins'] = () => served(START - 200, 1, 200, false);
    await expect(spendCoins('continue', 200, 'k')).resolves.toBe('spent');
    expect(track).not.toHaveBeenCalled();
  });

  it('a replay skips the local affordability check and the hold — the server decides', async () => {
    useWalletStore.setState({ coins: 10 });
    firebaseMock.callables['spendCoins'] = () => served(10, 1, 200, false);
    await expect(spendCoins('continue', 200, 'k', true)).resolves.toBe('spent');
    expect(firebaseMock.calls).toHaveLength(1);
    expect(useWalletStore.getState().held).toBe(0);
  });

  it.each([
    ['a rejection', rejection('insufficient-funds'), 'rejected'],
    ['a network fault', Object.assign(new Error('x'), { code: 'functions/unavailable' }), 'failed'],
  ])('rolls back on %s', async (_label, error, outcome) => {
    firebaseMock.callables['spendCoins'] = () => {
      throw error;
    };
    await expect(spendCoins('continue', 200, 'k')).resolves.toBe(outcome);
    expect(balance()).toBe(START);
    expect(track).not.toHaveBeenCalled();
  });

  it('does not call the server for a spend the shown balance cannot cover', async () => {
    await expect(spendCoins('continue', START + 1, 'k')).resolves.toBe('rejected');
    expect(firebaseMock.calls).toEqual([]);
  });
});

describe('§9.1 sync and the daily grant', () => {
  it('adopts the stored balance from users/{uid}.wallet', async () => {
    firebaseMock.docs['users/alice'] = { streak: 2, wallet: { coins: 1234, rev: 9 } };
    await syncWallet();
    expect(useWalletStore.getState()).toMatchObject({ coins: 1234, rev: 9 });
  });

  it('shows starting_coin_balance until the server has materialised a wallet', async () => {
    firebaseMock.docs['users/alice'] = { streak: 2 };
    await syncWallet();
    expect(useWalletStore.getState().coins).toBeNull();
    expect(balance()).toBe(START);
  });

  it('re-syncs when a Remote Config fetch lands (flag_economy arrives with it)', async () => {
    useConfigStore.setState({ snapshot: { ...D } });
    const stop = watchWalletSync();
    firebaseMock.docs['users/alice'] = { wallet: { coins: 42, rev: 3 } };
    useConfigStore.getState().applySnapshot({ flag_economy: true }, 1);
    await flush();
    expect(useWalletStore.getState().coins).toBe(42);
    stop();
  });

  it('adopts the balance a daily submission returned and fires coins_earned once', () => {
    const result: SubmitResult = {
      date: '2026-09-29',
      score: 300,
      status: 'lost',
      moves: 20,
      streak: 1,
      streakGranted: true,
      countsForPercentile: true,
      percentile: null,
      coinsGranted: 50,
      wallet: { coins: 550, rev: 1 },
    };
    applyAcceptedDaily(result);
    applyAcceptedDaily(result);
    expect(useWalletStore.getState().coins).toBe(550);
    expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'coins_earned')).toEqual([
      ['coins_earned', { source: 'daily_complete', amount: 50 }],
    ]);
  });
});
