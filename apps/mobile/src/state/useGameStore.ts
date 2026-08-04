import { create } from 'zustand';

/**
 * Active game session (PRD §4.4) — deliberately empty of rules.
 *
 * All game logic lives in packages/engine (PRD §0.4). When the engine lands this
 * store holds the current GameState and forwards placements to it; it will never
 * compute board rules itself.
 */
interface GameState {
  sessionId: string | null;
  startSession: (sessionId: string) => void;
  endSession: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  sessionId: null,
  startSession: (sessionId) => set({ sessionId }),
  endSession: () => set({ sessionId: null }),
}));
