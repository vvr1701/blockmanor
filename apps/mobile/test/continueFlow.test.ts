import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/analytics', () => ({ track: vi.fn() }));

import { REFERENCE_TUNING, getLevel, parseLevel } from '@blockmanor/content';
import { createGame, type GameMode, type GameState } from '@blockmanor/engine';
import { REMOTE_CONFIG_DEFAULTS, type WalletResult } from '@blockmanor/shared';
import {
  buyContinue,
  claimSecondChance,
  continuePrice,
  continuesExhausted,
  reliefWouldRevive,
  secondChanceAvailable,
  watchContinueFlowSync,
} from '../src/services/continueFlow';
import { resetConnectivity } from '../src/services/connectivity';
import { useConfigStore } from '../src/state/useConfigStore';
import { useContinueStore } from '../src/state/useContinueStore';
import { useWalletStore } from '../src/state/useWalletStore';
import { firebaseMock, resetFirebaseMock } from './mocks/react-native-firebase';

/**
 * §9.4 continue-flow client service. The engine half (`reliefClear`) is
 * audited in `packages/engine/test/reliefClear.test.ts` (1,000-game fuzz,
 * corpus `d1d4ef03`) — these tests pin what the CLIENT does with it: the dry
 * run as the whole offer gate, pricing, the two independent caps (§0
 * v1.39(a)/v1.45(b)), and the money-path spend against the wallet mock.
 */

