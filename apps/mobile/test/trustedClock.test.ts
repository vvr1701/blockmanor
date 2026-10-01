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

  it('disclosed residual: a reboot credits only the time since that reboot, never the broken wall-clock gap (§0 v1.44)', () => {
    trustedNow(0);
    setMockUptime(5_000);
    trustedNow(5_000); // anchors at wall=5_000, uptime=5_000
    setMockUptime(100); // device rebooted — uptime dropped below the anchor
    expect(trustedNow(3 * DAY)).toBe(5_000 + 100); // uptime-since-reboot only, not the 3-day gap
  });

  it('a stale backward-clock lag is never laundered into extra credit at a LATER reboot (§0 v1.44, qa-prd-auditor finding)', () => {
    trustedNow(100_000); // anchors at wall=100_000, uptime=0
    setMockUptime(1_000);
    trustedNow(97_000); // clock set BACK 3_000ms — restarts the period, anchor.wall drops to 97_000
    setMockUptime(100); // a real reboot, much later, with no further tampering
    const credited = trustedNow(100_000 + 48 * 3_600_000); // 48h later, real wall time
    // A wall-clock-based reboot credit would pay out ~48h + the stale 3_000ms
    // lag here; the fix credits only uptime-since-reboot, same as any reboot.
    expect(credited).toBe(97_000 + 100);
  });
});
