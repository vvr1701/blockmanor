import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/analytics', () => ({ track: vi.fn() }));

import { REFERENCE_TUNING, getLevel, parseLevel } from '@blockmanor/content';
import { createGame, type GameMode, type GameState } from '@blockmanor/engine';
import { REMOTE_CONFIG_DEFAULTS, type WalletResult } from '@blockmanor/shared';
import { track } from '../src/services/analytics';
import { resetConnectivity } from '../src/services/connectivity';
import {
  buyLifeRefill,
  canStartLevel,
  flushPendingRefill,
  forfeitLife,
  lifeOnWin,
  livesRules,
  watchLivesSync,
} from '../src/services/lives';
import { resetTrustedClock, trustedNow } from '../src/services/trustedClock';
import { useConfigStore } from '../src/state/useConfigStore';
import {
  selectAdLivesLeft,
  selectLives,
  settleLives,
  useLivesStore,
} from '../src/state/useLivesStore';
import { useWalletStore } from '../src/state/useWalletStore';
import { resetMockUptime, setMockUptime } from './mocks/device-uptime';
import { firebaseMock, resetFirebaseMock } from './mocks/react-native-firebase';

/**
 * §9.2 lives: client-authoritative (§0 v1.41(a)), so everything but the coin
 * refill is proven here. The refill's server half is §9.1 `spendCoins`, whose
 * replay semantics are pinned against the emulator in backend/functions.
 */

const D = REMOTE_CONFIG_DEFAULTS;
const MAX = D.lives_max;
const PERIOD = D.life_regen_minutes * 60_000;
const T0 = Date.UTC(2026, 8, 29, 12);
const RULES = { max: MAX, regenMs: PERIOD };
const lives = (now = T0) => selectLives(useLivesStore.getState(), now, livesRules()).lives;

function run(levelId: number, patch: Partial<Pick<GameState, 'status' | 'placements'>> = {}) {
  const json = getLevel(levelId);
  if (!json) throw new Error(`no level ${levelId}`);
  const state = createGame(
    { mode: 'level', tuning: REFERENCE_TUNING, level: parseLevel(json) },
    's',
  );
  return { ...state, ...patch };
}
/** Adversarial: an Endless/Daily state that even carries a post-FTUE campaign
 * level, so only the mode itself can exclude it. */
