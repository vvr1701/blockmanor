import { reliefClear, type GameState } from '@blockmanor/engine';
import { useConfigStore } from '../state/useConfigStore';
import {
  selectSecondChanceLeft,
  useContinueStore,
  type PendingContinue,
} from '../state/useContinueStore';
import { spendCoins, type SpendOutcome } from './wallet';

/**
 * §9.4 fail -> continue flow, client half. The engine half (`reliefClear`,
 * pure and already audited) is `@blockmanor/engine`'s; everything here is
 * pricing, caps, the dry-run gate, and the money-path plumbing that reuses
 * `services/wallet.ts`'s `spendCoins`.
 */

const economyOn = (): boolean => useConfigStore.getState().value('flag_economy');

/**
 * §0 v1.38(iii): "a continue is offered only if it revives". `reliefClear`'s
 * OWN refusal rules (not `'lost'`, no unmet goal, Endless/Daily's `mode`,
 * FTUE's fixed `pieceSequence`, a non-positive count) are exactly §9.4's
 * offer gate too — never Endless, never the Daily Board, never FTUE, never a
 * board that stays dead — so catching every `IllegalMoveError` as "no" is the
 * WHOLE gate, not a partial one. Pure: never mutates `state`, never persists.
 */
export function reliefWouldRevive(state: GameState, cells: number): boolean {
  try {
    return reliefClear(state, cells).state.status !== 'lost';
  } catch {
    return false;
  }
}

type PriceTierKey = 'continue_price_1' | 'continue_price_2' | 'continue_price_3';

/**
 * §9.4 step 2: the price of the NEXT paid continue this attempt, from the
 * tier keys (§9.1) — never a literal. `continuesUsed` is 0-indexed (how many
 * paid continues this attempt has already spent); only 3 tiers exist, so a
 * `continue_max_per_attempt` configured above 3 (default 3) clamps at tier 3
 * rather than reading an undefined 4th key.
 */
export function continuePrice(continuesUsed: number): number {
  const tier = Math.min(continuesUsed + 1, 3);
  const key = `continue_price_${tier}` as PriceTierKey;
  return useConfigStore.getState().value(key);
}

/** §9.4 step 2 / §0 v1.45(b): Continue is offered at all only below the cap —
 * and (v1.45(b)) so is Second chance once this attempt has spent it. */
export function continuesExhausted(continuesUsed: number): boolean {
  return continuesUsed >= useConfigStore.getState().value('continue_max_per_attempt');
}

/** §9.4 "Second chance 📺 free", capped by `second_chance_daily_cap` per UTC
 * day across all levels (§0 v1.39(a)) — a SEPARATE counter from the lives
 * store's `adLives` cap. §0 v1.45(d): grants immediately on tap — §10.1's
 * rewarded-ad SDK is not wired into this codebase yet, so there is no real ad
 * view to gate behind; swap this for a real rewarded-ad completion once §10.1
 * lands. */
export function claimSecondChance(now: number): boolean {
  if (!economyOn()) return false;
  const cap = useConfigStore.getState().value('second_chance_daily_cap');
  return useContinueStore.getState().grantSecondChance(now, cap);
}

export function secondChanceAvailable(now: number): boolean {
  if (!economyOn()) return false;
  const cap = useConfigStore.getState().value('second_chance_daily_cap');
  return selectSecondChanceLeft(useContinueStore.getState(), now, cap) > 0;
}

async function settleContinue(replay: boolean): Promise<SpendOutcome> {
  const pending = useContinueStore.getState().pendingContinue;
  if (!pending) return 'rejected';
  const outcome = await spendCoins('continue', pending.amount, pending.key, replay);
  if (outcome === 'failed') return 'failed'; // kept, replayed later
  useContinueStore.getState().setPendingContinue(null);
  return outcome;
}

/**
 * §9.4 paid Continue spend — the SAME persist-before-call / replay-on-
 * reconnect pattern as `services/lives.ts`'s `buyLifeRefill`: the intent (key
 * + amount) is persisted BEFORE the network call, so a lost answer is
 * replayed with the SAME key rather than risking a second charge. `runKey` is
 * §9.2's own run identity (`LevelSession`'s `levelRunSeed`).
 *
 * Unlike a life refill, this caller must NOT apply its grant optimistically:
 * `reliefClear` mutates the board irreversibly (cleared cells, a fresh tray),
 * and there is no inverse to roll it back if a spend turns out rejected —
 * only a numeric wallet balance can roll back cleanly. So the caller awaits
 * this before ever touching the engine (`LevelSession`'s `applyContinueGrant`
 * runs only on `'spent'`). A `'failed'` (offline/server-fault) answer leaves
 * the intent pending and `continueBusy` cleared — the player's own re-tap of
 * "Continue" is the retry, and it replays the SAME key via the
 * `pendingContinue?.runKey === runKey` branch below rather than minting a
 * new one, so nothing is ever charged twice.
 *
 * DELIBERATELY NO background flush (§0 v1.46, a qa-prd-auditor finding): an
 * earlier version of this file replayed any pending continue on reconnect or
 * RC fetch, including the CURRENT run's — a `'spent'` answer arriving that
 * way clears the intent without ever telling `LevelSession`, so the board
 * stays dead and the player's next tap mints a fresh key and pays again.
 * Unlike a life refill (`lives.ts`'s `flushPendingRefill`), a lost continue
 * answer has no later moment where it can still be delivered — the revive it
 * would grant is this fail screen, right now — so there is nothing a
 * background flush could correctly do with it. A pending intent for a run
 * that's gone (the player relaunched, or a NEW continue overwrites it below)
 * is simply abandoned, never settled: if that charge in fact landed
 * server-side, it is spent and not compensated — the same known, accepted
 * shape as v1.41(g)'s refill corner, just with no follow-up PR to close it,
 * because (per the paragraph above) there is no reachable moment to close it
 * in.
 */
export async function buyContinue(
  amount: number,
  runKey: string,
  now: number,
): Promise<SpendOutcome> {
  if (!economyOn()) return 'rejected';
  const store = useContinueStore.getState();
  if (store.pendingContinue?.runKey === runKey) return settleContinue(true);
  const pending: PendingContinue = {
    key: `continue:${runKey}-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    amount,
    runKey,
  };
  store.setPendingContinue(pending);
  return settleContinue(false);
}
