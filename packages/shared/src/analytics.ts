/**
 * Analytics event taxonomy — PRD §14 ("names are permanent API"). Single
 * source of typed params (CLAUDE.md rule 4: "fires its analytics events (PRD
 * §14) with typed params from packages/shared"). Every feature PR extends
 * `AnalyticsEvents` with the events of the PRD subsection it implements —
 * this file currently carries only §7.1 FTUE's row of the §14 taxonomy
 * (`ftue_step{step} · ftue_complete`); later sections add theirs alongside.
 */

/**
 * §7.1 FTUE step checkpoints. Not literally named in the PRD (§7.1 only says
 * "FTUE steps fire `ftue_step {step}` events"), so the concrete values are
 * this session's naming: one per script beat in §7.1's numbered list — the
 * five scripted levels (§7.1.2) plus the post-L5 name/avatar screen
 * (§7.1.3) — fired once each, on entering that step. `ftue_complete` (below)
 * marks the following Home-reveal boundary, so no separate `home_reveal`
 * step is needed here.
 */
export type FtueStep = 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'name_avatar';

export interface FtueStepParams {
  step: FtueStep;
}

export interface FtueCompleteParams {
  /** §7.1.3: "guest allowed" — true if the player skipped the name/avatar
   * claim rather than setting a name. */
  guest: boolean;
}

/**
 * §7.5 win/fail + the level-start beat that precedes them (§14: "level_start
 * {id,attempt} · level_complete{...} · level_fail{...}"). `attempt` is the
 * 1-based count of times this level has been (re)started this session (§7.5
 * free/unlimited Stage-1 Retry bumps it); `continues`/`boosters_used` are
 * named as permanent §14 API ahead of their Stage-2 mechanics (§9.4/§9.3) —
 * always `0` until those land, never omitted.
 */
export interface LevelStartParams {
  id: number;
  attempt: number;
}

export interface LevelCompleteParams {
  id: number;
  score: number;
  /** 1-3, §7.5: star 1 = win, stars 2/3 = the level's `s2`/`s3` score thresholds. */
  stars: number;
  duration_s: number;
  /** Stage-2 §9.4 continue count — always 0 in Stage 1 (no continue behavior yet). */
  continues: number;
  /** Stage-2 §9.3 booster count — always 0 in Stage 1 (no boosters yet). */
  boosters_used: number;
}

export interface LevelFailParams {
  id: number;
  /** 0-100, rounded: aggregate goal completion at the moment the board died. */
  goal_progress_pct: number;
  fill_ratio: number;
}

/** Keyed by §14 event name; extend per-section as each PRD subsection lands. */
export interface AnalyticsEvents {
  ftue_step: FtueStepParams;
  ftue_complete: FtueCompleteParams;
  level_start: LevelStartParams;
  level_complete: LevelCompleteParams;
  level_fail: LevelFailParams;
}

export type AnalyticsEventName = keyof AnalyticsEvents;

/* ------------------------------------------------------------------------ *
 * §14 analytics-infra PR, requirement 1: compile-time Firebase constraint
 * validation. Firebase Analytics' hard limits: event names ≤40 chars, param
 * names ≤40 chars, string param VALUES ≤100 chars, ≤25 params per event, and
 * the `firebase_` / `google_` / `ga_` name prefixes are reserved (Firebase
 * itself rejects/renames them). Names and shape are static — the operator's
 * ruling requires the TYPE SYSTEM reject a violator at build time, not a
 * runtime `if`. Values are dynamic, so those get a runtime guard instead
 * (`clampParamValueLengths`, below the type machinery). Both live here so
 * the constraints travel with `AnalyticsEvents` itself — a future PR extends
 * the interface a few lines up and gets checked by the assertion at the
 * bottom of this block, automatically, with no extra step.
 * ------------------------------------------------------------------------ */

/**
 * True iff string `S` is no longer than `N` characters. Peels one character
 * off per recursion (the standard `${infer Char}${infer Rest}` two-infer
 * trick TS uses to split a string literal type char-by-char). Ceiling:
 * recursion depth = length(S), which TS supports well past 1,000 — every
 * real §14 name is under 60 chars, nowhere near that.
 */
type WithinLength<S extends string, N extends number, Acc extends unknown[] = []> = S extends ''
  ? true
  : Acc['length'] extends N
    ? false
    : S extends `${infer _Char}${infer Rest}`
      ? WithinLength<Rest, N, [...Acc, unknown]>
      : false;

/** Firebase's reserved event/param name prefixes (§14 rule). */
type HasReservedPrefix<S extends string> = S extends
  `firebase_${string}` | `google_${string}` | `ga_${string}`
  ? true
  : false;

/**
 * Firebase-reserved EXACT event/param names — automatically collected by the
 * SDK, so a hand-fired event under one of these names is silently dropped or
 * renamed rather than reaching BigQuery under the name the code used. §14
 * v1.15 amendment (MAJOR-4): `first_open` and `session_start` are the two
 * PRD-named offenders; the rest is the remainder of Firebase's documented
 * automatically-collected event set, added at the same time since the check
 * is free once the mechanism exists. Prefixes are handled separately by
 * `HasReservedPrefix` above — this is exact-name only.
 */
type ReservedName =
  | 'first_open'
  | 'session_start'
  | 'first_visit'
  | 'app_clear_data'
  | 'app_exception'
  | 'app_remove'
  | 'app_update'
  | 'error'
  | 'os_update'
  | 'screen_view'
  | 'user_engagement'
  | 'in_app_purchase'
  | 'notification_dismiss'
  | 'notification_foreground'
  | 'notification_open'
  | 'notification_receive';

