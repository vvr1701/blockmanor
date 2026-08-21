/**
 * §7.5 star computation: "Star 1 = win; star 2/3 = score thresholds `s2`,
 * `s3`." Exercises the engine's own `starsFor` (packages/engine/src/scoring.ts
 * — untouched here, CLAUDE.md hard rule 2) at and around the thresholds, as
 * consumed by `WinScreen`/`LevelSession`, including the §7.1 v1.11 FTUE
 * `{s2:0,s3:0}` "3 stars unconditionally" ruling falling out of the same
 * threshold logic rather than a special case.
 */
import { starsFor } from '@blockmanor/engine';
import { describe, expect, it } from 'vitest';

const THRESHOLDS = { s2: 1500, s3: 2600 };

describe('starsFor (PRD §7.5)', () => {
  it('1 star below s2', () => {
    expect(starsFor(0, THRESHOLDS)).toBe(1);
    expect(starsFor(1499, THRESHOLDS)).toBe(1);
  });

  it('2 stars at and above s2, below s3', () => {
    expect(starsFor(1500, THRESHOLDS)).toBe(2);
    expect(starsFor(2599, THRESHOLDS)).toBe(2);
  });

  it('3 stars at and above s3', () => {
    expect(starsFor(2600, THRESHOLDS)).toBe(3);
    expect(starsFor(999999, THRESHOLDS)).toBe(3);
  });

  it('§7.1 v1.11 FTUE {s2:0,s3:0}: 3 stars unconditionally, no special case needed', () => {
    expect(starsFor(0, { s2: 0, s3: 0 })).toBe(3);
    expect(starsFor(1, { s2: 0, s3: 0 })).toBe(3);
    expect(starsFor(9999, { s2: 0, s3: 0 })).toBe(3);
  });

  it('no schema (endless/daily-shaped, undefined stars) is 1 star — win-only', () => {
    expect(starsFor(50000, undefined)).toBe(1);
  });
});
