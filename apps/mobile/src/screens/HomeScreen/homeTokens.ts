/**
 * §7.11 (a)/(f) size constants. Named here (not inline) so a later PR that
 * fills a slot in finds the exact size this build used for it, same pattern
 * as `FailScreen`'s `CONTINUE_SLOT_RESERVED_HEIGHT`.
 */

/** (a) HUD bar: each of the two coin/life chip RESERVATIONS (§0 rule 2a:
 * "Layout reservations … that a current-stage section explicitly specs (…
 * §7.11 S2–S4 nav/HUD slots) ARE in scope; they must render nothing and read
 * no later-stage state"). These two render unconditionally in Stage 1, empty
 * — real reservations, holding their space now so §9.1/§9.2 drop coin/life
 * icons in later without reflowing the bar. Approximates the mockup's
 * pill-chip width. */
export const HUD_ECONOMY_SLOT_WIDTH = 56;

/** (a) HUD bar icon chips (settings gear / profile avatar / level-map
 * affordance) — square touch targets, §15 a11y floor. */
export const HUD_ICON_SIZE = 44;

/**
 * (f) event banner carousel slot height. NOT a layout reservation like the
 * economy slots above (qa-prd-auditor N-15) — §7.11(f) is explicit that this
 * slot is "hidden via flag" (`flag_events`, Stage 4), so `EventBannerSlot`
 * renders nothing at all while the flag is off, reserving zero space in
 * Stage 1. This constant is only the height it uses on the day it starts
 * rendering.
 */
export const EVENT_BANNER_SLOT_HEIGHT = 92;
