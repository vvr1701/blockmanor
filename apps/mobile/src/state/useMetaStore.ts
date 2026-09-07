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
  /**
   * §7.10: the per-level star count (1-3) the §7.10 level map's medallions
   * render. Written by §7.5's win path off the engine's own `LEVEL_WON`
   * event — never re-derived here. Keyed by stringified level id like
   * `attempts`, and bounded by `MAX_LEVEL_ID` (60 keys) for the same reason.
   * A level absent from this map has never been won.
   */
  stars: Record<string, number>;
  /**
   * §7.10: chest levels (L10/20/30…) whose reward has been collected.
   * Stringified level id -> `true`; absent means unclaimed. Persisted so a
   * chest cannot be farmed across relaunches.
   */
  chestsClaimed: Record<string, boolean>;
  /**
   * §7.10 Stage-1 chest reward: the cosmetic avatar frame ids the player
   * owns (`@blockmanor/content` `AVATAR_FRAMES`). Granting and persisting is
   * §7.10's job; DISPLAYING a frame on the Home HUD avatar is §7.11's.
   * Deliberately NOT coins or any other wallet value — economy is Stage 2
   * (§9.1) and this store must not grow a Stage-2 shape early.
   */
  ownedFrames: readonly string[];
  setCurrentLevel: (level: number) => void;
  setStreak: (streak: number) => void;
  setBadge: (badge: keyof MetaState['badges'], on: boolean) => void;
  setFtueComplete: (complete: boolean) => void;
  setProfile: (name: string | null, avatarId: number | null) => void;
  /** Records that `attempt` of `levelId` has begun (§0 v1.17). */
  setAttempt: (levelId: number, attempt: number) => void;
  /** §7.10: records a level's best star count. Never lowers an existing one. */
  setLevelStars: (levelId: number, stars: number) => void;
  /** §7.10: marks `chestLevel`'s chest collected and grants `frameId`. */
  claimChest: (chestLevel: number, frameId: string) => void;
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
  // v2 -> v3 (§7.10): per-level `stars`, `chestsClaimed` and `ownedFrames`.
  // Written as three independent guards inside ONE sequential step, matching
  // the v1 -> v2 shape above: each `if` tests only its own key, so a save
  // that somehow carries one of the three but not the others still comes out
  // whole. Sequential steps (not early `return`s) so a v0 save composes all
  // three migrations in a single pass.
  if (version < 3) {
    if (!next.stars) next = { ...next, stars: {} };
    if (!next.chestsClaimed) next = { ...next, chestsClaimed: {} };
    if (!next.ownedFrames) next = { ...next, ownedFrames: [] };
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
      stars: {},
      chestsClaimed: {},
      ownedFrames: [],
      setCurrentLevel: (currentLevel) => set({ currentLevel }),
      setStreak: (streak) => set({ streak }),
      setBadge: (badge, on) => set((state) => ({ badges: { ...state.badges, [badge]: on } })),
      setFtueComplete: (ftueComplete) => set({ ftueComplete }),
      setProfile: (playerName, avatarId) => set({ playerName, avatarId }),
      setAttempt: (levelId, attempt) =>
        set((state) => ({ attempts: { ...state.attempts, [String(levelId)]: attempt } })),
      // Max-merge, never a plain overwrite: stars are a personal BEST (§7.10
      // renders "1-3 stars", not "stars last time"). A future replay path
      // scoring worse must not demote a medallion. `?? {}` guards the same
      // truncated-MMKV case `LevelSession.nextAttempt` guards for `attempts`.
      setLevelStars: (levelId, stars) =>
        set((state) => {
          const map = state.stars ?? {};
          const prev = map[String(levelId)];
          const best = Math.max(
            typeof prev === 'number' && Number.isFinite(prev) ? prev : 0,
            stars,
          );
          return { stars: { ...map, [String(levelId)]: best } };
        }),
      claimChest: (chestLevel, frameId) =>
        set((state) => {
          const claimed = state.chestsClaimed ?? {};
          const owned = state.ownedFrames ?? [];
          return {
            chestsClaimed: { ...claimed, [String(chestLevel)]: true },
            // Idempotent: re-claiming (a double tap, a replayed grant) must
            // never duplicate a frame id in the player's collection.
            ownedFrames: owned.includes(frameId) ? owned : [...owned, frameId],
          };
        }),
    }),
    {
      name: 'meta',
      storage: createJSONStorage(() => mmkvStorage),
      version: 3,
      migrate: migrateMetaState,
    },
  ),
);