const modeRun = (mode: GameMode, patch: Partial<Pick<GameState, 'status' | 'placements'>>) => ({
  ...run(12, patch),
  config: { ...run(12).config, mode },
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const served = (coins: number, applied = true): WalletResult => ({
  coins,
  rev: 1,
  amount: D.life_refill_price,
  applied,
});
const rejection = (reason: string) =>
  Object.assign(new Error(reason), { code: 'functions/failed-precondition', details: { reason } });
const unavailable = () => Object.assign(new Error('x'), { code: 'functions/unavailable' });

beforeEach(() => {
  vi.mocked(track).mockClear();
  resetFirebaseMock();
  resetConnectivity();
  resetTrustedClock();
  resetMockUptime();
  firebaseMock.configured = true;
  firebaseMock.currentUser = { uid: 'alice' };
  useConfigStore.setState({ snapshot: { ...D, flag_economy: true }, fetchedAt: null });
  useWalletStore.setState({ coins: 5_000, rev: 0, pending: {}, held: 0 });
  useLivesStore.setState({
    missing: 0,
    regenFrom: 0,
    chargedRun: null,
    pendingRefill: null,
    adLives: { day: '', count: 0 },
  });
});

describe('§9.2 regen: +1 per life_regen_minutes, capped at lives_max', () => {
  it('regains one life per full period and stops at the cap', () => {
    const s = { missing: 3, regenFrom: T0 };
    expect(selectLives(s, T0 + PERIOD - 1, RULES)).toEqual({
      lives: MAX - 3,
      nextLifeAt: T0 + PERIOD,
    });
    expect(selectLives(s, T0 + 2 * PERIOD, RULES)).toEqual({
      lives: MAX - 1,
      nextLifeAt: T0 + 3 * PERIOD,
    });
    expect(selectLives(s, T0 + 100 * PERIOD, RULES)).toEqual({ lives: MAX, nextLifeAt: null });
  });

  it('a device clock set backwards restarts the period — it never mints a life', () => {
    expect(settleLives({ missing: 2, regenFrom: T0 }, T0 - 5 * PERIOD, RULES)).toEqual({
      missing: 2,
      regenFrom: T0 - 5 * PERIOD,
    });
  });

  // The single read above cannot see a stall: it must PERSIST, or `regenFrom`
  // stays "in the future" and every later read restarts the period again.
  describe('a backwards clock never stalls regen once the restart is persisted', () => {
    const B = T0 - 5 * PERIOD;

    it('at launch (watchLivesSync)', () => {
      useLivesStore.setState({ missing: 3, regenFrom: T0 });
      const clock = vi.spyOn(Date, 'now').mockReturnValue(B);
      watchLivesSync()();
      clock.mockRestore();
      expect(useLivesStore.getState().regenFrom).toBe(B);
      expect(lives(B + PERIOD - 1)).toBe(MAX - 3);
      expect(lives(B + PERIOD)).toBe(MAX - 2);
      expect(lives(B + 2 * PERIOD)).toBe(MAX - 1);
      expect(lives(B + 3 * PERIOD)).toBe(MAX);
    });

    it('on every forfeitLife report, even below the threshold', () => {
      useLivesStore.setState({ missing: 3, regenFrom: T0 });
      forfeitLife(run(12, { placements: 0 }), 'r1', B);
      forfeitLife(run(12, { placements: 1 }), 'r1', B + PERIOD);
      expect(useLivesStore.getState()).toMatchObject({ missing: 2, regenFrom: B + PERIOD });
      forfeitLife(run(12, { placements: 2 }), 'r1', B + 2 * PERIOD);
      expect(useLivesStore.getState().missing).toBe(1);
      expect(lives(B + 3 * PERIOD)).toBe(MAX);
    });
  });

  it('a lowered lives_max clamps; zero missing is full at any max', () => {
    expect(selectLives({ missing: 4, regenFrom: T0 }, T0, { ...RULES, max: 3 }).lives).toBe(0);
    expect(selectLives({ missing: 0, regenFrom: 0 }, T0, { ...RULES, max: 9 }).lives).toBe(9);
  });

  it('reads lives_max and life_regen_minutes from Remote Config', () => {
    useConfigStore.setState({
      snapshot: { ...D, flag_economy: true, lives_max: 3, life_regen_minutes: 1 },
    });
    expect(livesRules()).toEqual({ max: 3, regenMs: 60_000 });
  });

  it('watchLivesSync credits regen through trustedNow, not the raw wall clock (§0 v1.43/v1.44)', () => {
    useLivesStore.setState({ missing: MAX, regenFrom: T0 });
    let clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    watchLivesSync()();
    clock.mockRestore();

    setMockUptime(5_000); // 5 real seconds pass
    clock = vi.spyOn(Date, 'now').mockReturnValue(T0 + 3 * PERIOD); // clock jumped far forward
    watchLivesSync()();
    clock.mockRestore();

    expect(selectLives(useLivesStore.getState(), trustedNow(), RULES).lives).toBe(0);
  });
});

describe('§9.2 -1 life on FAIL, not on a quit before life_forfeit_min_moves', () => {
  const MIN = D.life_forfeit_min_moves;

  it('a run below the threshold costs nothing (a quick abandon is free)', () => {
    forfeitLife(run(12, { placements: MIN - 1 }), 'r1', T0);
    expect(lives()).toBe(MAX);
  });

  it('reaching the threshold forfeits exactly one life for the run, however often reported', () => {
    for (let p = MIN; p < MIN + 5; p++) forfeitLife(run(12, { placements: p }), 'r1', T0);
    forfeitLife(run(12, { placements: MIN + 5, status: 'lost' }), 'r1', T0);
    expect(lives()).toBe(MAX - 1);
    // The regen timer starts when the first life goes.
    expect(selectLives(useLivesStore.getState(), T0, RULES).nextLifeAt).toBe(T0 + PERIOD);
  });

  it('a fail below the threshold still costs the life', () => {
    forfeitLife(run(12, { placements: 1, status: 'lost' }), 'r1', T0);
    expect(lives()).toBe(MAX - 1);
  });

  it('a win refunds the run’s life; a win of a run that was never charged gives nothing', () => {
    forfeitLife(run(12, { placements: MIN }), 'r1', T0);
    lifeOnWin(run(12, { status: 'won' }), 'r1', T0);
    expect(lives()).toBe(MAX);
    expect(useLivesStore.getState().regenFrom).toBe(0);

    forfeitLife(run(12, { placements: MIN, status: 'lost' }), 'r2', T0);
    lifeOnWin(run(12, { status: 'won' }), 'r3', T0);
    expect(lives()).toBe(MAX - 1);
  });

  it('each run (retry = new run key) costs its own life, down to zero and no further', () => {
    for (let i = 0; i < MAX + 2; i++) {
      forfeitLife(run(12, { placements: 1, status: 'lost' }), `r${i}`, T0);
    }
    expect(lives()).toBe(0);
  });

  it('honours a live life_forfeit_min_moves', () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, life_forfeit_min_moves: 10 } });
    forfeitLife(run(12, { placements: 9 }), 'r1', T0);
    expect(lives()).toBe(MAX);
    forfeitLife(run(12, { placements: 10 }), 'r1', T0);
    expect(lives()).toBe(MAX - 1);
  });
});

