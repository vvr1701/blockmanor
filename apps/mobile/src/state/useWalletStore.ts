import type { GrantRequest, WalletState } from '@blockmanor/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from './persist';

/**
 * §9.1 wallet, client side: a CACHE of the server balance plus optimistic
 * deltas on top of it (§4.4 — the server is authoritative for coin balance).
 *
 * Shown balance = last server balance + unconfirmed grants − in-flight spends.
 * A grant is persisted until the server answers for good, so a level won
 * offline pays once the network is back (§12.4) — its key is the server's own
 * idempotency key, so a retry can never pay twice. A server REJECTION drops it
 * (the rollback). Spends are never persisted: they either confirm or release.
 */
export interface PendingGrant {
  request: GrantRequest;
  /** The client's estimate from its RC snapshot; the server's price replaces it. */
  amount: number;
}

interface WalletStoreState {
  /** Last server-reported balance; null until the server has reported one. */
  coins: number | null;
  rev: number;
  pending: Record<string, PendingGrant>;
  held: number;
  /** Adopt a server balance, unless it is older than one already adopted. */
  applyServer: (wallet: WalletState) => void;
  addPending: (key: string, grant: PendingGrant) => void;
  /** Drop `key` (confirmed or rejected) and adopt `wallet` if given — one update, so the display never double-counts. */
  settle: (key: string, wallet?: WalletState) => void;
  hold: (amount: number) => void;
  release: (amount: number, wallet?: WalletState) => void;
}

const adopt = (state: WalletStoreState, wallet?: WalletState) =>
  wallet && wallet.rev >= state.rev ? { coins: wallet.coins, rev: wallet.rev } : {};

export const useWalletStore = create<WalletStoreState>()(
  persist(
    (set) => ({
      coins: null,
      rev: 0,
      pending: {},
      held: 0,
      applyServer: (wallet) => set((s) => adopt(s, wallet)),
      addPending: (key, grant) => set((s) => ({ pending: { ...s.pending, [key]: grant } })),
      settle: (key, wallet) =>
        set((s) => {
          const { [key]: _settled, ...pending } = s.pending;
          return { pending, ...adopt(s, wallet) };
        }),
      hold: (amount) => set((s) => ({ held: s.held + amount })),
      release: (amount, wallet) => set((s) => ({ held: s.held - amount, ...adopt(s, wallet) })),
    }),
    {
      name: 'wallet',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      // In-flight spends die with the process; the server balance is the truth.
      partialize: ({ coins, rev, pending }) => ({ coins, rev, pending }),
    },
  ),
);

/**
 * The balance to show. `startingBalance` is `starting_coin_balance` from the RC
 * snapshot: a wallet the server has not materialised yet IS that balance (the
 * server creates it lazily at the same default).
 *
 * ponytail: a grant the server applied whose response was lost is counted in
 * both `coins` and `pending` until the next flush settles it.
 */
export function selectBalance(
  state: Pick<WalletStoreState, 'coins' | 'pending' | 'held'>,
  startingBalance: number,
): number {
  const pending = Object.values(state.pending).reduce((sum, g) => sum + g.amount, 0);
  return (state.coins ?? startingBalance) + pending - state.held;
}