const D = REMOTE_CONFIG_DEFAULTS;
const T0 = Date.UTC(2026, 8, 29, 12);
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A real `'lost'` level-12 run (goals: 2 crate, 2 chain, §9.1/§9.2's own
 * fixture level) — its prefill leaves most of the 8×8 board empty, so the
 * dry run genuinely revives, same as the engine's own fuzz finds for the
 * overwhelming majority of dead boards (v1.38(iii)'s "1,819/1,819 revived"). */
function lostLevelRun(levelId = 12): GameState {
  const json = getLevel(levelId);
  if (!json) throw new Error(`no level ${levelId}`);
  const state = createGame(
    { mode: 'level', tuning: REFERENCE_TUNING, level: parseLevel(json) },
    's',
  );
  return { ...state, status: 'lost' };
}

const modeRun = (mode: GameMode): GameState => ({
  ...lostLevelRun(),
  config: { ...lostLevelRun().config, mode },
});

const served = (amount: number, applied = true): WalletResult => ({
  coins: 5_000 - amount,
  rev: 1,
  amount,
  applied,
});
const rejection = (reason: string) =>
  Object.assign(new Error(reason), { code: 'functions/failed-precondition', details: { reason } });
const unavailable = () => Object.assign(new Error('x'), { code: 'functions/unavailable' });

beforeEach(() => {
  resetFirebaseMock();
  resetConnectivity();
  firebaseMock.configured = true;
  firebaseMock.currentUser = { uid: 'alice' };
  useConfigStore.setState({ snapshot: { ...D, flag_economy: true }, fetchedAt: null });
  useWalletStore.setState({ coins: 5_000, rev: 0, pending: {}, held: 0 });
  useContinueStore.setState({ secondChance: { day: '', count: 0 }, pendingContinue: null });
});

describe('§0 v1.38(iii) reliefWouldRevive — reliefClear’s own refusals ARE the offer gate', () => {
  it('revives a genuinely dead level-12 board (goals unmet, plain refuse)', () => {
    expect(reliefWouldRevive(lostLevelRun(), D.relief_clear_cells)).toBe(true);
  });

  it.each<GameMode>(['endless', 'daily'])('never offered on %s (wrong mode)', (mode) => {
    expect(reliefWouldRevive(modeRun(mode), D.relief_clear_cells)).toBe(false);
  });

  it('never offered on a non-lost game', () => {
    expect(reliefWouldRevive({ ...lostLevelRun(), status: 'playing' }, D.relief_clear_cells)).toBe(
      false,
    );
  });

  it('never offered on a fixed-pieceSequence (FTUE) level', () => {
    const state = lostLevelRun();
    expect(
      reliefWouldRevive(
        { ...state, config: { ...state.config, pieceSequence: ['P01'] } },
        D.relief_clear_cells,
      ),
    ).toBe(false);
  });

  it('never offered with no goal unmet', () => {
    const state = lostLevelRun();
    expect(
      reliefWouldRevive(
        { ...state, goals: state.goals.map((g) => ({ ...g, remaining: 0 })) },
        D.relief_clear_cells,
      ),
    ).toBe(false);
  });
});

describe('§9.1 continue pricing (tier keys, never a literal) and §0 v1.45(b) exhaustion', () => {
  it('reads continue_price_1/2/3 by 0-indexed continuesUsed, clamped at tier 3', () => {
    expect(continuePrice(0)).toBe(D.continue_price_1);
    expect(continuePrice(1)).toBe(D.continue_price_2);
    expect(continuePrice(2)).toBe(D.continue_price_3);
    expect(continuePrice(99)).toBe(D.continue_price_3); // clamp — only 3 tiers exist
  });

  it('prices from the LIVE config, not a baked-in default', () => {
    useConfigStore.setState({
      snapshot: { ...D, flag_economy: true, continue_price_1: 1, continue_price_2: 2 },
    });
    expect(continuePrice(0)).toBe(1);
    expect(continuePrice(1)).toBe(2);
  });

  it('exhausted at continue_max_per_attempt, not one past it', () => {
    useConfigStore.setState({
      snapshot: { ...D, flag_economy: true, continue_max_per_attempt: 2 },
    });
    expect(continuesExhausted(0)).toBe(false);
    expect(continuesExhausted(1)).toBe(false);
    expect(continuesExhausted(2)).toBe(true);
  });
});

describe('§0 v1.39(a)/v1.45(b) second-chance cap — independent of continues_used, per UTC day', () => {
  it('grants up to second_chance_daily_cap, then refuses until the next UTC day', () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, second_chance_daily_cap: 2 } });
    expect(secondChanceAvailable(T0)).toBe(true);
    expect(claimSecondChance(T0)).toBe(true);
    expect(secondChanceAvailable(T0)).toBe(true);
    expect(claimSecondChance(T0)).toBe(true);
    expect(secondChanceAvailable(T0)).toBe(false);
    expect(claimSecondChance(T0)).toBe(false);

    const tomorrow = Date.UTC(2026, 8, 30, 0, 0, 1);
    expect(secondChanceAvailable(tomorrow)).toBe(true);
  });

  it('a 0 cap never offers it, even fresh', () => {
    useConfigStore.setState({ snapshot: { ...D, flag_economy: true, second_chance_daily_cap: 0 } });
    expect(secondChanceAvailable(T0)).toBe(false);
  });

  it('does nothing while flag_economy is off', () => {
    useConfigStore.setState({ snapshot: { ...D } });
    expect(secondChanceAvailable(T0)).toBe(false);
    expect(claimSecondChance(T0)).toBe(false);
  });

  it('is a SEPARATE counter from the lives store’s ad-life cap — never touches useLivesStore', async () => {
    const { useLivesStore } = await import('../src/state/useLivesStore');
    useLivesStore.setState({
      missing: 5,
      regenFrom: 0,
      chargedRun: null,
      pendingRefill: null,
      adLives: { day: '', count: 0 },
    });
    claimSecondChance(T0);
    expect(useLivesStore.getState().adLives).toEqual({ day: '', count: 0 });
  });
});

