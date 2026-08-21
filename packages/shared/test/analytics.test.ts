import { describe, expect, it } from 'vitest';
import {
  MAX_PARAM_VALUE_LENGTH,
  clampParamValueLengths,
  defineAnalyticsEvents,
} from '../src/analytics';

/**
 * Restores the tests lost with the rest of the §14 analytics-infra worktree
 * (recovered by salvage commit 115cf89; see CLAUDE.md / v1.15 PRD row). The
 * compile-time machinery in `src/analytics.ts` is NOT rewritten here — these
 * are regression tests over it, split into:
 *  (a) runtime behavior (`clampParamValueLengths`, `defineAnalyticsEvents`
 *      pass-through) — real assertions, actually executed;
 *  (b) type-level proofs (`@ts-expect-error`) — only meaningful under
 *      `tsc --noEmit` (the `typecheck` CI job). vitest's esbuild transform
 *      strips types and DOES execute these calls at runtime, so each has a
 *      trivial `expect` after it purely so the test body is non-empty; the
 *      actual assertion is "this line requires an error to compile clean."
 */

describe('clampParamValueLengths', () => {
  it('truncates string values over the Firebase 100-char cap', () => {
    const long = 'x'.repeat(MAX_PARAM_VALUE_LENGTH + 20);
    const out = clampParamValueLengths({ note: long });
    expect(out.note).toHaveLength(MAX_PARAM_VALUE_LENGTH);
    expect(out.note).toBe(long.slice(0, MAX_PARAM_VALUE_LENGTH));
  });

  it('leaves short strings and non-string values untouched', () => {
    const out = clampParamValueLengths({ level: 3, ok: true, name: 'short' });
    expect(out).toEqual({ level: 3, ok: true, name: 'short' });
  });
});

describe('defineAnalyticsEvents (runtime pass-through)', () => {
  it('returns a valid events map unchanged', () => {
    const events = defineAnalyticsEvents({ widget_tap: { surface: 'home' } });
    expect(events).toEqual({ widget_tap: { surface: 'home' } });
  });
});

describe('AssertValidEvents compile-time guard — type-level proofs', () => {
  it('accepts a well-formed event (no error expected)', () => {
    defineAnalyticsEvents({ ok_event: { a: 1, b: 'two' } });
    expect(true).toBe(true);
  });

  it('rejects an event name over the 40-char Firebase cap', () => {
    // @ts-expect-error — event name is 41 chars, over WithinLength's 40 cap.
    defineAnalyticsEvents({ this_event_name_is_definitely_over_forty_chars: { a: 1 } });
    expect(true).toBe(true);
  });

  it('rejects the firebase_/google_/ga_ reserved name PREFIXES', () => {
    // @ts-expect-error — `firebase_` is a reserved prefix.
    defineAnalyticsEvents({ firebase_screen_view: { a: 1 } });
    // @ts-expect-error — `google_` is a reserved prefix.
    defineAnalyticsEvents({ google_ads_conversion: { a: 1 } });
    // @ts-expect-error — `ga_` is a reserved prefix.
    defineAnalyticsEvents({ ga_session_id: { a: 1 } });
    expect(true).toBe(true);
  });

  it('rejects Firebase-reserved EXACT event names (v1.15 / MAJOR-4)', () => {
    // @ts-expect-error — `first_open` is auto-collected by the SDK, per the
    // §14 v1.15 amendment; hand-firing it is silently dropped.
    defineAnalyticsEvents({ first_open: { a: 1 } });
    // @ts-expect-error — `session_start` is auto-collected by the SDK.
    defineAnalyticsEvents({ session_start: { a: 1 } });
    expect(true).toBe(true);
  });

  it('accepts exactly 25 named params (the Firebase cap)', () => {
    // 25 explicitly-named keys — an object literal, not an index signature,
    // so this exercises ParamCountOk itself rather than the param-NAME-length
    // rule an index signature would trip instead (the MINOR audit finding).
    defineAnalyticsEvents({
      wide_event: {
        p1: 1,
        p2: 1,
        p3: 1,
        p4: 1,
        p5: 1,
        p6: 1,
        p7: 1,
        p8: 1,
        p9: 1,
        p10: 1,
        p11: 1,
        p12: 1,
        p13: 1,
        p14: 1,
        p15: 1,
        p16: 1,
        p17: 1,
        p18: 1,
        p19: 1,
        p20: 1,
        p21: 1,
        p22: 1,
        p23: 1,
        p24: 1,
        p25: 1,
      },
    });
    expect(true).toBe(true);
  });

  it('rejects 26 named params, the ≤25 cap regression (MINOR audit finding)', () => {
    defineAnalyticsEvents({
      // @ts-expect-error — 26 named keys, one over ParamCountOk's cap of 25.
      too_wide_event: {
        p1: 1,
        p2: 1,
        p3: 1,
        p4: 1,
        p5: 1,
        p6: 1,
        p7: 1,
        p8: 1,
        p9: 1,
        p10: 1,
        p11: 1,
        p12: 1,
        p13: 1,
        p14: 1,
        p15: 1,
        p16: 1,
        p17: 1,
        p18: 1,
        p19: 1,
        p20: 1,
        p21: 1,
        p22: 1,
        p23: 1,
        p24: 1,
        p25: 1,
        p26: 1,
      },
    });
    expect(true).toBe(true);
  });

  it('rejects a param name over the 40-char cap', () => {
    // @ts-expect-error — the param key is 41 chars, over the cap.
    defineAnalyticsEvents({ ev: { this_param_name_is_definitely_over_forty_chars: 1 } });
    expect(true).toBe(true);
  });
});
