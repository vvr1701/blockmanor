/**
 * §8.6 streak presentation rules. The COUNT is server-authoritative
 * (`users/{uid}.streak`, returned on every accepted submission); this file only
 * decides how a server number is shown and which §14 events it implies.
 */

/** §8.6 "Milestones 7/30/100". */
export const STREAK_MILESTONES = [7, 30, 100] as const;

export type FlameTier = 'none' | 'bronze' | 'silver' | 'gold';

/** §8.6 "cosmetic flame upgrades (bronze/silver/gold flame)" at 7/30/100. */
export function flameTier(streak: number): FlameTier {
  if (streak >= 100) return 'gold';
  if (streak >= 30) return 'silver';
  if (streak >= 7) return 'bronze';
  return 'none';
}

export type StreakEvent =
  { name: 'streak_milestone'; n: number } | { name: 'streak_broken'; n: number };

/**
 * The §14 events one accepted submission implies. `previous` is the streak this
 * device last showed. A reset is only visible when the server credits the day
 * as 1 after a longer streak — a 1 → 1 reset is indistinguishable from a
 * first-ever day, so it is not reported rather than guessed.
 */
export function streakEvents(
  previous: number,
  result: { streak: number; streakGranted: boolean },
): StreakEvent[] {
  if (!result.streakGranted) return [];
  const events: StreakEvent[] = [];
  if (result.streak === 1 && previous > 1) events.push({ name: 'streak_broken', n: previous });
  if ((STREAK_MILESTONES as readonly number[]).includes(result.streak)) {
    events.push({ name: 'streak_milestone', n: result.streak });
  }
  return events;
}
