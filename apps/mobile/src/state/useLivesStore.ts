import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from './persist';

/**
 * §9.2 lives — CLIENT-authoritative, MMKV-persisted (§0 v1.41(a)). §4.4 names
 * what the server owns and lives are not on the list; §4.5 needs levels fully
 * playable offline; and a life is lost on a level result the client already
 * reports on trust, so a server copy would cost a round trip per fail and stop
 * nothing. The one money edge — the coin refill — goes through §9.1's
 * server-authoritative `spendCoins` (`services/lives.ts`).
 *
 * Stored as lives MISSING below `lives_max`, not lives held: 0 missing is full
 * at any `lives_max`, so a Remote Config change needs no migration.
 */
export interface LivesRules {
  /** `lives_max`. */
  max: number;
  /** `life_regen_minutes`, in ms. */
  regenMs: number;
}

interface Regen {
  missing: number;
  /** Epoch ms the running regen period began; 0 while full. */
  regenFrom: number;
}

export interface PendingRefill {
  key: string;
  /** Pinned: the server refuses a spend key replayed at a different amount. */
  amount: number;
}

interface LivesState extends Regen {
  /** The run whose life is forfeit right now; a win of THAT run refunds it. */
  chargedRun: string | null;
  /** A coin refill sent but not yet answered for good (§0 v1.41(g)). */
  pendingRefill: PendingRefill | null;
  /** Rewarded-ad lives granted on `day` (UTC `YYYY-MM-DD`), §9.2 `rv_life_daily_cap`. */
  adLives: { day: string; count: number };
  /** Takes one life for `runKey`, once. No-op at 0 lives: nothing to take, nothing to refund. */
  forfeit: (runKey: string, now: number, rules: LivesRules) => void;
  /** Returns `runKey`'s life if it was taken. */
  refund: (runKey: string, now: number, rules: LivesRules) => void;
  refill: () => void;
  /**
   * Persists `settleLives` — the only way a clock-set-backwards restart
   * sticks. Reads settle transiently; without this `regenFrom` stays in the
   * "future" and regen stalls until real time catches up (§0 v1.41(e) "never stalls").
   */
  settle: (now: number, rules: LivesRules) => void;
  /** +1 life from a rewarded ad, capped per UTC day. False = capped or already full. */
  grantAdLife: (now: number, rules: LivesRules, cap: number) => boolean;
  setPendingRefill: (pending: PendingRefill | null) => void;
}

/**
 * Folds elapsed regen periods into `missing`. Device clock (the only clock
 * offline, §0 v1.41(e)): a clock set BACKWARDS restarts the running period
 * rather than minting or stalling — the restart only sticks once persisted
 * via the store's `settle`; a clock set forwards mints (the named exploit in
 * §0 v1.41(e)).
 */
export function settleLives(s: Regen, now: number, rules: LivesRules): Regen {
  const missing = Math.min(s.missing, rules.max);
  if (missing <= 0) return { missing: 0, regenFrom: 0 };
  const from = s.regenFrom > 0 && s.regenFrom <= now ? s.regenFrom : now;
  const gained = Math.floor((now - from) / rules.regenMs);
  const left = Math.max(0, missing - gained);
  return left === 0
    ? { missing: 0, regenFrom: 0 }
    : { missing: left, regenFrom: from + gained * rules.regenMs };
}

/** What the HUD and the out-of-lives sheet show. `nextLifeAt` is null when full. */
export function selectLives(
  s: Regen,
  now: number,
  rules: LivesRules,
): { lives: number; nextLifeAt: number | null } {
  const { missing, regenFrom } = settleLives(s, now, rules);
  return { lives: rules.max - missing, nextLifeAt: missing > 0 ? regenFrom + rules.regenMs : null };
}

const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** Rewarded-ad lives still available today under `cap`. */
export function selectAdLivesLeft(s: Pick<LivesState, 'adLives'>, now: number, cap: number) {
  return Math.max(0, cap - (s.adLives.day === utcDay(now) ? s.adLives.count : 0));
}

/** `missing - 1`, keeping `regenFrom` 0 exactly when full. */
const giveOne = (s: Regen): Regen =>
  s.missing <= 1
    ? { missing: 0, regenFrom: 0 }
    : { missing: s.missing - 1, regenFrom: s.regenFrom };

export const useLivesStore = create<LivesState>()(
  persist(
    (set, get) => ({
      missing: 0,
      regenFrom: 0,
      chargedRun: null,
      pendingRefill: null,
      adLives: { day: '', count: 0 },
      forfeit: (runKey, now, rules) =>
        set((st) => {
          if (st.chargedRun === runKey) return {};
          const s = settleLives(st, now, rules);
          if (s.missing >= rules.max) return s;
          return {
            missing: s.missing + 1,
            // Leaving full starts the first regen period now.
            regenFrom: s.missing === 0 ? now : s.regenFrom,
            chargedRun: runKey,
          };
        }),
      refund: (runKey, now, rules) =>
        set((st) =>
          st.chargedRun === runKey
            ? { ...giveOne(settleLives(st, now, rules)), chargedRun: null }
            : {},
        ),
      refill: () => set({ missing: 0, regenFrom: 0 }),
      settle: (now, rules) => set((st) => settleLives(st, now, rules)),
      grantAdLife: (now, rules, cap) => {
        const st = get();
        const s = settleLives(st, now, rules);
        const used = cap - selectAdLivesLeft(st, now, cap);
        if (s.missing === 0 || used >= cap) return false;
        set({ ...giveOne(s), adLives: { day: utcDay(now), count: used + 1 } });
        return true;
      },
      setPendingRefill: (pendingRefill) => set({ pendingRefill }),
    }),
    {
      name: 'lives',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: ({ missing, regenFrom, chargedRun, pendingRefill, adLives }) => ({
        missing,
        regenFrom,
        chargedRun,
        pendingRefill,
        adLives,
      }),
    },
  ),
);
