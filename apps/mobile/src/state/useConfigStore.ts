import { create } from 'zustand';
import {
  REMOTE_CONFIG_DEFAULTS,
  type RemoteConfigKey,
  type RemoteConfigSnapshot,
} from '@blockmanor/shared';

/**
 * Remote Config snapshot (PRD §4.4, §13). Defaults ship in the binary; a fetched
 * snapshot overlays them on cold start + 6h TTL. Call sites read values through
 * `value()` — never hardcode an [RC] number (CLAUDE.md rule 3).
 *
 * Stage 0: defaults only. The Firebase Remote Config fetch lands with the
 * analytics/config service wiring; the store shape is the contract for it.
 */
interface ConfigState {
  snapshot: RemoteConfigSnapshot;
  fetchedAt: number | null;
  value: <K extends RemoteConfigKey>(key: K) => RemoteConfigSnapshot[K];
  applySnapshot: (partial: Partial<RemoteConfigSnapshot>, fetchedAt: number) => void;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  snapshot: { ...REMOTE_CONFIG_DEFAULTS },
  fetchedAt: null,
  value: (key) => get().snapshot[key],
  applySnapshot: (partial, fetchedAt) =>
    set((state) => ({ snapshot: { ...state.snapshot, ...partial }, fetchedAt })),
}));
