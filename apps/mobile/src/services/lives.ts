import type { GameState } from '@blockmanor/engine';
import { FIRST_POST_FTUE_LEVEL, getLevel } from '@blockmanor/content';
import { useConfigStore } from '../state/useConfigStore';
import { selectLives, useLivesStore, type LivesRules } from '../state/useLivesStore';
import { track } from './analytics';
import { onReconnect } from './connectivity';
import { spendCoins } from './wallet';

/**
 * §9.2 lives client. Gated on `flag_economy` (§0 v1.41(f)): with the flag off
 * no life is ever taken and no level is ever refused.
 *
 * The life path is reachable ONLY from a campaign level run: every entry
 * checks `config.mode === 'level'` on the engine's own state, so Endless and
 * the Daily Board never consume lives (§9.2) even if a future caller wires
 * one in by mistake.
 */

const livesOn = (): boolean => useConfigStore.getState().value('flag_economy');

export function livesRules(): LivesRules {
  const config = useConfigStore.getState();
  return { max: config.value('lives_max'), regenMs: config.value('life_regen_minutes') * 60_000 };
}

/** Post-FTUE campaign levels only: L1–L5 are onboarding, not economy (§0 v1.41(c)). */
const costsLives = (state: GameState): boolean =>
  livesOn() &&
  state.config.mode === 'level' &&
  (state.config.level?.id ?? 0) >= FIRST_POST_FTUE_LEVEL;

/**
 * §9.2 "-1 on level FAIL (not on a quit before `life_forfeit_min_moves`)".
 * Called on every state change of a level run: the life is forfeit once the
 * run DIES or reaches the threshold, and `lifeOnWin` refunds it. So a fail, a
 * quit, a restart and an app kill past the threshold all cost exactly one, a
 * quick abandon costs nothing, and a win costs nothing (§0 v1.41(b)).
 */
export function forfeitLife(state: GameState, runKey: string, now: number): void {
  if (!costsLives(state)) return;
  useLivesStore.getState().settle(now, livesRules());
  const threshold = useConfigStore.getState().value('life_forfeit_min_moves');
  if (state.status !== 'lost' && state.placements < threshold) return;
  useLivesStore.getState().forfeit(runKey, now, livesRules());
}

/** A won run gets its life back; winning a chapter's LAST level refills (§9.2, §0 v1.41(d)). */
export function lifeOnWin(state: GameState, runKey: string, now: number): void {
  if (!costsLives(state) || !state.config.level) return;
  const store = useLivesStore.getState();
  store.refund(runKey, now, livesRules());
  const { id, chapter } = state.config.level;
  if (getLevel(id + 1)?.chapter !== chapter) store.refill();
}

/**
 * The out-of-lives gate for starting a run of `levelId`. False — and §14
 * `life_blocked` — when the player has no life to stake.
 *
 * DORMANT: this PR is ledger + primitives only (§0 v1.42(a)). NOTHING in the
 * app calls this yet — no Home CTA, map, Next, Retry or restart is gated —
 * because the out-of-lives sheet it must route to has no §16.1 name and is
 * not built; gating with nothing to show is a §12.9 dead end. The wiring
 * lands with that sheet in the follow-up PR named in §0 v1.42(a).
 */
export function canStartLevel(levelId: number, now: number): boolean {
  if (!livesOn() || levelId < FIRST_POST_FTUE_LEVEL) return true;
  if (selectLives(useLivesStore.getState(), now, livesRules()).lives > 0) return true;
  track('life_blocked', {});
  return false;
}

export type RefillOutcome = 'refilled' | 'full' | 'rejected' | 'pending';

async function settleRefill(replay: boolean): Promise<RefillOutcome> {
  const pending = useLivesStore.getState().pendingRefill;
  if (!pending) return 'rejected';
  const outcome = await spendCoins('life_refill', pending.amount, pending.key, replay);
  if (outcome === 'failed') return 'pending'; // kept: replayed on reconnect
  const store = useLivesStore.getState();
  store.setPendingRefill(null);
  if (outcome === 'rejected') return 'rejected';
  store.refill();
  return 'refilled';
}

/**
 * §9.2 "Refill 🪙" at `life_refill_price`, through §9.1 `spendCoins`. The
 * intent (key + amount) is persisted BEFORE the call, so a charge whose answer
 * is lost is replayed with the same key and still yields its lives — the
 * server never takes the coins twice. `pending` = no answer yet; the UI shows
 * a retry, §12.8. `rejected` with enough shown coins is a server no.
 *
 * DORMANT like `canStartLevel`: its real caller is the out-of-lives sheet's
 * "Refill" button, in the same follow-up PR (§0 v1.42(a)).
 */
export async function buyLifeRefill(now: number): Promise<RefillOutcome> {
  if (!livesOn()) return 'rejected';
  const store = useLivesStore.getState();
  if (store.pendingRefill) return settleRefill(true);
  if (selectLives(store, now, livesRules()).lives >= livesRules().max) return 'full';
  store.setPendingRefill({
    key: `life_refill:${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    amount: useConfigStore.getState().value('life_refill_price'),
  });
  return settleRefill(false);
}

/**
 * Resolves a refill whose answer was lost. If lives regenerated to full in the
 * meantime the intent is dropped unsent, never charged fresh.
 *
 * TODO(§0 v1.42(a) follow-up gate+sheet PR): in that full case a charge that
 * DID land is not compensated (lost response AND a full regen before
 * reconnect). Unreachable while `buyLifeRefill` has no caller; the PR that
 * gives it one must close this gap — e.g. replay anyway and, on
 * `applied: false`, credit the coins back or bank the refill.
 */
export async function flushPendingRefill(now: number): Promise<RefillOutcome | null> {
  const store = useLivesStore.getState();
  if (!livesOn() || !store.pendingRefill) return null;
  if (selectLives(store, now, livesRules()).lives >= livesRules().max) {
    store.setPendingRefill(null);
    return 'full';
  }
  return settleRefill(true);
}

/**
 * App-lifetime: persist a clock-set-backwards restart at launch (§0 v1.41(e)),
 * then resolve a lost refill now, when Remote Config lands, and on reconnect.
 */
export function watchLivesSync(): () => void {
  useLivesStore.getState().settle(Date.now(), livesRules());
  const flush = () => void flushPendingRefill(Date.now());
  flush();
  const stopConfig = useConfigStore.subscribe((s, prev) => {
    if (s.fetchedAt !== prev.fetchedAt) flush();
  });
  const stopReconnect = onReconnect(flush);
  return () => {
    stopConfig();
    stopReconnect();
  };
}
