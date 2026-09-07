/**
 * `EngineTuning` from the live RC snapshot (§13 "these five keys apply to
 * level and endless modes only"). Shared by every screen that builds a
 * `GameConfig` for a level/endless run (`FtueScreen` §7.1, `LevelSession`
 * §7.5, `EndlessScreen` §7.6) — never hardcode these at a call site
 * (CLAUDE.md rule 3).
 *
 * The Daily Board does NOT use this. §13's scope note is explicit: it reads
 * the frozen `engineConfig` snapshot from `dailyBoards/{date}` instead of
 * live RC, so that §8.5's server re-simulation stays reproducible across a
 * mid-day RC push.
 */
import { useMemo } from 'react';
import type { EngineTuning } from '@blockmanor/engine';
import { useConfigStore } from '../state/useConfigStore';

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
