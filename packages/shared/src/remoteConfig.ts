/**
 * Remote Config registry — PRD §13.
 *
 * PRD §0.3 + §13: every `[RC]` value in the PRD is a Remote Config key with the
 * default listed here, and is NEVER hardcoded at a call site. This file is the
 * single code-side source of those defaults; `useConfigStore` snapshots the
 * fetched values over them (PRD §4.4).
 *
 * Stage flags default per their stage (PRD §0.5): Stage-1 flags on, later stages off.
 */

export type RemoteConfigValue = number | boolean | string;

export const REMOTE_CONFIG_DEFAULTS = {
  // --- Flags (PRD §13) ---
  flag_daily_board: true,
  flag_endless: true,
  flag_share_card: true,
  flag_push: true,
  flag_economy: false,
  flag_ads: false,
  flag_iap: false,
  flag_manor: false,
  flag_events: false,
  /** §7.11(g) Team tab (S4). Its own key, not `flag_events` — sharing one
   * would make enabling Events silently unhide Team (§0 v1.20). */
  flag_team: false,

  // --- Modes (§7.6) ---
  /** §7.6 Endless gate. "Unlocked after Level 10" means `currentLevel > 10`
   * — completed and moved on, not mid-attempt on 10 (§0 v1.18). */
  endless_unlock_level: 10,

  // --- Engine & scoring (§6.4, §6.6) ---
  mercy_threshold: 0.55,
  mercy_small_prob: 0.65,
  score_clear_base: 10,
  combo_step: 0.25,
  perfect_clear_bonus: 300,

  // --- Daily board (§8) ---
  daily_piece_count: 60,
  daily_reroll_cap: 5,
  daily_streak_min_moves: 3,
  daily_push_hour: 8,
  streak_repair_price: 89,

  // --- Economy (§9, Stage 2) ---
  starting_coin_balance: 500,
  coins_level_win_base: 40,
  coins_per_star: 10,
  coins_chest: 150,
  coins_daily_complete: 50,
  continue_price_1: 900,
  continue_price_2: 1200,
  continue_price_3: 1600,
  continue_max_per_attempt: 3,
  second_chance_daily_cap: 1,
  relief_clear_cells: 12,
  booster_price_hammer: 600,
  booster_price_broom: 800,
  booster_price_hourglass: 500,
  lives_max: 5,
  life_refill_price: 900,
  life_regen_minutes: 30,
  life_forfeit_min_moves: 3,
  winstreak_thresholds: '2:1,3:2,5:2+200',

  // --- Ads (§10.1, §10.2, Stage 2) ---
  interstitial_min_level: 12,
  interstitial_cooldown_s: 180,
  interstitial_daily_cap: 10,
  interstitial_iap_suppress_h: 24,
  rv_daily_cap: 8,
  rv_life_daily_cap: 2,
  rv_double_coins_multiplier: 2,
  streak_repair_ads: 3,
  wheel_free_spins: 1,
  wheel_ad_spins: 1,
  // Prize set + odds; the §10.1 odds disclosure renders from this table (P6).
  wheel_prize_table: JSON.stringify([
    { prize: 'coins', amount: 50, weight: 30 },
    { prize: 'coins', amount: 100, weight: 25 },
    { prize: 'coins', amount: 300, weight: 10 },
    { prize: 'booster', amount: 1, weight: 20 },
    { prize: 'life', amount: 1, weight: 15 },
  ]),

  // --- IAP (§10.3, Stage 2) ---
  starter_pack_trigger_level: 15,
  starter_pack_offer_ttl_h: 24,
  starter_pack_repeat_level: 25,
  remove_ads_prompt_cooldown_d: 7,
  streak_freeze_max: 2,
  iap_pending_timeout_s: 10,

  // --- Analytics (§14) ---
  /** Cap on the on-device event dispatch queue (apps/mobile analytics
   * service). Over-cap events are dropped oldest-first; `dropped_count` is
   * kept alongside so funnel denominators are never silently wrong. */
  analytics_queue_cap: 500,

  // --- App lifecycle (§12.5, §12.10, §12.11) ---
  min_supported_version: '0.1.0',
  latest_version: '0.1.0',
  maintenance_mode: false,
  review_prompt_enabled: true,
} as const satisfies Record<string, RemoteConfigValue>;

