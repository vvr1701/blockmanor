import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from './persist';

/**
 * §9.4 continue-flow client state — two SEPARATE concerns, kept in one small
 * MMKV-persisted store because both are tiny counters with the same
 * "day/count" shape, not because they are the same resource:
 *
 * 1. `secondChance`: the `second_chance_daily_cap` counter (§0 v1.39(a)) — a
 *    free, ad-gated resource capped per UTC day ACROSS ALL LEVELS. Same shape
 *    as `useLivesStore`'s `adLives`, but a genuinely different cap (CLAUDE.md
 *    hand-off note: "don't reuse or conflate the two even though the shape
 *    rhymes") — lives.ts/useLivesStore.ts are a hard boundary for this PR.
 * 2. `pendingContinue`: a paid continue's spend intent, persisted BEFORE the
 *    `spendCoins` call so a lost answer can be replayed with the SAME key —
 *    the exact pattern `services/lives.ts`'s `pendingRefill` already
 *    established (persist-before-call / replay-on-reconnect), not a new one.
 *    Scoped by `runKey` (§9.2's own run identity) because a continue's
 *    "effect" — reviving THIS run — stops making sense once that run is gone
 *    (any app relaunch mints a new `attempt`/`runKey`, §0 v1.17); a stray
 *    pending continue for a dead run is simply settled (never double-charged,
 *    never resurrected) — see `services/continueFlow.ts`'s `watchContinueFlowSync`.
 *
 * `continues_used` and the current price TIER are deliberately NOT here: §0
 * v1.39(b) scopes them to the current attempt, and every attempt (including
 * one resumed after a kill) is a fresh `attempt`/`runKey` (§0 v1.17) — so
 * plain `LevelSession` component state, reset in its existing run-start
 * effect, already satisfies "reset to zero/tier-1 on a new attempt" with no
 * separate persisted counter.
 */

const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

export interface PendingContinue {
  key: string;
  /** Pinned: the server refuses a spend key replayed at a different amount
   * (same discipline as `lives.ts`'s `PendingRefill`). */
  amount: number;
  /** The run this continue would revive; see the class doc above. */
  runKey: string;
}

interface SecondChanceCounter {
  day: string;
  count: number;
}

interface ContinueState {
  secondChance: SecondChanceCounter;
  pendingContinue: PendingContinue | null;
  /** +1 second chance today, capped. False = already at cap. */
  grantSecondChance: (now: number, cap: number) => boolean;
  setPendingContinue: (pending: PendingContinue | null) => void;
}

/** Second chances already used today, under `cap`. */
export function selectSecondChanceLeft(
  s: Pick<ContinueState, 'secondChance'>,
  now: number,
  cap: number,
): number {
  return Math.max(0, cap - (s.secondChance.day === utcDay(now) ? s.secondChance.count : 0));
}

export const useContinueStore = create<ContinueState>()(
  persist(
    (set, get) => ({
      secondChance: { day: '', count: 0 },
      pendingContinue: null,
      grantSecondChance: (now, cap) => {
        if (selectSecondChanceLeft(get(), now, cap) <= 0) return false;
        const day = utcDay(now);
        set((s) => ({
          secondChance: { day, count: (s.secondChance.day === day ? s.secondChance.count : 0) + 1 },
        }));
        return true;
      },
      setPendingContinue: (pendingContinue) => set({ pendingContinue }),
    }),
    {
      name: 'continueFlow',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: ({ secondChance, pendingContinue }) => ({ secondChance, pendingContinue }),
    },
  ),
);
