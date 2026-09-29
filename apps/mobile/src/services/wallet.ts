import { getAuth } from '@react-native-firebase/auth';
import { doc, getDoc, getFirestore } from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import {
  USERS_COLLECTION,
  grantKey,
  levelWinCoins,
  type CoinSink,
  type GrantRequest,
  type SpendRequest,
  type WalletRejection,
  type WalletResult,
  type WalletState,
} from '@blockmanor/shared';
import { FIRST_POST_FTUE_LEVEL } from '@blockmanor/content';
import { useConfigStore } from '../state/useConfigStore';
import { selectBalance, useWalletStore } from '../state/useWalletStore';
import { track } from './analytics';
import { onReconnect, reportNetworkResult } from './connectivity';
import { isFirebaseConfigured, recordError } from './firebase';

/**
 * §9.1 wallet client — the `grantCoins` / `spendCoins` callables, optimistic
 * with rollback. Gated on `flag_economy` (§13); with the flag off nothing here
 * touches the network or the store.
 */

const REJECTIONS: readonly WalletRejection[] = [
  'economy-disabled',
  'unknown-event',
  'insufficient-funds',
  'key-conflict',
];

/** A final "no" from the server, as opposed to a fault worth retrying. */
function isRejection(error: unknown): boolean {
  const e = error as { code?: unknown; details?: { reason?: unknown } } | null;
  if (REJECTIONS.includes(e?.details?.reason as WalletRejection)) return true;
  return typeof e?.code === 'string' && e.code.endsWith('invalid-argument');
}

const economyOn = (): boolean => useConfigStore.getState().value('flag_economy');

async function sendGrant(key: string): Promise<void> {
  const grant = useWalletStore.getState().pending[key];
  if (!grant || !isFirebaseConfigured()) return;
  try {
    const call = httpsCallable<GrantRequest, WalletResult>(getFunctions(), 'grantCoins');
    const { data } = await call(grant.request);
    reportNetworkResult(true);
    useWalletStore.getState().settle(key, data);
    // Only a NEWLY applied grant is an earning; a retry of one is not.
    if (data.applied) track('coins_earned', { source: grant.request.source, amount: data.amount });
  } catch (error) {
    if (isRejection(error)) {
      useWalletStore.getState().settle(key); // rollback
      return;
    }
    // Offline, signed-out, server fault: stays pending and is retried.
    recordError(error, 'wallet_grant');
    reportNetworkResult(false);
  }
}

/** Retry every unconfirmed grant. Safe to repeat: the server dedupes on key. */
export async function flushPendingGrants(): Promise<void> {
  await Promise.all(Object.keys(useWalletStore.getState().pending).map(sendGrant));
}

/**
 * §9.1 grant for a level win or a chest. Credited optimistically NOW (the
 * client's RC-snapshot price), confirmed or rolled back by the server.
 */
export function grantCoins(request: GrantRequest): void {
  if (!economyOn()) return;
  // FTUE pays nothing (§9.1); the server refuses it too — this just skips the round-trip.
  if (request.source === 'level_win' && request.levelId < FIRST_POST_FTUE_LEVEL) return;
  const key = grantKey(request);
  const store = useWalletStore.getState();
  if (!store.pending[key]) {
    const config = useConfigStore.getState();
    const amount =
      request.source === 'level_win'
        ? levelWinCoins(
            config.value('coins_level_win_base'),
            config.value('coins_per_star'),
            request.stars,
          )
        : config.value('coins_chest');
    store.addPending(key, { request, amount });
  }
  void flushPendingGrants();
}

/**
 * §9.1 generic spend. No caller in §9.1 — §9.4 continue is the first, and owns
 * `coins_spent`. Resolves true only once the server has taken the coins; the
 * optimistic hold is released either way.
 */
export async function spendCoins(
  sink: CoinSink,
  amount: number,
  idempotencyKey: string,
): Promise<boolean> {
  if (!economyOn() || !isFirebaseConfigured()) return false;
  const store = useWalletStore.getState();
  if (selectBalance(store, useConfigStore.getState().value('starting_coin_balance')) < amount) {
    return false;
  }
  store.hold(amount);
  try {
    const call = httpsCallable<SpendRequest, WalletResult>(getFunctions(), 'spendCoins');
    const { data } = await call({ sink, amount, idempotencyKey });
    reportNetworkResult(true);
    useWalletStore.getState().release(amount, data);
    return true;
  } catch (error) {
    useWalletStore.getState().release(amount); // rollback
    if (!isRejection(error)) {
      recordError(error, 'wallet_spend');
      reportNetworkResult(false);
    }
    return false;
  }
}

/** Flush unconfirmed grants, then adopt the server balance (owner-readable). */
export async function syncWallet(): Promise<void> {
  if (!economyOn() || !isFirebaseConfigured()) return;
  const uid = getAuth().currentUser?.uid;
  if (!uid) return;
  await flushPendingGrants();
  try {
    const snapshot = await getDoc(doc(getFirestore(), `${USERS_COLLECTION}/${uid}`));
    const wallet = (snapshot.exists() ? snapshot.data() : undefined)?.['wallet'] as
      Partial<WalletState> | undefined;
    if (typeof wallet?.coins === 'number' && typeof wallet.rev === 'number') {
      useWalletStore.getState().applyServer({ coins: wallet.coins, rev: wallet.rev });
    }
  } catch (error) {
    recordError(error, 'wallet_read');
  }
}

/**
 * App-lifetime: sync now, when a Remote Config fetch lands (the cold-start
 * `flag_economy` is the compiled default until then), and on every reconnect.
 */
export function watchWalletSync(): () => void {
  void syncWallet();
  const stopConfig = useConfigStore.subscribe((s, prev) => {
    if (s.fetchedAt !== prev.fetchedAt) void syncWallet();
  });
  const stopReconnect = onReconnect(() => void syncWallet());
  return () => {
    stopConfig();
    stopReconnect();
  };
}
