import { CHEST_LEVELS, FIRST_POST_FTUE_LEVEL } from '@blockmanor/content';
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
  /** §7.6 "personal best tracked" — the Endless mode high score. 0 means
   * "no record yet" (§12.9 empty-state trigger), never negative. */
  endlessBest: number;
  /**
   * §12.1 SFX/music/haptics toggles — persisted per its own acceptance
   * clause ("every toggle persists across relaunch and takes effect
   * immediately"). `game/sfx.ts`'s `playCue` reads `sfxEnabled` directly;
   * `game/haptics.ts` reads `hapticsEnabled` directly — both read this
   * store rather than being handed the value as a prop, because the mute
   * has to reach call sites (`GoldButton`, `JuiceLayer`, `DragLayer`, ...)
   * this PR does not touch. `musicEnabled` has no playback code to gate
   * yet (§7.4/§15.1's music is blocked on the same missing audio assets as
   * SFX) — it exists so the toggle persists and defaults on, per §7.4's
   * "off by default is NOT allowed."  All three default `true`.
   */
  sfxEnabled: boolean;
  musicEnabled: boolean;
  hapticsEnabled: boolean;
  /** §12.11: epoch ms of the last soft-update-banner dismissal, or 0 if never.
   * Persisted, because "max 1/week" has to survive a relaunch or the banner
   * reappears on every cold start and stops being soft. */
  updateNudgeDismissedAt: number;
  /** §12.1 "notification prefs by category." §8.7 names exactly two Stage-1
   * push categories — the daily-drop ping and the 20:00 streak-risk ping —
   * so those are the two categories, not an invented general list. Both
   * default `true`: no soft-ask/opt-in preference model exists yet to seed
   * a different initial value from (§7.1's soft-ask is OS permission, a
   * separate concern from this in-app preference). */
  notificationPrefs: { dailyDrop: boolean; streakRisk: boolean };
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
  /** Monotonic: only ever raises `endlessBest`, never lowers it — enforced
   * here (single source of truth) rather than trusted to every call site. */
  setEndlessBest: (score: number) => void;
  setSfxEnabled: (enabled: boolean) => void;
  setMusicEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  /** §12.11: records a dismissal at `now` (injected, never `Date.now()` at a
   * call site — the engine's purity rule is not in force here, but a testable
   * clock is still cheaper than faking timers). */
  dismissUpdateNudge: (now: number) => void;
  setNotificationPref: (category: keyof MetaState['notificationPrefs'], enabled: boolean) => void;
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
  // v3 -> v4 (§7.6): the Endless personal best. Same shape as the steps
  // above — a lone guard on its own key, so a save at any earlier version
  // composes every migration in one pass.
  if (version < 4 && typeof next.endlessBest !== 'number') {
    next = { ...next, endlessBest: 0 };
  }
  // v4 -> v5 (§12.1): SFX/music/haptics toggles + notification prefs. All
  // default `true` — §7.4's music rule ("off by default is NOT allowed")
  // extended to SFX/haptics/notifications for consistency, since nothing in
  // the PRD asks for a muted-by-default install. Same one-guard-per-key
  // shape as every migration above.
  if (version < 5) {
    if (typeof next.sfxEnabled !== 'boolean') next = { ...next, sfxEnabled: true };
    if (typeof next.musicEnabled !== 'boolean') next = { ...next, musicEnabled: true };
    if (typeof next.hapticsEnabled !== 'boolean') next = { ...next, hapticsEnabled: true };
    if (!next.notificationPrefs) {
      next = { ...next, notificationPrefs: { dailyDrop: true, streakRisk: true } };
    }
  }
  // v5 -> v6 (§12.11): the soft-update-nudge dismissal timestamp. 0 means
  // "never dismissed", which is the correct default for an existing save —
  // a returning player has not dismissed a banner they have never seen.
  if (version < 6) {
    if (typeof next.updateNudgeDismissedAt !== 'number') {
      next = { ...next, updateNudgeDismissedAt: 0 };
    }
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
      endlessBest: 0,
      sfxEnabled: true,
      musicEnabled: true,
      hapticsEnabled: true,
      updateNudgeDismissedAt: 0,
      notificationPrefs: { dailyDrop: true, streakRisk: true },
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
      setEndlessBest: (score) =>
        set((state) => ({ endlessBest: Math.max(state.endlessBest, score) })),
      setSfxEnabled: (sfxEnabled) => set({ sfxEnabled }),
      setMusicEnabled: (musicEnabled) => set({ musicEnabled }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      dismissUpdateNudge: (now) => set({ updateNudgeDismissedAt: now }),
      setNotificationPref: (category, enabled) =>
        set((state) => ({
          notificationPrefs: { ...state.notificationPrefs, [category]: enabled },
        })),
    }),
    {
      name: 'meta',
      storage: createJSONStorage(() => mmkvStorage),
      version: 6,
      migrate: migrateMetaState,
    },
  ),
);

/**
 * §7.11 "badge-dot logic centralized in `useMetaStore.badges`" — the ONE
 * badge-computation surface every consumer reads, so the §0 v1.18 map
 * affordance doesn't grow a second, independently-drifting dot mechanism.
 * `dailyUnplayed` is the persisted flag §8.3 will eventually own; `mapChestReady`
 * is deliberately NOT a persisted field — `chestsClaimed`/`currentLevel` are
 * already the source of truth (`LevelMapScreen`'s own `buildMapNodes` derives
 * the same "claimable" state from them), so storing a second boolean would
 * only ever be a copy that can go stale. True the moment any L10/20/30…
 * chest is past its unlock level and not yet claimed.
 */
export function selectBadges(state: MetaState): { dailyUnplayed: boolean; mapChestReady: boolean } {
  const claimed = state.chestsClaimed ?? {};
  return {
    dailyUnplayed: state.badges.dailyUnplayed,
    mapChestReady: CHEST_LEVELS.some(
      (level) => state.currentLevel > level && !claimed[String(level)],
    ),
  };
}
