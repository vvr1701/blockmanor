/**
 * `publish.ts` without the emulator: UTC date keying and — the important half —
 * validation of the six Remote Config numbers BEFORE they are frozen (§8.2).
 *
 * Why this is worth real tests: a frozen value is immutable for 24h. `create()`
 * refuses to overwrite (that is the idempotency guarantee), so rolling Remote
 * Config back does not repair the day, and the admin SDK's `asNumber()` renders
 * any unparseable value as **0** rather than failing. A single console typo would
 * otherwise ship a day where every clear scores nothing — or, on
 * `daily_piece_count`, no board at all.
 *
 * The Firestore-touching parts of publication live in `publish.emulator.test.ts`.
 */

import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNumber: vi.fn<(key: string) => number>(),
  getServerTemplate: vi.fn(),
  templateError: null as Error | null,
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('firebase-admin/remote-config', () => ({
  getRemoteConfig: () => ({
    getServerTemplate: async (...args: unknown[]) => {
      mocks.getServerTemplate(...args);
      if (mocks.templateError) throw mocks.templateError;
      return { evaluate: () => ({ getNumber: mocks.getNumber }) };
    },
  }),
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { warn: mocks.warn, error: mocks.error, info: mocks.info },
}));

const { nextUtcDate, readFrozenRemoteConfig, regenerateDailyBoard, utcDate } =
  await import('../src/daily/publish');

/**
 * The callable's own handler. `onCall` exposes `.run()` precisely so the guards
 * can be tested without a functions emulator; every case below rejects BEFORE
 * the handler reaches Firestore, which is what makes that possible.
 */
const callable = regenerateDailyBoard as unknown as {
  run: (req: {
    data: { date?: unknown };
    auth?: { uid: string; token: { admin?: boolean } };
  }) => Promise<unknown>;
};
const admin = { uid: 'ops', token: { admin: true } };

/** Live Remote Config returns exactly the §13 defaults unless a test says otherwise. */
function liveValues(over: Record<string, number> = {}): void {
  mocks.getNumber.mockImplementation((key) => {
    if (key in over) return over[key]!;
    const fallback = REMOTE_CONFIG_DEFAULTS[key as keyof typeof REMOTE_CONFIG_DEFAULTS];
    return typeof fallback === 'number' ? fallback : 0;
  });
}

