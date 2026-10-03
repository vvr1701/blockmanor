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
 *    the same persist-before-call shape `services/lives.ts`'s `pendingRefill`
 *    uses, but with NO background flush (§0 v1.46): a lost continue answer
 *    has no later moment it can still be delivered (the revive IS this fail
 *    screen), so `services/continueFlow.ts`'s `buyContinue` only ever
 *    replays it from the player's own re-tap of the SAME run. Scoped by
 *    `runKey` (§9.2's own run identity) so a stray pending continue for a
 *    dead run is simply abandoned (never double-charged, never resurrected,
 *    and never silently settled behind the player's back either) once a new
 *    run overwrites it.
 *
 * `continues_used` and the current price TIER are deliberately NOT here: §0
 * v1.39(b) scopes them to the current attempt, and every attempt (including
 * one resumed after a kill) is a fresh `attempt`/`runKey` (§0 v1.17) — so
 * plain `LevelSession` component state, reset in its existing run-start
 * effect, already satisfies "reset to zero/tier-1 on a new attempt" with no
 * separate persisted counter.
 */

const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/**
 * §0 v1.46: the day only ever ratchets FORWARD, never resets on a backward
 * (or merely different) day — a bare `!==` check would let a player reset
 * this cap just by changing the date, unlike the UTC-day caps it rhymes
 * with. `''` (never granted) always counts as "older". ISO `YYYY-MM-DD`
 * strings compare correctly as plain strings.
 */
const isNewerDay = (day: string, storedDay: string): boolean => storedDay === '' || day > storedDay;

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
  const used = isNewerDay(utcDay(now), s.secondChance.day) ? 0 : s.secondChance.count;
  return Math.max(0, cap - used);
}

export const useContinueStore = create<ContinueState>()(
  persist(
    (set, get) => ({
      secondChance: { day: '', count: 0 },
      pendingContinue: null,
      grantSecondChance: (now, cap) => {
        if (selectSecondChanceLeft(get(), now, cap) <= 0) return false;
        const day = utcDay(now);
        set((s) => {
          const fresh = isNewerDay(day, s.secondChance.day);
          return {
            secondChance: {
              day: fresh ? day : s.secondChance.day,
              count: (fresh ? 0 : s.secondChance.count) + 1,
            },
          };
        });
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