export type RemoteConfigKey = keyof typeof REMOTE_CONFIG_DEFAULTS;
/**
 * The snapshot `useConfigStore` holds. Keys stay exact (the registry is the
 * contract, PRD §13), but each value widens to its PRIMITIVE type: the
 * defaults object is `as const`, so without this a fetched override like
 * `applySnapshot({ mercy_threshold: 0.91 })` fails to typecheck against the
 * literal type `0.55`.
 */
export type RemoteConfigSnapshot = {
  [K in RemoteConfigKey]: (typeof REMOTE_CONFIG_DEFAULTS)[K] extends boolean
    ? boolean
    : (typeof REMOTE_CONFIG_DEFAULTS)[K] extends number
      ? number
      : string;
};

/** PRD §13: RC fetch TTL — cold start plus this interval. */
export const REMOTE_CONFIG_TTL_MS = 6 * 60 * 60 * 1000;

/** A sanity bound on one numeric Remote Config key. */
export interface NumberBound {
  min: number;
  max: number;
  integer: boolean;
}

/**
 * Sanity bounds for Remote Config numbers, shared by the §8.2 generator (which
 * freezes values into an immutable daily board) and the app's live snapshot.
 * ONE table, so the server and the client can never disagree about what a
 * valid push looks like.
 *
 * Deliberately wide: a typo/corruption guard, not balance policy. Balance lives
 * in Remote Config (§13) and anything inside a bound is honoured verbatim. The
 * failure these exist for is concrete — the admin SDK's `asNumber()` renders an
 * unparseable value as 0, and a console typo like `-5` is finite, so neither is
 * caught by a finiteness check alone.
 *
 * Only keys something actually reads today are bounded. Stage-2 economy/ads/IAP
 * keys have no reader yet; bound them in the PR that adds one.
 */
export const REMOTE_CONFIG_BOUNDS = {
  // §6.4 probabilities.
  mercy_threshold: { min: 0, max: 1, integer: false },
  mercy_small_prob: { min: 0, max: 1, integer: false },
  // §6.6 scoring. `score_clear_base: 0` would make every clear worth nothing,
  // which is exactly the `asNumber()` failure mode, so 0 is out of band.
  score_clear_base: { min: 1, max: 10_000, integer: false },
  combo_step: { min: 0, max: 10, integer: false },
  perfect_clear_bonus: { min: 0, max: 1_000_000, integer: false },
  // §8.2 sequence length. Must be a positive integer or `drawSequence` throws.
  daily_piece_count: { min: 1, max: 1_000, integer: true },
  // §8.2 re-rolls. Each costs 200 bot playouts (~2s), so the ceiling is the
  // function timeout, not taste. 0 is legal and means "no re-roll".
  daily_reroll_cap: { min: 0, max: 20, integer: true },
  // §8.6 streak threshold. 0 would make `moves.length >= 0` always true — the
  // streak for opening the board and quitting (§0 v1.19(v)) — so 1 is the floor.
  daily_streak_min_moves: { min: 1, max: 1_000, integer: true },
  // §8.7 local push hour: a clock hour, nothing else is meaningful.
  daily_push_hour: { min: 0, max: 23, integer: true },
  // §7.6 Endless gate: a level number.
  endless_unlock_level: { min: 1, max: 1_000, integer: true },
  // §14 queue cap: 0 would drop every event ever tracked.
  analytics_queue_cap: { min: 1, max: 100_000, integer: true },
} as const satisfies Partial<Record<RemoteConfigKey, NumberBound>>;

/** True unless `key` has a bound that `value` violates. Unbounded keys pass. */
export function isWithinBounds(key: RemoteConfigKey, value: number): boolean {
  const bound = (REMOTE_CONFIG_BOUNDS as Partial<Record<RemoteConfigKey, NumberBound>>)[key];
  if (!bound) return true;
  return value >= bound.min && value <= bound.max && (!bound.integer || Number.isInteger(value));
}
