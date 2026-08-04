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

  // --- Engine & scoring (§6.4, §6.6) ---
  mercy_threshold: 0.55,
  mercy_small_prob: 0.65,
  score_clear_base: 10,
  combo_step: 0.25,
  perfect_clear_bonus: 300,

  // --- Daily board (§8) ---
  daily_piece_count: 60,
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

  // --- App lifecycle (§12.5, §12.10, §12.11) ---
  min_supported_version: '0.1.0',
  latest_version: '0.1.0',
  maintenance_mode: false,
  review_prompt_enabled: true,
} as const satisfies Record<string, RemoteConfigValue>;

export type RemoteConfigKey = keyof typeof REMOTE_CONFIG_DEFAULTS;
export type RemoteConfigSnapshot = { [K in RemoteConfigKey]: (typeof REMOTE_CONFIG_DEFAULTS)[K] };

/** PRD §13: RC fetch TTL — cold start plus this interval. */
export const REMOTE_CONFIG_TTL_MS = 6 * 60 * 60 * 1000;
