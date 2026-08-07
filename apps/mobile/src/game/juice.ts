/**
 * Named tokens for input/animation feel — PRD §7.3 and §7.4. One file for
 * the whole feel layer (the juice-implementation skill: "src/game/juice.ts
 * holds EVERY timing/scale/offset as named tokens matching PRD §7.4") so
 * tuning is "edit a token", not "hunt for a literal".
 *
 * Every value below is either lifted verbatim from §7.3/§7.4's exact-values
 * list or, where the PRD is silent on a specific number, called out as a
 * deliberate judgment call with the reasoning inline — flagged in the
 * delivery report per the "propose a value, PRD amends before the token
 * changes" rule.
 */

import { ImpactFeedbackStyle } from 'expo-haptics';

// --- lift (§7.3: "piece lifts: scale to 100% board scale, offset -80px
// above finger, shadow + slight tilt (2°)"; §7.4 "Piece lift | scale-up
// 120ms | selection" adds the TRANSITION into that end-state and its haptic
// — §7.3 already owns the end-state (100% scale) and the illegal-drop
// haptic below; §7.4 doesn't duplicate either.) ------------------------------

/** §7.4 exact: the lift's tray-scale -> 100%-board-scale transition, ms. */
export const LIFT_SCALE_UP_MS = 120;

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

/**
 * §7.4 "Legal snap | 90ms spring settle | impactLight" — the legal-release
 * haptic. Distinct token from `ILLEGAL_DROP_HAPTIC_STYLE` below even though
 * both currently resolve to the same `ImpactFeedbackStyle.Light`: they fire
 * on opposite outcomes (success vs. mis-drop) and §7.4/§7.3 spec them
 * independently, so a future retune of one must never silently move the
 * other.
 */
export const LEGAL_SNAP_HAPTIC_STYLE = ImpactFeedbackStyle.Light;

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
 * "Light error haptic" (§7.3, illegal release only). §7.3's own wording is a
 * plain-English description, not one of §7.4's literal expo-haptics
 * identifiers (`impactLight`, `notificationError`, ...),
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

// =============================================================================
// §7.4 juice table — clear/combo/perfect/near-death/win/fail. Driven by
// `GameEvent[]` (§4.3) in `JuiceLayer.tsx`, never by re-deriving engine rules.
// =============================================================================

// --- line clear (§7.4: "per-cell pop 320ms staggered 12ms/cell outward from
// placement, star particles, +N floating score | impactMedium") -----------

/** Per-cell pop duration, ms, PRD-exact. Each cleared cell's own scale/fade
 * tween runs this long, starting at that cell's individual stagger delay
 * below — NOT one shared tween across all cells. */
export const CLEAR_POP_MS = 320;
/** Stagger step, ms per cell of distance from the placement, PRD-exact
 * ("outward from the placement"). Distance is the Euclidean distance in
 * board cells from the just-placed piece's own centroid (the anchor a
 * player's eye is on) to each cleared cell — §7.4 doesn't name a distance
 * metric; Euclidean reads as a radial ripple, which is the plain reading of
 * "outward", vs. the square rings a grid (Chebyshev) distance would give. */
export const CLEAR_POP_STAGGER_MS_PER_CELL = 12;
/** Peak scale a popping cell reaches before fading out. Not PRD-specified —
 * a modest overshoot so the pop reads as a "pop" and not a plain fade. */
export const CLEAR_POP_PEAK_SCALE = 1.35;
export const CLEAR_HAPTIC_STYLE = ImpactFeedbackStyle.Medium;

/**
 * Star-particle count per clear burst, originating at the placement centroid.
 * §7.4 says "star particles" with no count/asset — the asset pipeline (§15)
 * has no star sprite yet, so these render as small gold sparks (`GlossyBlock`-
 * style dots), not literal 5-point stars; swap the shape when a real sprite
 * lands. Kept modest (not one per cleared cell) so a full-board perfect
 * clear (up to 64 cells) never spawns 64+ particles on a Redmi-class GPU.
 */
export const CLEAR_PARTICLE_COUNT = 10;
export const CLEAR_PARTICLE_MS = CLEAR_POP_MS;
/** How far a particle travels from the burst origin, in board cells. */
export const CLEAR_PARTICLE_TRAVEL_CELLS = 1.6;

