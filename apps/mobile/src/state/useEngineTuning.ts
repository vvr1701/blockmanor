import type { EngineTuning } from '@blockmanor/engine';
import { useMemo } from 'react';
import { useConfigStore } from './useConfigStore';

/**
 * The §6/§13 `[RC]` engine knobs, read live off `useConfigStore` and shaped
 * into the `EngineTuning` the engine's `GameConfig.tuning` takes. Shared by
 * every non-Daily caller that builds a `GameConfig` client-side (FTUE §7.1,
 * Endless §7.6) — the Daily Board does NOT use this (§13 scope note: it reads
 * the frozen `engineConfig` snapshot from `dailyBoards/{date}` instead, never
 * live RC).
 *
 * Extracted from `FtueScreen` (first caller, §7.1) rather than duplicated —
 * see EndlessScreen's own doc comment for why a second caller needed it.
 */
export function useEngineTuning(): EngineTuning {
  const mercy_threshold = useConfigStore((s) => s.value('mercy_threshold'));
  const mercy_small_prob = useConfigStore((s) => s.value('mercy_small_prob'));
  const score_clear_base = useConfigStore((s) => s.value('score_clear_base'));
  const combo_step = useConfigStore((s) => s.value('combo_step'));
  const perfect_clear_bonus = useConfigStore((s) => s.value('perfect_clear_bonus'));
  return useMemo(
    () => ({
      mercy_threshold,
      mercy_small_prob,
      score_clear_base,
      combo_step,
      perfect_clear_bonus,
    }),
    [mercy_threshold, mercy_small_prob, score_clear_base, combo_step, perfect_clear_bonus],
  );
}
