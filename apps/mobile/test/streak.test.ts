import { describe, expect, it } from 'vitest';
import { flameTier, streakEvents } from '../src/game/streak';
import { monthCells } from '../src/screens/StreakScreen';

describe('§8.6 flame tiers', () => {
  it('upgrades at 7, 30 and 100', () => {
    expect([0, 6, 7, 29, 30, 99, 100, 365].map(flameTier)).toStrictEqual([
      'none',
      'none',
      'bronze',
      'bronze',
      'silver',
      'silver',
      'gold',
      'gold',
    ]);
  });
});

describe('§14 streak events from an accepted submission', () => {
  it('fires streak_milestone exactly on 7, 30 and 100', () => {
    expect(streakEvents(6, { streak: 7, streakGranted: true })).toStrictEqual([
      { name: 'streak_milestone', n: 7 },
    ]);
    expect(streakEvents(29, { streak: 30, streakGranted: true })).toStrictEqual([
      { name: 'streak_milestone', n: 30 },
    ]);
    expect(streakEvents(99, { streak: 100, streakGranted: true })).toStrictEqual([
      { name: 'streak_milestone', n: 100 },
    ]);
    expect(streakEvents(7, { streak: 8, streakGranted: true })).toStrictEqual([]);
  });

  it('fires streak_broken with the lost streak when a gap resets it to 1', () => {
    expect(streakEvents(12, { streak: 1, streakGranted: true })).toStrictEqual([
      { name: 'streak_broken', n: 12 },
    ]);
    // A first-ever day is not a break.
    expect(streakEvents(0, { streak: 1, streakGranted: true })).toStrictEqual([]);
  });

  it('fires nothing when the submission earned no streak (below daily_streak_min_moves)', () => {
    expect(streakEvents(6, { streak: 7, streakGranted: false })).toStrictEqual([]);
    expect(streakEvents(12, { streak: 1, streakGranted: false })).toStrictEqual([]);
  });
});

describe('§8.6 calendar month grid (UTC)', () => {
  it('pads to the first weekday and to whole weeks', () => {
    // 1 August 2026 is a Saturday: six leading blanks, 31 days, 42 cells.
    const aug = monthCells('2026-08');
    expect(aug.slice(0, 7)).toStrictEqual([null, null, null, null, null, null, 1]);
    expect(aug).toHaveLength(42);
    expect(aug.filter((c) => c !== null)).toHaveLength(31);
    // February 2028 is a leap month.
    expect(monthCells('2028-02').filter((c) => c !== null)).toHaveLength(29);
  });
});
