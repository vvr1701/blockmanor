/**
 * §9.1 coin wallet — the contract the `grantCoins` / `spendCoins` callables and
 * the app share (§4.2: one copy, imported by both sides).
 *
 * Server-authoritative (§4.4, §9.1): the balance lives at `users/{uid}.wallet`
 * and only Cloud Functions write it. Every mutation carries an idempotency key
 * and leaves one ledger row at `users/{uid}/walletTx/{key}`, created in the
 * same transaction as the balance change — the same `create()`-as-guard
 * primitive §8.3's play-start uses for attempts.
 *
 * What the CLIENT may ask for is deliberately narrower than what the wallet can
 * do. A grant request names an EVENT (a level id and its stars, a chest level),
 * never an amount: the server prices it from Remote Config and derives the key
 * itself, so a forged call can at most replay an event, and each event pays
 * once. `daily_complete` is not client-requestable at all — `dailySubmit` grants
 * it inside its own transaction from the re-simulated run (§8.5). Rewarded ads
 * (§10.1) and IAP (§10.3) credit through server-side verification callbacks
 * that call the same server primitive; they are never client-granted.
 */

import { z } from 'zod';

export const WALLET_TX_SUBCOLLECTION = 'walletTx';

/** The stored balance. `rev` increments once per applied mutation, so the app
 * can ignore a response older than one it has already applied. */
export interface WalletState {
  coins: number;
  rev: number;
}

/** §9.1 sources built in this subsection (§14 `coins_earned.source`). §10.1/§10.3
 * add theirs with their own server-side callbacks. */
export type CoinSource = 'level_win' | 'chest' | 'daily_complete';

/** §9.1 sinks. No caller yet: §9.4 continue, §9.3 boosters, §9.2 life refill. */
export type CoinSink = 'continue' | 'booster' | 'life_refill';

/** §9.1 level win: `coins_level_win_base + coins_per_star × stars`. */
export const levelWinCoins = (base: number, perStar: number, stars: number): number =>
  base + perStar * stars;

export const grantRequestSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('level_win'),
    levelId: z.number().int().min(1),
    /** A win is at least one star (§7.5); three is the ceiling (§6.6). */
    stars: z.number().int().min(1).max(3),
  }),
  z.object({ source: z.literal('chest'), chestLevel: z.number().int().min(1) }),
]);
export type GrantRequest = z.infer<typeof grantRequestSchema>;

/**
 * The idempotency key for a grant. Derived from the event, never supplied by
 * the client, so each event pays once: one win per level (§7.10 specs no
 * replay), one payout per chest. Shared so the app keys its retry queue by the
 * very id the server dedupes on.
 */
export const grantKey = (req: GrantRequest): string =>
  req.source === 'level_win' ? `level_win:${req.levelId}` : `chest:${req.chestLevel}`;

/** `dailySubmit`'s grant key: one payout per board. */
export const dailyGrantKey = (date: string): string => `daily_complete:${date}`;

/** Firestore document ids forbid `/`; the charset keeps keys greppable. */
const CLIENT_KEY = /^[A-Za-z0-9_.:-]{1,100}$/;

export const spendRequestSchema = z.object({
  sink: z.enum(['continue', 'booster', 'life_refill']),
  /** Positive: a zero or negative spend would be a free grant. */
  amount: z.number().int().min(1).max(1_000_000),
  idempotencyKey: z.string().regex(CLIENT_KEY),
});
export type SpendRequest = z.infer<typeof spendRequestSchema>;

/** Namespaced so a client-chosen spend key can never occupy a grant's key. */
export const spendKey = (idempotencyKey: string): string => `spend:${idempotencyKey}`;

export interface WalletResult extends WalletState {
  /** The ledger row's amount — what this key paid or cost. */
  amount: number;
  /** false = the key was already applied; the balance is current, nothing moved. */
  applied: boolean;
}

/** Distinct `HttpsError.details.reason` values, so the client can route each. */
export type WalletRejection =
  /** `flag_economy` is off server-side. */
  | 'economy-disabled'
  /** The level or chest does not exist. */
  | 'unknown-event'
  | 'insufficient-funds'
  /** The key was already used for a different mutation. */
  | 'key-conflict';