beforeEach(() => {
  mocks.templateError = null;
  liveValues();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('§8.2 UTC date keying', () => {
  it('keys the board by UTC day, including either side of the boundary', () => {
    expect(utcDate('2026-08-09T00:00:00.000Z')).toBe('2026-08-09');
    expect(utcDate('2026-08-09T23:59:59.999Z')).toBe('2026-08-09');
    // A scheduler that fires a hair early must still key the day it names.
    expect(utcDate('2026-08-10T00:00:00.000Z')).toBe('2026-08-10');
    // An offset instant is normalised to UTC, never to the runner's zone.
    expect(utcDate('2026-08-09T05:30:00.000+05:30')).toBe('2026-08-09');
    expect(utcDate('2026-08-10T04:00:00.000+05:30')).toBe('2026-08-09');
  });

  it('generates day D from the D-1 23:45 UTC run (v1.12)', () => {
    expect(nextUtcDate('2026-08-08T23:45:00.000Z')).toBe('2026-08-09');
    // Month, year and leap-day rollovers, since the arithmetic is on UTC days.
    expect(nextUtcDate('2026-08-31T23:45:00.000Z')).toBe('2026-09-01');
    expect(nextUtcDate('2026-12-31T23:45:00.000Z')).toBe('2027-01-01');
    expect(nextUtcDate('2028-02-28T23:45:00.000Z')).toBe('2028-02-29');
    // A late or retried run still targets the day it was scheduled for, not
    // "tomorrow from now" — the scheduled instant is the only input.
    expect(nextUtcDate('2026-08-08T23:59:59.999Z')).toBe('2026-08-09');
    expect(nextUtcDate('2026-08-09T00:03:00.000Z')).toBe('2026-08-10');
  });
});

describe('§8.2 frozen Remote Config validation', () => {
  it('freezes live values and marks every key live', async () => {
    liveValues({ score_clear_base: 12, daily_piece_count: 48 });
    const frozen = await readFrozenRemoteConfig();

    expect(frozen.tuning.score_clear_base).toBe(12);
    expect(frozen.pieceCount).toBe(48);
    expect(frozen.source).toStrictEqual({
      mercy_threshold: 'live',
      mercy_small_prob: 'live',
      score_clear_base: 'live',
      combo_step: 'live',
      perfect_clear_bonus: 'live',
      daily_piece_count: 'live',
    });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('reads the template exactly once per generation (PRD v1.7)', async () => {
    await readFrozenRemoteConfig();
    expect(mocks.getServerTemplate).toHaveBeenCalledTimes(1);
    // …and it is handed the §13 registry as its defaults, never literals.
    expect(mocks.getServerTemplate).toHaveBeenCalledWith({
      defaultConfig: { ...REMOTE_CONFIG_DEFAULTS },
    });
  });

  it('catches the `asNumber()` typo: "ten" arrives as 0 and is refused', async () => {
    // The exact production failure. `score_clear_base: 0` would freeze a day in
    // which every line clear scores nothing, unfixable by an RC rollback.
    liveValues({ score_clear_base: 0 });
    const frozen = await readFrozenRemoteConfig();

    expect(frozen.tuning.score_clear_base).toBe(REMOTE_CONFIG_DEFAULTS.score_clear_base);
    expect(frozen.source.score_clear_base).toBe('default');
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('out of bounds'),
      expect.objectContaining({ key: 'score_clear_base', rejected: 0 }),
    );
  });

  it('falls back PER KEY — one bad value does not discard the good ones', async () => {
    liveValues({ score_clear_base: 0, combo_step: 0.4, perfect_clear_bonus: 500 });
    const frozen = await readFrozenRemoteConfig();

    expect(frozen.tuning.score_clear_base).toBe(REMOTE_CONFIG_DEFAULTS.score_clear_base);
    expect(frozen.tuning.combo_step).toBe(0.4);
    expect(frozen.tuning.perfect_clear_bonus).toBe(500);
    expect(frozen.source).toMatchObject({
      score_clear_base: 'default',
      combo_step: 'live',
      perfect_clear_bonus: 'live',
    });
  });

  it('refuses a daily_piece_count that would leave no board for 24h', async () => {
    // A non-integer or non-positive count makes `drawSequence` throw, which
    // fails all three scheduler retries identically — no document is published.
    for (const bad of [0, -60, 12.5, Number.NaN, Number.POSITIVE_INFINITY, 100_000]) {
      vi.clearAllMocks();
      liveValues({ daily_piece_count: bad });
      const frozen = await readFrozenRemoteConfig();
      expect(frozen.pieceCount, `${bad}`).toBe(REMOTE_CONFIG_DEFAULTS.daily_piece_count);
      expect(frozen.source.daily_piece_count, `${bad}`).toBe('default');
    }
  });

  it('bounds every frozen number, not just the ones with obvious failure modes', async () => {
    const outOfBand: Record<string, number> = {
      mercy_threshold: 1.5,
      mercy_small_prob: -0.1,
      score_clear_base: Number.NaN,
      combo_step: 99,
      perfect_clear_bonus: -1,
      daily_piece_count: 0,
    };
    liveValues(outOfBand);
    const frozen = await readFrozenRemoteConfig();

    expect(frozen.tuning).toStrictEqual({
      mercy_threshold: REMOTE_CONFIG_DEFAULTS.mercy_threshold,
      mercy_small_prob: REMOTE_CONFIG_DEFAULTS.mercy_small_prob,
      score_clear_base: REMOTE_CONFIG_DEFAULTS.score_clear_base,
      combo_step: REMOTE_CONFIG_DEFAULTS.combo_step,
      perfect_clear_bonus: REMOTE_CONFIG_DEFAULTS.perfect_clear_bonus,
    });
    expect(Object.values(frozen.source).every((s) => s === 'default')).toBe(true);
    expect(mocks.error).toHaveBeenCalledTimes(6);
  });

  it('accepts the edges of each band verbatim', async () => {
    // Bounds are a corruption guard, not a balance policy: anything in band is
    // frozen exactly as the operator set it (§13 owns balance, not this file).
    liveValues({
      mercy_threshold: 0,
      mercy_small_prob: 1,
      score_clear_base: 1,
      combo_step: 0,
      perfect_clear_bonus: 0,
      daily_piece_count: 1,
    });
    const frozen = await readFrozenRemoteConfig();
    expect(frozen.tuning.mercy_threshold).toBe(0);
    expect(frozen.tuning.mercy_small_prob).toBe(1);
    expect(frozen.tuning.combo_step).toBe(0);
    expect(frozen.pieceCount).toBe(1);
    expect(Object.values(frozen.source).every((s) => s === 'live')).toBe(true);
  });

  it('validates daily_reroll_cap without publishing it as frozen provenance', async () => {
    // v1.12: it steers generation, not re-simulation — so it is bounded like the
    // rest, but it is NOT in `configSource` and never reaches `engineConfig`.
    liveValues({ daily_reroll_cap: 2 });
    expect((await readFrozenRemoteConfig()).rerollCap).toBe(2);
    expect(Object.keys((await readFrozenRemoteConfig()).source)).not.toContain('daily_reroll_cap');

    // An unbounded or fractional cap would loop generation past its timeout and
    // leave no board at all — the same 24h outage `daily_piece_count` guards.
    for (const bad of [-1, 2.5, 500, Number.NaN]) {
      liveValues({ daily_reroll_cap: bad });
      expect((await readFrozenRemoteConfig()).rerollCap, `${bad}`).toBe(
        REMOTE_CONFIG_DEFAULTS.daily_reroll_cap,
      );
    }
    // 0 is legal and means "publish the first roll, whatever it scores".
    liveValues({ daily_reroll_cap: 0 });
    expect((await readFrozenRemoteConfig()).rerollCap).toBe(0);
  });

  it('freezes the §13 defaults when the template cannot be read at all', async () => {
    mocks.templateError = new Error('remote config unavailable');
    const frozen = await readFrozenRemoteConfig();

    expect(frozen.pieceCount).toBe(REMOTE_CONFIG_DEFAULTS.daily_piece_count);
    expect(frozen.tuning.score_clear_base).toBe(REMOTE_CONFIG_DEFAULTS.score_clear_base);
    expect(frozen.rerollCap).toBe(REMOTE_CONFIG_DEFAULTS.daily_reroll_cap);
    expect(Object.values(frozen.source).every((s) => s === 'default')).toBe(true);
    expect(mocks.warn).toHaveBeenCalled();
  });
});

describe('§8.2 manual re-trigger callable (PRD v1.12 self-heal)', () => {
  it('refuses everyone who is not an admin', async () => {
    const data = { date: '2026-08-09' };
    // Unauthenticated, signed-in-but-not-admin, and the truthy-but-not-true
    // claim an attacker would hope for.
    await expect(callable.run({ data })).rejects.toThrow(/Admin only/);
    await expect(callable.run({ data, auth: { uid: 'mallory', token: {} } })).rejects.toThrow(
      /Admin only/,
    );
    await expect(
      callable.run({
        data,
        auth: { uid: 'mallory', token: { admin: 'yes' as unknown as boolean } },
      }),
    ).rejects.toThrow(/Admin only/);
  });

  it('validates the date before doing any work', async () => {
    for (const date of [undefined, '', 'tomorrow', '2026-8-9', 42, { date: '2026-08-09' }]) {
      await expect(callable.run({ data: { date }, auth: admin })).rejects.toThrow(/YYYY-MM-DD/);
    }
  });
});
