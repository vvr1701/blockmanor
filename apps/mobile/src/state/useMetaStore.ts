import { FIRST_POST_FTUE_LEVEL } from '@blockmanor/content';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from './persist';

/**
 * Persisted player meta (PRD §4.4): progress, streaks, badges — MMKV-backed.
 * Wallet/coins arrive in Stage 2 and are server-authoritative (§9.1); this store
 * only ever caches them optimistically.
 */
interface MetaState {
  currentLevel: number;
  streak: number;
  badges: { dailyUnplayed: boolean };
  /** §7.1 v1.11: true once the FTUE flow (L1-L5 + name/avatar) has been
   * completed or skipped-as-guest. Read by the app's returning-user skip
   * check alongside `currentLevel > 1` — see App.tsx. */
  ftueComplete: boolean;
  /** §7.1.3 name/avatar screen, guest allowed: both null for a guest. */
  playerName: string | null;
  avatarId: number | null;
  /**
   * §7.5 / §0 v1.17: attempt number per level id (JSON object keys are
   * strings, so the id is stringified), advanced once per run STARTED.
   * Persisted rather than session-local because §7.9's "L15 win rate 35-45%
   * first attempt" target and §3's per-level quit rate both use
   * `level_start{attempt}` as their denominator — a counter that resets on
   * relaunch emits a second, false `attempt: 1`. Bounded by `MAX_LEVEL_ID`
   * (60 keys), so it needs no eviction.
   */
  attempts: Record<string, number>;
  setCurrentLevel: (level: number) => void;
  setStreak: (streak: number) => void;
  setBadge: (badge: keyof MetaState['badges'], on: boolean) => void;
  setFtueComplete: (complete: boolean) => void;
  setProfile: (name: string | null, avatarId: number | null) => void;
  /** Records that `attempt` of `levelId` has begun (§0 v1.17). */
  setAttempt: (levelId: number, attempt: number) => void;
}

/**
 * §7.5 audit B-1: every device on the pre-fix §7.1 build persisted
 * `{ftueComplete: true, currentLevel: 1}` — L1-L3 ship `goals: []`, and
 * `LevelSession` didn't handle the engine's `'completed'` status before this
 * fix, so those levels could never produce a terminal outcome it understood.
 * That's a permanent trap on every relaunch (§12.9 dead end). `FtueScreen`'s
 * own fix (setting `currentLevel` to `FIRST_POST_FTUE_LEVEL` on completion)
 * only reaches NEW installs; this clamps any already-through-FTUE save caught
 * inside the FTUE range up to the same landing spot. A standalone, exported
 * function (not an inline `persist` lambda) so it has its own test coverage
 * independent of spinning up real MMKV rehydration timing.
 */
export function migrateMetaState(persisted: unknown, version: number): unknown {
  const state = persisted as MetaState | null | undefined;
  if (!state) return state;
  let next = state;
  if (version < 1 && next.ftueComplete && next.currentLevel < FIRST_POST_FTUE_LEVEL) {
    next = { ...next, currentLevel: FIRST_POST_FTUE_LEVEL };
  }
  // v1 -> v2 (§0 v1.17): the per-level `attempts` counter was added. zustand's
  // default shallow merge would also supply the initial-state `{}` for a save
  // that predates it, but the shape change is recorded here explicitly so the
  // store's version number stays an honest description of its shape.
  if (version < 2 && !next.attempts) {
    next = { ...next, attempts: {} };
  }
  return next;
}

export const useMetaStore = create<MetaState>()(
  persist(
    (set) => ({
      currentLevel: 1,
      streak: 0,
      badges: { dailyUnplayed: false },
      ftueComplete: false,
      playerName: null,
      avatarId: null,
      attempts: {},
      setCurrentLevel: (currentLevel) => set({ currentLevel }),
      setStreak: (streak) => set({ streak }),
      setBadge: (badge, on) => set((state) => ({ badges: { ...state.badges, [badge]: on } })),
      setFtueComplete: (ftueComplete) => set({ ftueComplete }),
      setProfile: (playerName, avatarId) => set({ playerName, avatarId }),
      setAttempt: (levelId, attempt) =>
        set((state) => ({ attempts: { ...state.attempts, [String(levelId)]: attempt } })),
    }),
    {
      name: 'meta',
      storage: createJSONStorage(() => mmkvStorage),
      version: 2,
      migrate: migrateMetaState,
    },
  ),
);
