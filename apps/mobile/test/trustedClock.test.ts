import { beforeEach, describe, expect, it } from 'vitest';
import { setMockUptime } from './mocks/device-uptime';
import { resetTrustedClock, trustedNow } from '../src/services/trustedClock';

/**
 * §0 v1.43: the forward-clock exploit (v1.42(e)) is defended by clamping
 * wall-clock-measured elapsed time to the device's monotonic uptime.
 */

const DAY = 24 * 3_600_000;

beforeEach(() => {
  resetTrustedClock();
  setMockUptime(0);
});

describe('trustedNow', () => {
  it('passes the wall clock through on the first call (nothing to compare against yet)', () => {
    expect(trustedNow(1_000)).toBe(1_000);
  });

  it('credits full elapsed time when the wall clock and uptime agree (a real offline period)', () => {
    trustedNow(0);
    setMockUptime(3 * DAY);
    expect(trustedNow(3 * DAY)).toBe(3 * DAY);
  });

  it('the forward-clock exploit: a wall-clock jump credits no more than uptime actually moved', () => {
    trustedNow(0);
    setMockUptime(5_000); // 5 real seconds passed while the clock was set forward
    expect(trustedNow(3 * DAY)).toBe(5_000);
  });

  it('a small legitimate gap (app backgrounded a few minutes, clock untouched) credits in full', () => {
    trustedNow(0);
    setMockUptime(10 * 60_000);
    expect(trustedNow(10 * 60_000)).toBe(10 * 60_000);
  });

  it('repeated small forward jumps never credit more than real uptime elapsed, cumulatively', () => {
    trustedNow(0);
    setMockUptime(1_000);
    expect(trustedNow(DAY)).toBe(1_000); // clamped
    setMockUptime(2_000);
    // Second jump is measured from the CREDITED anchor (1_000), not the
    // attacker's spoofed wall time — so it still only yields +1_000 more.
    expect(trustedNow(2 * DAY)).toBe(2_000);
  });

  it('a backward clock jump passes through unclamped (existing restart-the-period behavior, §0 v1.41(e))', () => {
    trustedNow(DAY);
    setMockUptime(1_000);
    expect(trustedNow(DAY - 5 * 60_000)).toBe(DAY - 5 * 60_000);
  });

  it('disclosed residual: a reboot (uptime resets) coincident with a clock jump falls back to trusting the wall clock', () => {
    trustedNow(0);
    setMockUptime(5_000);
    trustedNow(5_000); // anchors at uptime=5_000
    setMockUptime(100); // device rebooted — uptime dropped below the anchor
    expect(trustedNow(3 * DAY)).toBe(3 * DAY);
  });
});