/** `S` if it satisfies the length cap, the reserved-prefix ban, AND the
 * reserved-exact-name ban, `never` otherwise. */
type ValidName<S extends string, MaxLen extends number> =
  WithinLength<S, MaxLen> extends true
    ? HasReservedPrefix<S> extends true
      ? never
      : S extends ReservedName
        ? never
        : S
    : never;

/** Firebase event names: ≤40 chars, no reserved prefix. */
export type ValidEventName<S extends string> = ValidName<S, 40>;
/** Firebase param names: ≤40 chars, no reserved prefix. */
export type ValidParamName<S extends string> = ValidName<S, 40>;

/**
 * Maps a params object's keys to `unknown` (fine) or `never` (invalid param
 * name) — intersecting a real object type with this forces every invalid key
 * to `never`, which nothing except `never` itself can satisfy.
 */
export type AssertValidParamNames<P> = {
  [K in keyof P]: K extends string ? (ValidParamName<K> extends never ? never : unknown) : never;
};

// --- ≤25 params/event: counting a mapped type's keys needs a tuple, and
// converting a union (`keyof P`) into a tuple needs the standard
// "distributive last-of-union" trick below. Contained here; key ORDER in the
// resulting tuple is unspecified (TS union order isn't semantic) — only
// `.length` is used, so that doesn't matter. Ceiling: fine for the handful
// of params any real event carries; §14 caps it at 25 anyway.
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;
type LastOfUnion<U> =
  UnionToIntersection<U extends unknown ? () => U : never> extends () => infer R ? R : never;
type UnionToTuple<U, Tup extends unknown[] = []> = [U] extends [never]
  ? Tup
  : UnionToTuple<Exclude<U, LastOfUnion<U>>, [LastOfUnion<U>, ...Tup]>;

/** True iff tuple `Arr` has no more than `N` elements (same peel-and-count
 * shape as `WithinLength`, just over array elements instead of characters). */
type TupleAtMost<
  Arr extends readonly unknown[],
  N extends number,
  Acc extends unknown[] = [],
> = Arr extends readonly []
  ? true
  : Acc['length'] extends N
    ? false
    : Arr extends readonly [unknown, ...infer Rest]
      ? TupleAtMost<Rest, N, [...Acc, unknown]>
      : false;

export type ParamCountOk<P> = TupleAtMost<UnionToTuple<keyof P>, 25>;

/**
 * Per-event validity: event name valid AND params object valid (≤25 params,
 * every param name valid). Maps to `unknown` (fine) or `never` (violation) —
 * same "intersect to force `never`" mechanism as `AssertValidParamNames`.
 *
 * Deliberately unconstrained on `T` (not `T extends Record<...>`): a `T`
 * that's an `interface` (like `AnalyticsEvents`) has no implicit index
 * signature, so it fails both a generic `Record<string, unknown>` CONSTRAINT
 * check and a plain `extends Record<string, unknown>` conditional check, even
 * when every property is fine. `T[K] extends object` below is the loose
 * per-property check that actually works for both interfaces and type
 * aliases — we only need "is an object" to route into the param checks, not
 * strict `Record` compatibility.
 */
export type AssertValidEvents<T> = {
  [K in keyof T]: K extends string
    ? ValidEventName<K> extends never
      ? never
      : T[K] extends object
        ? ParamCountOk<T[K]> extends true
          ? T[K] extends AssertValidParamNames<T[K]>
            ? unknown
            : never
          : never
        : never
    : never;
};

/**
 * Declares an events map with the compile-time §14 guard active — every key
 * that violates the name/length/prefix/param-count rules becomes a `never`
 * parameter slot, so passing any real value there fails `tsc`. Exists for
 * this guarantee to be exercised directly (see the `@ts-expect-error` type
 * tests) without needing to smuggle a bad name into `AnalyticsEvents` itself.
 */
export function defineAnalyticsEvents<T extends Record<string, Record<string, unknown>>>(
  events: T & AssertValidEvents<T>,
): T {
  return events;
}

/**
 * The permanent guard: every event `AnalyticsEvents` carries — today's and
 * every future PR's — must satisfy the §14 Firebase constraints above. If
 * this line fails to compile, an event or param name added elsewhere in this
 * file violates §14; fix the name, not this line. (Assignability check only —
 * never constructed or read at runtime, hence the `as` cast and the `void`.)
 */
export type _AnalyticsEventsSatisfyFirebaseConstraints = AssertValidEvents<AnalyticsEvents>;
const _analyticsEventsGuard: _AnalyticsEventsSatisfyFirebaseConstraints = {} as AnalyticsEvents;
void _analyticsEventsGuard;

/** Firebase's runtime string-param-value cap (§14) — the one genuinely
 * dynamic piece of requirement 1, so it can't be a compile-time check. */
export const MAX_PARAM_VALUE_LENGTH = 100;

/**
 * Clamps every string value in a params object to `MAX_PARAM_VALUE_LENGTH`
 * chars, leaving non-string values untouched. Called at the point params
 * become "real data" (the apps/mobile dispatcher, before an event is queued)
 * so an oversized dynamic value (e.g. a share channel name) degrades to a
 * truncated value instead of the event being silently dropped by Firebase.
 */
export function clampParamValueLengths<T extends object>(params: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] =
      typeof value === 'string' && value.length > MAX_PARAM_VALUE_LENGTH
        ? value.slice(0, MAX_PARAM_VALUE_LENGTH)
        : value;
  }
  return out as T;
}
