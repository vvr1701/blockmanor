import { describe, expect, it } from 'vitest';
import {
  DAILY_HISTOGRAM_BUCKETS,
  DAILY_HISTOGRAM_BUCKET_WIDTH,
  dailyHistogramBucket,
  dailyTopPercent,
} from '../src/dailyBoard';

const histogram = (fill: Record<number, number>): number[] =>
  Array.from({ length: DAILY_HISTOGRAM_BUCKETS }, (_, i) => fill[i] ?? 0);

describe('§8.4 percentile (§0 v1.28)', () => {
  it('buckets by 50 points with an open top bucket', () => {
    expect(DAILY_HISTOGRAM_BUCKET_WIDTH).toBe(50);
    expect(dailyHistogramBucket(-5)).toBe(0);
    expect(dailyHistogramBucket(49)).toBe(0);
    expect(dailyHistogramBucket(50)).toBe(1);
    expect(dailyHistogramBucket(4_999)).toBe(99);
    expect(dailyHistogramBucket(5_000)).toBe(99);
    expect(dailyHistogramBucket(1e9)).toBe(99);
  });

  it('is absent before 100 counted submissions', () => {
    expect(dailyTopPercent(histogram({ 10: 99 }), 500)).toBeNull();
    expect(dailyTopPercent(histogram({ 10: 100 }), 500)).toBe(1);
  });

  it('ranks the best as Top 1% and the worst as Top 100%', () => {
    // 99 others in bucket 0, this one in bucket 20.
    expect(dailyTopPercent(histogram({ 0: 99, 20: 1 }), 1_000)).toBe(1);
    // 99 others in bucket 99, this one in bucket 0.
    expect(dailyTopPercent(histogram({ 99: 99, 0: 1 }), 0)).toBe(100);
  });

  it('floors, counts only strictly higher buckets, and shares ties', () => {
    // 150 above, 50 tied (incl. this one), 800 below: floor(100 * 151 / 1000) = 15.
    expect(dailyTopPercent(histogram({ 30: 150, 20: 50, 5: 800 }), 1_010)).toBe(15);
    // 1 above, 120 total: 100 * 2 / 120 = 1.67 -> 1. Rounding would show 2.
    expect(dailyTopPercent(histogram({ 30: 1, 20: 1, 5: 118 }), 1_010)).toBe(1);
    // Every tie in the bucket gets the same rank, whatever its exact score.
    expect(dailyTopPercent(histogram({ 30: 150, 20: 50, 5: 800 }), 1_049)).toBe(15);
  });
});
