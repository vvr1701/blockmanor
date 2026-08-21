/** Shipped level loader — PRD §7.9 (60 levels) / §7.5 progression loop dep. */

import { describe, expect, it } from 'vitest';
import { LEVELS, MAX_LEVEL_ID, getLevel } from '../src/levels';

describe('LEVELS / getLevel', () => {
  it('loads all 60 shipped levels, in id order 1..60', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(MAX_LEVEL_ID).toBe(60);
  });

  it('getLevel returns the matching level by id', () => {
    expect(getLevel(6)?.id).toBe(6);
    expect(getLevel(60)?.id).toBe(60);
  });

  it('getLevel returns undefined past the shipped range', () => {
    expect(getLevel(61)).toBeUndefined();
    expect(getLevel(0)).toBeUndefined();
  });
});