/** Floating "+N" score text: rise + fade duration, ms. Not PRD-specified —
 * tied to the cell-pop duration so the score number resolves in the same
 * beat as the cells it's scoring. */
export const FLOATING_SCORE_MS = CLEAR_POP_MS;
export const FLOATING_SCORE_RISE_PX = 40;

// --- multi-line / combo (§7.4: "above + screen flash 8% white 80ms +
// COMBO xN! text slam | impactHeavy | layered chime") -----------------------

/**
 * Judgment call (flag for PRD amendment): §7.4's own row is titled
 * "Multi-line" but its haptic/text/audio are the streak-COMBO beat, and
 * §6.6's explicit ruling ties "COMBO xN!" to `comboDisplay` — "that is the
 * combo *level* the renderer announces ('COMBO x2!')" — not to how many
 * lines cleared simultaneously in one placement. This session reads the row
 * literally against that ruling: the extra layer (flash + text + heavier
 * haptic) fires when `comboDisplay >= MULTI_LINE_COMBO_MIN`, i.e. this clear
 * continues a streak, using the engine's own field with no re-derivation.
 * `comboDisplay` is 1 on a first clear (§6.6) and 2 on the second consecutive
 * clearing placement, so `2` is "second-or-later in the streak".
 */
export const MULTI_LINE_COMBO_MIN = 2;
export const MULTI_LINE_FLASH_OPACITY = 0.08;
export const MULTI_LINE_FLASH_MS = 80;
export const MULTI_LINE_HAPTIC_STYLE = ImpactFeedbackStyle.Heavy;
/** "COMBO xN!" text slam: scale/opacity-in duration, ms. Not PRD-specified —
 * fast enough to read as a "slam", not an ease. */
export const COMBO_TEXT_SLAM_MS = 160;
/** ...then holds before fading, ms. Not PRD-specified. */
export const COMBO_TEXT_HOLD_MS = 280;

// --- perfect clear (§7.4: "gold fullscreen shimmer 600ms | notificationSuccess") -

export const PERFECT_CLEAR_SHIMMER_MS = 600;

// --- near-death (§7.4: "red edge vignette pulse 1.2s loop, fill>0.8 | none") -

/**
 * Fill-ratio threshold, PRD-exact ("fill>0.8"). Deliberately a `juice.ts`
 * code token, NOT [RC]: §0 changelog 1.5 rules "§7.4 juice timings and all
 * animation/layout numbers stay code-side tokens" — distinct from the
 * engine's own `mercy_threshold` [RC] tuning knob, which happens to often
 * carry a similar value but is a different concept (mercy draw odds, not a
 * visual warning cue).
 */
export const NEAR_DEATH_FILL_THRESHOLD = 0.8;
/** One full pulse cycle (fade in + out), ms — PRD-exact "1.2s loop". */
export const NEAR_DEATH_PULSE_MS = 1200;
/** Peak opacity of the pulsing red edge. Not PRD-specified — enough to read
 * as a warning without obscuring the board underneath it. */
export const NEAR_DEATH_PEAK_OPACITY = 0.35;
/** Reduced-motion: the LOOP is a continuous motion effect (this session's
 * reading of "disables shakes" — an unending pulse is the same category of
 * motion as a shake, not the one-shot core feedback the rule protects), so
 * it stops; the informational cue itself must not vanish, so a static tint
 * at this fixed opacity replaces the pulse instead of disappearing outright. */
export const NEAR_DEATH_STATIC_OPACITY = 0.18;

// --- level win (§7.4: "stars slam in x3 (200ms apart), confetti | notificationSuccess") -

export const WIN_STAR_COUNT = 3;
export const WIN_STAR_STAGGER_MS = 200;
/** Each star's own slam-in duration, ms. Not PRD-specified — fast enough
 * that 3 staggered slams (200ms apart) don't visually overlap-mush together. */
export const WIN_STAR_SLAM_MS = 180;
/** Confetti piece count + fall/fade duration. §7.4 names no numbers for
 * either — this is the board-side celebration only (§7.5's win SCREEN is a
 * later session), so a modest burst rather than a full-screen system. */
export const WIN_CONFETTI_COUNT = 16;
export const WIN_CONFETTI_MS = 900;

// --- fail (§7.4: "desaturate board 400ms | notificationError") -------------

export const FAIL_DESATURATE_MS = 400;
