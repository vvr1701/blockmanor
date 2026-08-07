/**
 * Named tokens for input/animation feel — PRD §7.3 (this session) and §7.4
 * (a later session, deliberately not started here — see CLAUDE.md rule 1 /
 * the juice-implementation skill: "src/game/juice.ts holds EVERY
 * timing/scale/offset as named tokens matching PRD §7.4", one file for the
 * whole feel layer so tuning is "edit a token", not "hunt for a literal").
 *
 * Every value below is either lifted verbatim from §7.3's exact-values list
 * or, where §7.3 is silent on a specific number, called out as a deliberate
 * judgment call with the reasoning inline — flagged in the delivery report
 * per the "propose a value, PRD amends before the token changes" rule.
 */

import { ImpactFeedbackStyle } from 'expo-haptics';

// --- lift (§7.3: "piece lifts: scale to 100% board scale, offset -80px
// above finger, shadow + slight tilt (2°)") ---------------------------------

/** px the lifted piece's visual center sits ABOVE the finger (thumb visibility). */
export const LIFT_OFFSET_Y = 80;
/** The lifted piece renders at 100% of the BOARD's cell scale (not the tray's
 * §7.2 50%) — i.e. it switches from tray geometry to board geometry the
 * instant it's picked up. Kept as a named 1.0 for PRD-traceability, not because
 * the math needs a variable. */
export const LIFT_BOARD_SCALE = 1;
/** deg, constant while lifted (not an animated wobble — §7.3 just says "slight
 * tilt"; a fixed tilt for the drag's duration is the plain reading of that). */
export const LIFT_TILT_DEG = 2;

/** Drop shadow under the lifted piece (§7.3 "shadow"). §7.3 gives no exact
 * shadow numbers — chosen to read clearly against both light and dark board
 * backgrounds; revisit if the PRD amends with exact values. */
export const LIFT_SHADOW_DX = 0;
export const LIFT_SHADOW_DY = 6;
export const LIFT_SHADOW_BLUR = 8;
export const LIFT_SHADOW_COLOR = 'rgba(0,0,0,0.35)';

// --- ghost preview (§7.3: "nearest legal anchor within snap radius (0.6
// cell) shows the piece footprint tinted --ok green at 45% opacity; illegal
// hover shows red tint 45% on the footprint") -------------------------------

/** Snap radius, in board cells, PRD-exact. */
export const SNAP_RADIUS_CELLS = 0.6;
/** Ghost footprint tint opacity, PRD-exact (both legal and illegal). */
export const GHOST_TINT_OPACITY = 0.45;
/** How far outside the board (in cells) the raw drag position may still be
 * before the ghost hides entirely (still "over the tray", not a hover at
 * all). §7.3 doesn't give this number — a generous single-cell margin reads
 * as "clearly not over the board" without the ghost flickering at the edge. */
export const GHOST_HIDE_MARGIN_CELLS = 1;

// --- release (§7.3: "Release on a legal anchor -> snap-in 90ms spring;
// illegal -> piece returns to tray 180ms ease-out + light error haptic +
// board container 4px shake") -----------------------------------------------

/** Legal release: snap-in spring duration, ms, PRD-exact. */
export const SNAP_SPRING_MS = 90;
/** Spring damping ratio — <1 gives the "spring" its settle character without
 * the piece visibly overshooting off its cell. Not PRD-specified; tunable. */
export const SNAP_SPRING_DAMPING_RATIO = 0.75;

/** Illegal release: return-to-tray duration, ms, PRD-exact. */
export const RETURN_EASE_MS = 180;

/** Illegal release: board container shake, px, PRD-exact ("4px shake").
 * Reduced-motion disables this (§7.4 rule: "disables shakes... not core
 * feedback") but keeps the haptic and the return tween. */
export const BOARD_SHAKE_PX = 4;
/** Total shake duration, ms. Not PRD-specified — one quick back-forth-settle
 * cycle read against the 180ms return tween it plays alongside. */
export const BOARD_SHAKE_MS = 200;

/**
 * "Light error haptic" (§7.3, illegal release only — the ONLY haptic in this
 * session's scope; every other §7.4 haptic mapping is next session).
 * §7.3's own wording is a plain-English description, not one of §7.4's
 * literal expo-haptics identifiers (`impactLight`, `notificationError`, ...),
 * so it doesn't collide with either of those reserved names. Read as
 * "light" = intensity (the lightest ImpactFeedbackStyle) + "error" =
 * semantics (fires only on the illegal path). If this reads wrong on device,
 * the alternative is `Haptics.notificationAsync(NotificationFeedbackType.Error)` —
 * propose the swap against the PRD rather than silently changing it.
 */
export const ILLEGAL_DROP_HAPTIC_STYLE = ImpactFeedbackStyle.Light;

// --- hitboxes (§7.3: "min 64x64dp touch target regardless of visual size") -

/** dp, PRD-exact. The tray renders pieces at 50% board-cell scale (§7.2
 * v1.8), so this is deliberately independent of any piece's visual size. */
export const TRAY_HITBOX_MIN_DP = 64;
