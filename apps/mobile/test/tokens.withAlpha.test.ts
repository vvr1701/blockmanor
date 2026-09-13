import { describe, expect, it } from 'vitest';
import { colors, withAlpha } from '../src/components/tokens';

describe('withAlpha (components/tokens)', () => {
  it('matches the hand-built literals it replaces', () => {
    // The exact strings that used to be hand-typed at each call site —
    // GhostButton's onLight, PauseSheet/FailScreen's INK_70, ChestSheet's
    // gold reward-card wash.
    expect(withAlpha(colors.night, 0.7)).toBe('rgba(19,24,48,0.7)');
    expect(withAlpha(colors.night, 0.65)).toBe('rgba(19,24,48,0.65)');
    expect(withAlpha(colors.gold, 0.18)).toBe('rgba(233,196,106,0.18)');
    expect(withAlpha(colors.cream, 0.28)).toBe('rgba(243,234,215,0.28)');
  });

  it('round-trips every channel independently, not just a lucky triple', () => {
    // #C99A35 has three distinct, non-adjacent channel values — a helper
    // that mixed up its shift amounts would still pass the test above by
    // coincidence (colors.night's channels are close together) but not this.
    expect(withAlpha('#C99A35', 1)).toBe('rgba(201,154,53,1)');
  });
});
