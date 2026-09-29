/**
 * §9.1 coin wallet — the only code that writes `users/{uid}.wallet`.
 *
 * Shape borrowed from §8.3/§8.5, not invented: the callable body takes the
 * clock injected (`grantCoinsFor`, `spendCoinsFor`), the `onCall` wrapper does
 * auth and nothing else, rejections carry `details.reason`, and the idempotency
 * guard is a ledger document read INSIDE the same transaction that moves the
 * balance, so two racing calls with one key cannot both apply.
 *
 * `firestore.rules` denies every client write under `users/{uid}`, so these
 * callables (Admin SDK) are the whole write surface. Future server-verified
 * sources — AdMob SSV (§10.1), RevenueCat webhooks (§10.3) — call
 * `mutateWallet` directly with their own keys; they are never client-callable.
 */

import { CHEST_LEVELS, FIRST_POST_FTUE_LEVEL, MAX_LEVEL_ID } from '@blockmanor/content';
import {
  REMOTE_CONFIG_DEFAULTS,
  USERS_COLLECTION,
  WALLET_TX_SUBCOLLECTION,
  grantKey,
  grantRequestSchema,
  isWithinBounds,
  levelWinCoins,
  spendKey,
  spendRequestSchema,
  type CoinSink,
  type CoinSource,
  type WalletRejection,
  type WalletResult,
  type WalletState,
} from '@blockmanor/shared';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const ECONOMY_NUMBERS = [
  'starting_coin_balance',
  'coins_level_win_base',
  'coins_per_star',
  'coins_chest',
  'coins_daily_complete',
] as const;

export type EconomyConfig = Record<(typeof ECONOMY_NUMBERS)[number], number> & {
  /** §13 `flag_economy`. */
  enabled: boolean;
};

/**
 * The §9.1 `[RC]` values plus `flag_economy`, live, bounds-checked per key,
 * falling back to the §13 registry default (CLAUDE.md rule 3 — no literal
 * here). Never throws: a Remote Config outage degrades to defaults.
 *
 * ponytail: one template fetch per call, like `streak.ts`/`push.ts`. Cache the
 * evaluated template per instance for a minute if RC latency shows up in p95.
 */
export async function readEconomyConfig(): Promise<EconomyConfig> {
  const config: EconomyConfig = {
    enabled: REMOTE_CONFIG_DEFAULTS.flag_economy,
    starting_coin_balance: REMOTE_CONFIG_DEFAULTS.starting_coin_balance,
    coins_level_win_base: REMOTE_CONFIG_DEFAULTS.coins_level_win_base,
    coins_per_star: REMOTE_CONFIG_DEFAULTS.coins_per_star,
    coins_chest: REMOTE_CONFIG_DEFAULTS.coins_chest,
    coins_daily_complete: REMOTE_CONFIG_DEFAULTS.coins_daily_complete,
  };
  try {
    const template = await getRemoteConfig().getServerTemplate({
      defaultConfig: { ...REMOTE_CONFIG_DEFAULTS },
    });
    const values = template.evaluate();
    // `getSource() === 'remote'` is the only proof the console set the key;
    // `asNumber()` renders an unparseable value as 0, hence the bounds.
    const flag = values.getValue('flag_economy');
    if (flag.getSource() === 'remote') config.enabled = flag.asBoolean();
    for (const key of ECONOMY_NUMBERS) {
      const value = values.getValue(key);
      if (value.getSource() !== 'remote') continue;
      const n = value.asNumber();
      if (isWithinBounds(key, n)) config[key] = n;
      else logger.error('wallet: Remote Config value out of bounds, using §13 default', { key, n });
    }
  } catch (error) {
    logger.warn('wallet: Remote Config unreadable, using §13 defaults', { error });
  }
  return config;
}

const reject = (reason: WalletRejection, message: string): HttpsError =>
  new HttpsError('failed-precondition', message, { reason });

/**
 * The stored balance, or the §9.1 new-player balance when none exists yet.
 * Materialised lazily on first mutation, so Stage-1 players need no backfill.
 * A present-but-malformed wallet is a server bug and must never be silently
 * "repaired" to the starting balance.
 */
export function currentWallet(stored: unknown, startingBalance: number): WalletState {
  if (stored === undefined) return { coins: startingBalance, rev: 0 };
  const { coins, rev } = (stored ?? {}) as { coins?: unknown; rev?: unknown };
  const whole = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
  if (whole(coins) && whole(rev)) return { coins, rev };
  logger.error('wallet: stored wallet is malformed', { stored });
  throw new HttpsError('internal', 'Wallet is unreadable');
}

export type WalletMutation =
  | { kind: 'grant'; source: CoinSource; amount: number }
  | { kind: 'spend'; sink: CoinSink; amount: number };

