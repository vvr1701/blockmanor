import type { BoosterType } from '@blockmanor/engine';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from './persist';

/**
 * §9.3 booster inventory — CLIENT-authoritative, MMKV-persisted, same shape
 * as `useLivesStore` (§0 v1.37(a) reasoning applies here too: boosters cost
 * no server round trip to grant or spend, and RC pricing / purchasing them
 * with coins is explicitly out of this PR's scope, §9.4/shop territory).
 *
 * Sources of supply: the win-streak system (`grant`, LevelSession) and each
 * booster's one-time showcase level (`grantShowcase`, L12/18/26). Spend is
 * `consume`, called only after the engine's own `applyBooster` has already
 * succeeded (GameplayScreen) — never decremented speculatively.
 */
export type BoosterCounts = Record<BoosterType, number>;

const ZERO_COUNTS: BoosterCounts = { hammer: 0, broom: 0, hourglass: 0 };

interface BoosterState {
  counts: BoosterCounts;
  /** First-grant-with-tooltip, once per booster type, ever (§9.3). */
  showcaseGranted: Record<BoosterType, boolean>;
  /** The showcase grant most recently fired, for a one-shot tooltip. Cleared
   * on dismiss; deliberately NOT persisted (see `partialize` below) — an
   * in-flight tooltip should not resurrect after a relaunch mid-level. */
  tooltip: BoosterType | null;
  /** §9.3's ×1 pre-level slot: the booster armed for the level about to
   * start. Set by a win-streak grant (pre-filled) or the pre-level sheet;
   * consumed (cleared) once `LevelSession` hands it to that level's
   * `GameplayScreen`. */
  preSelected: BoosterType | null;
  /** §9.3 x5+ win-streak "start-score +200" (§0 v1.49): the next level
   * attempt's starting score, same one-shot pre-arm lifecycle as
   * `preSelected` — granted by `recordWin`, consumed by `LevelSession`'s
   * `beginRun` the moment that attempt actually starts. */
  pendingStartScore: number;
  grant: (type: BoosterType, count: number) => void;
  /** True if `type` was actually spent (count was > 0). */
  consume: (type: BoosterType) => boolean;
  /** Grants one `type` the first time it's called for that type, and queues
   * its one-shot tooltip. Returns whether this call was the (one) grant. */
  grantShowcase: (type: BoosterType) => boolean;
  dismissTooltip: () => void;
  setPreSelected: (type: BoosterType | null) => void;
  setPendingStartScore: (score: number) => void;
}

export const useBoosterStore = create<BoosterState>()(
  persist(
    (set, get) => ({
      counts: { ...ZERO_COUNTS },
      showcaseGranted: { hammer: false, broom: false, hourglass: false },
      tooltip: null,
      preSelected: null,
      pendingStartScore: 0,
      grant: (type, count) =>
        set((s) => ({ counts: { ...s.counts, [type]: s.counts[type] + count } })),
      consume: (type) => {
        if (get().counts[type] <= 0) return false;
        set((s) => ({ counts: { ...s.counts, [type]: s.counts[type] - 1 } }));
        return true;
      },
      grantShowcase: (type) => {
        if (get().showcaseGranted[type]) return false;
        set((s) => ({
          counts: { ...s.counts, [type]: s.counts[type] + 1 },
          showcaseGranted: { ...s.showcaseGranted, [type]: true },
          tooltip: type,
        }));
        return true;
      },
      dismissTooltip: () => set({ tooltip: null }),
      setPreSelected: (preSelected) => set({ preSelected }),
      setPendingStartScore: (pendingStartScore) => set({ pendingStartScore }),
    }),
    {
      name: 'boosters',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: ({ counts, showcaseGranted, preSelected, pendingStartScore }) => ({
        counts,
        showcaseGranted,
        preSelected,
        pendingStartScore,
      }),
    },
  ),
);
