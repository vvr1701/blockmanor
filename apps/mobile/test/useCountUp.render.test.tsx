import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountUp } from '../src/game/useCountUp';
import { SCORE_COUNT_UP_MS } from '../src/screens/DailyResultScreen';

let seen: number[] = [];
function Probe({ target }: { target: number }) {
  seen.push(useCountUp(target, SCORE_COUNT_UP_MS));
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  seen = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('§8.3 score count-up', () => {
  it('runs 0 → score over exactly 900ms, rising, and lands on the score', () => {
    expect(SCORE_COUNT_UP_MS).toBe(900);
    act(() => {
      TestRenderer.create(<Probe target={8420} />);
    });
    expect(seen.at(-1)).toBe(0);
    act(() => {
      vi.advanceTimersByTime(450);
    });
    const mid = seen.at(-1)!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(8420);
    act(() => {
      vi.advanceTimersByTime(470);
    });
    expect(seen.at(-1)).toBe(8420);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });
});
