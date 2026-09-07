/**
 * §7.11 layout-reservation constants — §0 rule 2a: "Layout reservations …
 * that a current-stage section explicitly specs (… §7.11 S2–S4 nav/HUD
 * slots) ARE in scope; they must render nothing and read no later-stage
 * state." Named here (not inline) so a Stage-2/3/4 PR that fills a slot in
 * finds the exact size this build reserved for it, same pattern as
 * `FailScreen`'s `CONTINUE_SLOT_RESERVED_HEIGHT`.
 */

/** (a) HUD bar: each of the two coin/life chip reservations (§9.1/§9.2,
 * Stage 2). Approximates the mockup's pill-chip width so Stage 2 doesn't
 * reflow the bar when it fills these in. */
export const HUD_ECONOMY_SLOT_WIDTH = 56;

/** (a) HUD bar icon chips (settings gear / profile avatar / level-map
 * affordance) — square touch targets, §15 a11y floor. */
export const HUD_ICON_SIZE = 44;

/** (f) event banner carousel slot (§13 `flag_events`, Stage 4). */
export const EVENT_BANNER_SLOT_HEIGHT = 92;