describe('§9.4 buyContinue — persist-before-call / replay-on-reconnect (mirrors services/lives.ts)', () => {
  it('spends continue_price via spendCoins and fires coins_spent once applied', async () => {
    firebaseMock.callables['spendCoins'] = () => served(D.continue_price_1);
    await expect(buyContinue(D.continue_price_1, 'run-1', T0)).resolves.toBe('spent');
    expect(firebaseMock.calls[0]?.data).toMatchObject({
      sink: 'continue',
      amount: D.continue_price_1,
    });
    expect(useContinueStore.getState().pendingContinue).toBeNull();
  });

  it('a lost answer keeps the intent; re-tapping (replay) reuses the SAME key and never double-charges', async () => {
    firebaseMock.callables['spendCoins'] = () => {
      throw unavailable();
    };
    await expect(buyContinue(D.continue_price_1, 'run-1', T0)).resolves.toBe('failed');
    const pending = useContinueStore.getState().pendingContinue;
    expect(pending).toEqual({
      key: expect.stringMatching(/^continue:run-1-/),
      amount: D.continue_price_1,
      runKey: 'run-1',
    });

    firebaseMock.callables['spendCoins'] = () => served(D.continue_price_1, false); // "already applied"
    await expect(buyContinue(D.continue_price_1, 'run-1', T0 + 1)).resolves.toBe('spent');
    expect(firebaseMock.calls.map((c) => c.data)).toEqual([
      { sink: 'continue', amount: D.continue_price_1, idempotencyKey: pending?.key },
      { sink: 'continue', amount: D.continue_price_1, idempotencyKey: pending?.key },
    ]);
    expect(useContinueStore.getState().pendingContinue).toBeNull();
  });

  it('a server rejection clears the intent and charges nothing', async () => {
    firebaseMock.callables['spendCoins'] = () => {
      throw rejection('insufficient-funds');
    };
    await expect(buyContinue(D.continue_price_1, 'run-1', T0)).resolves.toBe('rejected');
    expect(useContinueStore.getState().pendingContinue).toBeNull();
  });

  it('does nothing while flag_economy is off', async () => {
    useConfigStore.setState({ snapshot: { ...D } });
    await expect(buyContinue(D.continue_price_1, 'run-1', T0)).resolves.toBe('rejected');
    expect(firebaseMock.calls).toEqual([]);
  });

  it('a pending continue for a DIFFERENT run mints its own key rather than reusing the stale one', async () => {
    useContinueStore.setState({
      pendingContinue: { key: 'continue:run-1-x', amount: 900, runKey: 'run-1' },
    });
    firebaseMock.callables['spendCoins'] = () => served(D.continue_price_1);
    await buyContinue(D.continue_price_1, 'run-2', T0);
    expect(firebaseMock.calls[0]?.data).toMatchObject({
      idempotencyKey: expect.stringMatching(/^continue:run-2-/),
    });
  });
});

describe('watchContinueFlowSync — settles a stray pending continue (ledger only, never revives)', () => {
  it('replays on reconnect and clears the pending record', async () => {
    useContinueStore.setState({
      pendingContinue: { key: 'continue:run-1-x', amount: 900, runKey: 'run-1' },
    });
    firebaseMock.callables['spendCoins'] = () => served(900, false);
    const stop = watchContinueFlowSync();
    // `onReconnect` only fires on an OFFLINE -> online transition; `beforeEach`
    // already leaves `online: true`, so dip offline first to exercise it.
    const { reportNetworkResult } = await import('../src/services/connectivity');
    reportNetworkResult(false);
    reportNetworkResult(true);
    await flush();
    expect(firebaseMock.calls).toHaveLength(1);
    expect(useContinueStore.getState().pendingContinue).toBeNull();
    stop();
  });

  it('replays when Remote Config lands', async () => {
    useContinueStore.setState({
      pendingContinue: { key: 'continue:run-1-x', amount: 900, runKey: 'run-1' },
    });
    firebaseMock.callables['spendCoins'] = () => served(900, false);
    const stop = watchContinueFlowSync();
    useConfigStore.getState().applySnapshot({ flag_economy: true }, 1);
    await flush();
    expect(firebaseMock.calls).toHaveLength(1);
    stop();
  });
});
