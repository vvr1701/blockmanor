import type { GameState } from '@blockmanor/engine';
import { FIRST_POST_FTUE_LEVEL, getLevel } from '@blockmanor/content';
import { useConfigStore } from '../state/useConfigStore';
import { selectLives, useLivesStore, type LivesRules } from '../state/useLivesStore';
import { track } from './analytics';
import { onReconnect } from './connectivity';
import { trustedNow } from './trustedClock';
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
 * Side-effect-free half of the out-of-lives gate — no `track` call, so a
 * caller that needs the gate's ANSWER without its ANALYTICS (§0 v1.48(e):
 * `LevelSession` reads this during render, to decide what to paint on the
 * very first frame of a blocked run, before the authoritative `canStartLevel`
 * call in its effect fires `life_blocked`) can call this instead without
 * double-counting or miscounting refusals.
 */
export function hasLifeFor(levelId: number, now: number): boolean {
  return (
    !livesOn() ||
    levelId < FIRST_POST_FTUE_LEVEL ||
    selectLives(useLivesStore.getState(), now, livesRules()).lives > 0
  );
}

/**
 * The out-of-lives gate for starting a run of `levelId`. False — and §14
 * `life_blocked` — when the player has no life to stake. Wired at the single
 * `LevelSession` run-start choke point (§0 v1.47(b)), covering Home CTA, map,
 * Next, Retry and restart.
 */
export function canStartLevel(levelId: number, now: number): boolean {
  if (hasLifeFor(levelId, now)) return true;
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
 * Real caller: `OutOfLivesSheet`'s "Refill" button, via `LevelSession`
 * (§0 v1.47(c)). A caller with a pending intent already set must call this
 * (or `flushPendingRefill`) directly rather than re-checking the shown
 * balance first — §9.2's acceptance requires a lost answer to replay "even
 * when the balance has fallen below it", and this function's own
 * `pendingRefill` branch already does that unconditionally.
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
 * Resolves a refill whose answer was lost. If lives regenerated to full in
 * the meantime the intent is dropped unsent, never charged fresh.
 *
 * §0 v1.47(d) tried replacing this with an unconditional replay, reasoned as
 * "idempotent and cheap, so there's no downside" — WRONG, caught by
 * qa-prd-auditor review before merge: the server can't tell "this key was
 * never sent" from "this key was sent and the answer was lost" (both are the
 * SAME idempotency-keyed request from the server's point of view), so an
 * unconditional replay charges the common case too — an offline Refill tap
 * that never reached the network at all, with lives then regenerating to
 * full before reconnect — directly violating §9.2's "never charges a full
 * player" acceptance clause. That is a common, real bug; the gap this
 * short-circuit leaves (a charge that DID land, answer lost, full before
 * reconnect — never found out about, never compensated) is rarer and lower
 * stakes. Reverted to the original safe behavior.
 *
 * STILL OPEN (§0 v1.41(g), unclosed — v1.47(d)'s "closed" claim retracted):
 * closing it for real needs a server primitive that can answer "was this key
 * ever applied?" WITHOUT attempting a fresh spend when it wasn't (today's
 * `spendCoins` only distinguishes those two cases by actually spending) — a
 * backend change, out of this client-only PR's scope. Flagged, not guessed.
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
 * Uses `trustedNow` (§0 v1.43), not the raw wall clock, so a forward-jumped
 * clock can't mint regen here either.
 */
export function watchLivesSync(): () => void {
  useLivesStore.getState().settle(trustedNow(), livesRules());
  const flush = () => void flushPendingRefill(trustedNow());
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
