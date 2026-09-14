import { describe, expect, it } from 'vitest';
import {
  offsetsForLocalMinute,
  parseRegistration,
  STREAK_RISK_LOCAL_MINUTE,
} from '../src/push/push';

const at = (iso: string) => Date.parse(iso);

describe('§0 v1.32(b) offsetsForLocalMinute', () => {
  it('targets India (+5:30) at 08:00 local from the 02:30 UTC scan', () => {
    expect(offsetsForLocalMinute(at('2026-08-09T02:30:00Z'), 8 * 60)).toStrictEqual([330]);
  });

  it('snaps to the scan quarter hour, so a late-firing run targets the same players', () => {
    expect(offsetsForLocalMinute(at('2026-08-09T02:37:59Z'), 8 * 60)).toStrictEqual([330]);
  });

  it('wraps across midnight: 20:00 in UTC−8 is 04:00 UTC the next day', () => {
    expect(
      offsetsForLocalMinute(at('2026-08-10T04:00:00Z'), STREAK_RISK_LOCAL_MINUTE),
    ).toStrictEqual([-480]);
  });

  it('returns BOTH real offsets when +14:00 and −10:00 share the clock (Kiribati and Hawaii)', () => {
    // 20:00 in Hawaii (−10:00) is 06:00 UTC; +14:00 reads 20:00 then too.
    expect(
      offsetsForLocalMinute(at('2026-08-09T06:00:00Z'), STREAK_RISK_LOCAL_MINUTE),
    ).toStrictEqual([840, -600]);
  });

  it('every quarter hour of the day targets at least one real offset', () => {
    for (let q = 0; q < 96; q++) {
      expect(offsetsForLocalMinute(Date.UTC(2026, 7, 9, 0, q * 15), 8 * 60).length).toBeGreaterThan(
        0,
      );
    }
  });
});

describe('§0 v1.32(a) parseRegistration (trust boundary)', () => {
  const ok = { token: 't', utcOffsetMinutes: 330, dailyDrop: true, streakRisk: false };
  it('accepts a well-formed registration and drops unknown fields', () => {
    expect(parseRegistration({ ...ok, extra: 'x' })).toStrictEqual(ok);
  });
  it.each([
    ['null', null],
    ['a non-quarter-hour offset', { ...ok, utcOffsetMinutes: 331 }],
    ['a fractional offset', { ...ok, utcOffsetMinutes: 330.5 }],
    ['an offset past +14:00', { ...ok, utcOffsetMinutes: 855 }],
    ['an offset before −12:00', { ...ok, utcOffsetMinutes: -735 }],
    ['an empty token', { ...ok, token: '' }],
    ['a string preference', { ...ok, dailyDrop: 'yes' }],
  ])('refuses %s', (_name, input) => {
    expect(parseRegistration(input)).toBeNull();
  });
});