describe('§9.2 exclusions', () => {
  it.each<GameMode>(['endless', 'daily'])('%s never consumes a life, even when lost', (mode) => {
    forfeitLife(modeRun(mode, { placements: 40, status: 'lost' }), 'x', T0);
    expect(lives()).toBe(MAX);
  });

  it('FTUE levels (L1–L5) cost no life (§0 v1.41(c))', () => {
    forfeitLife(run(5, { placements: 9, status: 'lost' }), 'x', T0);
    expect(lives()).toBe(MAX);
  });

  it('with flag_economy off nothing is taken and nothing is refused (§0 v1.41(f))', () => {
    useConfigStore.setState({ snapshot: { ...D } });
    forfeitLife(run(12, { placements: 9, status: 'lost' }), 'x', T0);
    expect(lives()).toBe(MAX);
    useLivesStore.setState({ missing: MAX, regenFrom: T0 });
    expect(canStartLevel(12, T0)).toBe(true);
    expect(track).not.toHaveBeenCalled();
  });
});

describe('§9.2 full refill on chapter completion', () => {
  it.each([30, 60])('winning L%s (a chapter’s last level) refills to lives_max', (id) => {
    useLivesStore.setState({ missing: 3, regenFrom: T0 });
    lifeOnWin(run(id, { status: 'won' }), 'r', T0);
    expect(lives()).toBe(MAX);
  });

  it('winning a mid-chapter level does not', () => {
    useLivesStore.setState({ missing: 3, regenFrom: T0 });
    lifeOnWin(run(29, { status: 'won' }), 'r', T0);
    expect(lives()).toBe(MAX - 3);
  });
});

describe('§9.2 out of lives: gate and life_blocked', () => {
  it('refuses a level with 0 lives and fires life_blocked once per refusal', () => {
    useLivesStore.setState({ missing: MAX, regenFrom: T0 });
    expect(canStartLevel(12, T0)).toBe(false);
    expect(vi.mocked(track).mock.calls).toEqual([['life_blocked', {}]]);
  });

  it('lets a regenerated life through without firing', () => {
    useLivesStore.setState({ missing: MAX, regenFrom: T0 });
    expect(canStartLevel(12, T0 + PERIOD)).toBe(true);
    expect(track).not.toHaveBeenCalled();
  });

  it('never gates FTUE', () => {
    useLivesStore.setState({ missing: MAX, regenFrom: T0 });
    expect(canStartLevel(5, T0)).toBe(true);
  });
});