/** The ledger row for `walletTx/{key}`. */
export const ledgerRow = (m: WalletMutation, after: WalletState, now: number) => ({
  ...m,
  coinsAfter: after.coins,
  rev: after.rev,
  at: new Date(now).toISOString(),
});

/** The balance after `m`, or null when a spend would take it below zero. */
export function applyMutation(current: WalletState, m: WalletMutation): WalletState | null {
  const coins = current.coins + (m.kind === 'grant' ? m.amount : -m.amount);
  return coins < 0 ? null : { coins, rev: current.rev + 1 };
}

/** Same key replayed for the same thing? A grant's amount may legitimately
 * differ on retry (an RC change in between), a spend's may not. */
function sameMutation(prior: DocumentData, m: WalletMutation): boolean {
  if (m.kind === 'grant') return prior['kind'] === 'grant' && prior['source'] === m.source;
  return prior['kind'] === 'spend' && prior['sink'] === m.sink && prior['amount'] === m.amount;
}

/**
 * The one server primitive. Idempotent on `key`: a replay of an applied key
 * returns the CURRENT balance with `applied: false` and moves nothing.
 */
export async function mutateWallet(
  uid: string,
  key: string,
  m: WalletMutation,
  startingBalance: number,
  now: number,
): Promise<WalletResult> {
  const db = getFirestore();
  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const txRef = userRef.collection(WALLET_TX_SUBCOLLECTION).doc(key);
  const result = await db.runTransaction(async (tx) => {
    // THE idempotency guard: read inside the transaction, so a racing loser is
    // retried by Firestore and then sees the winner's row.
    const prior = await tx.get(txRef);
    const current = currentWallet((await tx.get(userRef)).get('wallet'), startingBalance);
    const priorData = prior.data();
    if (priorData) {
      if (!sameMutation(priorData, m)) {
        throw reject('key-conflict', 'That idempotency key was used for something else');
      }
      return { ...current, amount: priorData['amount'] as number, applied: false };
    }
    const after = applyMutation(current, m);
    if (!after) throw reject('insufficient-funds', 'Not enough coins');
    tx.set(userRef, { wallet: after }, { merge: true });
    tx.create(txRef, ledgerRow(m, after, now));
    return { ...after, amount: m.amount, applied: true };
  });
  logger.info('wallet: mutation', { uid, key, ...m, ...result });
  return result;
}

/** `grantCoins` body. The client names an event; the server prices and keys it. */
export async function grantCoinsFor(
  uid: string,
  input: unknown,
  now: number,
): Promise<WalletResult> {
  const parsed = grantRequestSchema.safeParse(input);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Malformed grant request');
  const req = parsed.data;
  // FTUE (L1–L5) pays nothing: scripted onboarding, not economy (§9.1, §0 v1.35a).
  const known =
    req.source === 'level_win'
      ? req.levelId >= FIRST_POST_FTUE_LEVEL && req.levelId <= MAX_LEVEL_ID
      : CHEST_LEVELS.includes(req.chestLevel);
  if (!known) throw reject('unknown-event', 'No such level or chest');

  const config = await readEconomyConfig();
  if (!config.enabled) throw reject('economy-disabled', 'The economy is not live');
  const amount =
    req.source === 'level_win'
      ? levelWinCoins(config.coins_level_win_base, config.coins_per_star, req.stars)
      : config.coins_chest;
  return mutateWallet(
    uid,
    grantKey(req),
    { kind: 'grant', source: req.source, amount },
    config.starting_coin_balance,
    now,
  );
}

/**
 * `spendCoins` body — the generic §9.1 sink primitive. No caller in §9.1; §9.4
 * (continue) is the first. The client supplies the amount: overpaying only
 * hurts the caller, and every current sink's item is applied client-side, so
 * an underpaying client gains nothing it could not get by not calling at all.
 * A sink whose item is server-held must price server-side instead.
 */
export async function spendCoinsFor(
  uid: string,
  input: unknown,
  now: number,
): Promise<WalletResult> {
  const parsed = spendRequestSchema.safeParse(input);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Malformed spend request');
  const req = parsed.data;
  const config = await readEconomyConfig();
  if (!config.enabled) throw reject('economy-disabled', 'The economy is not live');
  return mutateWallet(
    uid,
    spendKey(req.idempotencyKey),
    { kind: 'spend', sink: req.sink, amount: req.amount },
    config.starting_coin_balance,
    now,
  );
}

/** §9.1. Auth required — the wallet is per-user. */
export const grantCoins = onCall<unknown>(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required');
  if (getApps().length === 0) initializeApp();
  return grantCoinsFor(request.auth.uid, request.data, Date.now());
});

/** §9.1. Auth required — the wallet is per-user. */
export const spendCoins = onCall<unknown>(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required');
  if (getApps().length === 0) initializeApp();
  return spendCoinsFor(request.auth.uid, request.data, Date.now());
});
