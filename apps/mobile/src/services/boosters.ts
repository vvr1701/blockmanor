import type { BoosterType } from '@blockmanor/engine';

/**
 * §9.3 win-streak booster grants + showcase levels — pure helpers, kept out
 * of `LevelSession` so the parsing/threshold-matching logic is unit-testable
 * without mounting a screen (same split `services/lives.ts` uses for its own
 * rule functions).
 */

/** L12 hammer / L18 broom / L26 hourglass (§9.3): these are already-authored
 * regular levels (`packages/content`), not new content — this map is only
 * the client's "first arrival here grants + tooltips the booster" trigger. */
export const BOOSTER_SHOWCASE_LEVELS: Readonly<Record<number, BoosterType>> = {
  12: 'hammer',
  18: 'broom',
  26: 'hourglass',
};

export interface WinstreakTier {
  /** The streak value this tier names ("x2", "x3", "x5+"). */
  threshold: number;
  /** Boosters granted (random types). */
  count: number;
  /** Start-score bonus — wired §0 v1.49, see `winstreakGrantFor`'s doc. */
  bonus: number;
}

/**
 * Parses `winstreak_thresholds` (`[RC]`, e.g. `"2:1,3:2,5:2+200"`) into
 * ascending tiers. A malformed entry is dropped rather than thrown — a typo'd
 * RC value should degrade to "no grant for that tier", never crash a level.
 */
export function parseWinstreakThresholds(raw: string): WinstreakTier[] {
  return raw
    .split(',')
    .map((part): WinstreakTier | null => {
      const m = /^\s*(\d+)\s*:\s*(\d+)\s*(?:\+\s*(\d+)\s*)?$/.exec(part);
      if (!m || !m[1] || !m[2]) return null;
      return { threshold: Number(m[1]), count: Number(m[2]), bonus: Number(m[3] ?? 0) };
    })
    .filter((t): t is WinstreakTier => t !== null)
    .sort((a, b) => a.threshold - b.threshold);
}

/**
 * §9.3's grant for a streak that just reached `streak` (i.e. AFTER the
 * triggering win is recorded). Every tier below the top matches EXACTLY
 * (the PRD's literal "x2"/"x3" reading — streak 4 grants nothing); the TOP
 * tier is named "5+" in the PRD's own text, so it is read as `streak >=`
 * that threshold and fires on every qualifying win, not only the first one —
 * flagged PRD-AMENDMENT-NEEDED (this session's report) since the PRD states
 * the three tiers but not this repeat-vs-once distinction.
 *
 * `bonus` (the x5+ start-score +200) is applied by `LevelSession.recordWin`
 * via `useBoosterStore.pendingStartScore` → `GameConfig.startScore` (§0
 * v1.49) — a caller granting `count` boosters for a tier must also check
 * `bonus` separately; the two are independent fields of the same tier, not a
 * single combined grant.
 */
export function winstreakGrantFor(
  streak: number,
  tiers: readonly WinstreakTier[],
): WinstreakTier | null {
  if (tiers.length === 0) return null;
  const top = tiers[tiers.length - 1] as WinstreakTier;
  if (streak >= top.threshold) return top;
  return tiers.find((t) => t.threshold === streak) ?? null;
}

const BOOSTER_TYPES: readonly BoosterType[] = ['hammer', 'broom', 'hourglass'];

/** One of the three booster types, uniformly at random. `rand` is injectable
 * (defaults to `Math.random`, fine here — this is app code, not
 * `packages/engine`, so CLAUDE.md's no-`Math.random` purity rule doesn't
 * reach it) purely so a test can pin the draw. */
export function randomBoosterType(rand: () => number = Math.random): BoosterType {
  const i = Math.floor(rand() * BOOSTER_TYPES.length);
  return BOOSTER_TYPES[Math.min(i, BOOSTER_TYPES.length - 1)] as BoosterType;
}