describe('§9.2 "Refill 🪙" at life_refill_price via §9.1 spendCoins', () => {
  beforeEach(() => useLivesStore.setState({ missing: MAX, regenFrom: T0 }));

  it('spends life_refill_price server-side, refills, fires coins_spent once', async () => {
    firebaseMock.callables['spendCoins'] = () => served(5_000 - D.life_refill_price);
    await expect(buyLifeRefill(T0)).resolves.toBe('refilled');
    expect(lives()).toBe(MAX);
    expect(firebaseMock.calls).toHaveLength(1);
    expect(firebaseMock.calls[0]?.data).toMatchObject({
      sink: 'life_refill',
      amount: D.life_refill_price,
    });
    expect(useLivesStore.getState().pendingRefill).toBeNull();
    expect(useWalletStore.getState()).toMatchObject({
      coins: 5_000 - D.life_refill_price,
      held: 0,
    });
    expect(vi.mocked(track).mock.calls).toEqual([
      [
        'coins_spent',
        {
          sink: 'life_refill',
          amount: D.life_refill_price,
        },
      ],
    ]);
  });

  it('prices from the live life_refill_price', async () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, life_refill_price: 123 } });
    firebaseMock.callables['spendCoins'] = () => served(0);
    await buyLifeRefill(T0);
    expect(firebaseMock.calls[0]?.data).toMatchObject({ amount: 123 });
  });

  it('a server rejection refills nothing and clears the intent', async () => {
    firebaseMock.callables['spendCoins'] = () => {
      throw rejection('insufficient-funds');
    };
    await expect(buyLifeRefill(T0)).resolves.toBe('rejected');
    expect(lives()).toBe(0);
    expect(useLivesStore.getState().pendingRefill).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });

  it('does not call the server when the shown balance cannot cover it', async () => {
    useWalletStore.setState({ coins: D.life_refill_price - 1 });
    await expect(buyLifeRefill(T0)).resolves.toBe('rejected');
    expect(firebaseMock.calls).toEqual([]);
  });

  it('does not charge a player who is already full', async () => {
    useLivesStore.setState({ missing: 0, regenFrom: 0 });
    await expect(buyLifeRefill(T0)).resolves.toBe('full');
    expect(firebaseMock.calls).toEqual([]);
  });

  it('a lost answer keeps the intent; the replay reuses key AND amount and delivers the lives', async () => {
    firebaseMock.callables['spendCoins'] = () => {
      throw unavailable();
    };
    await expect(buyLifeRefill(T0)).resolves.toBe('pending');
    const pending = useLivesStore.getState().pendingRefill;
    expect(pending).toEqual({
      key: expect.stringMatching(/^life_refill:/),
      amount: D.life_refill_price,
    });
    expect(lives()).toBe(0);

    // The first call DID land; the server has since synced the lower balance,
    // so the shown balance no longer covers a second spend — the replay must
    // still go out, and the server answers "already applied".
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, life_refill_price: 1 } });
    useWalletStore.setState({ coins: 10 });
    firebaseMock.callables['spendCoins'] = () => served(10, false);
    await expect(flushPendingRefill(T0 + 1)).resolves.toBe('refilled');
    expect(firebaseMock.calls.map((c) => c.data)).toEqual([
      { sink: 'life_refill', amount: D.life_refill_price, idempotencyKey: pending?.key },
      { sink: 'life_refill', amount: D.life_refill_price, idempotencyKey: pending?.key },
    ]);
    expect(lives(T0 + 1)).toBe(MAX);
    expect(useLivesStore.getState().pendingRefill).toBeNull();
    // A replay of an applied spend is not a second spend.
    expect(track).not.toHaveBeenCalled();
  });

  it('a second tap while an intent is pending replays it rather than minting a new key', async () => {
    useLivesStore.setState({ pendingRefill: { key: 'life_refill:k', amount: 900 } });
    firebaseMock.callables['spendCoins'] = () => served(4_100);
    await expect(buyLifeRefill(T0)).resolves.toBe('refilled');
    expect(firebaseMock.calls[0]?.data).toMatchObject({ idempotencyKey: 'life_refill:k' });
  });

  it('resolves a pending intent when Remote Config lands (flag_economy arrives with it)', async () => {
    useConfigStore.setState({ snapshot: { ...D } });
    // watchLivesSync reads the real clock: still out of lives "now".
    useLivesStore.setState({
      regenFrom: Date.now(),
      pendingRefill: { key: 'life_refill:k', amount: 900 },
    });
    firebaseMock.callables['spendCoins'] = () => served(4_100, false);
    const stop = watchLivesSync();
    await flush();
    expect(firebaseMock.calls).toEqual([]); // flag off: untouched
    useConfigStore.getState().applySnapshot({ flag_economy: true }, 1);
    await flush();
    expect(firebaseMock.calls).toHaveLength(1);
    expect(useLivesStore.getState().pendingRefill).toBeNull();
    stop();
  });

  it('drops a pending intent unsent once lives have regenerated to full', async () => {
    useLivesStore.setState({ pendingRefill: { key: 'life_refill:k', amount: 900 } });
    await expect(flushPendingRefill(T0 + MAX * PERIOD)).resolves.toBe('full');
    expect(firebaseMock.calls).toEqual([]);
    expect(useLivesStore.getState().pendingRefill).toBeNull();
  });
});

describe('§9.2 rewarded-ad +1 life, rv_life_daily_cap per UTC day (store only; §10.1 wires the ad)', () => {
  const CAP = D.rv_life_daily_cap;

  it('grants up to the cap, then refuses until the next UTC day', () => {
    useLivesStore.setState({ missing: MAX, regenFrom: T0 });
    // Regen slowed so a day passing does not refill on its own.
    const slow = { max: MAX, regenMs: 7 * 24 * 3_600_000 };
    const grant = (now: number) => useLivesStore.getState().grantAdLife(now, slow, CAP);
    for (let i = 0; i < CAP; i++) expect(grant(T0)).toBe(true);
    expect(grant(T0)).toBe(false);
    expect(useLivesStore.getState().missing).toBe(MAX - CAP);
    const tomorrow = Date.UTC(2026, 8, 30, 0, 0, 1);
    expect(selectAdLivesLeft(useLivesStore.getState(), tomorrow, CAP)).toBe(CAP);
    expect(grant(tomorrow)).toBe(true);
    expect(selectAdLivesLeft(useLivesStore.getState(), tomorrow, CAP)).toBe(CAP - 1);
  });

  it('refuses when already full (an ad must not be wasted)', () => {
    expect(useLivesStore.getState().grantAdLife(T0, RULES, CAP)).toBe(false);
  });
});
