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
  setCurrentLevel: (level: number) => void;
  setStreak: (streak: number) => void;
  setBadge: (badge: keyof MetaState['badges'], on: boolean) => void;
  setFtueComplete: (complete: boolean) => void;
  setProfile: (name: string | null, avatarId: number | null) => void;
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
      setCurrentLevel: (currentLevel) => set({ currentLevel }),
      setStreak: (streak) => set({ streak }),
      setBadge: (badge, on) => set((state) => ({ badges: { ...state.badges, [badge]: on } })),
      setFtueComplete: (ftueComplete) => set({ ftueComplete }),
      setProfile: (playerName, avatarId) => set({ playerName, avatarId }),
    }),
    { name: 'meta', storage: createJSONStorage(() => mmkvStorage) },
  ),
);
