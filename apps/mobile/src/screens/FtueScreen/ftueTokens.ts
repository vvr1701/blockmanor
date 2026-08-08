/**
 * FTUE presentation tokens — PRD §7.1 (v1.11), following the `src/game/juice.ts`
 * convention: every timing/opacity the FTUE overlay uses is a named token here,
 * never an inline literal at a call site.
 *
 * Mockup source: `docs/design/spec/Block Manor Production Spec.dc.html`, panel
 * "1.3 FTUE — Level 1" (the L1 cold-open treatment: title/subtitle banner, no
 * dim) and panel "11.2 Mechanic callouts ×4" ("board dims to 32%... one line
 * of copy, no OK button" — reused here for L2-L4's new-mechanic callouts).
 */

/** 11.2: "board dims to 32%" — i.e. the scrim sits at 68% opacity over what
 * it covers, leaving 32% of the underlying board visible through it. */
export const FTUE_DIM_OVERLAY_OPACITY = 0.68;

/** Callout banner (title+subtitle) fade-in, ms. Not PRD-specified — quick
 * enough to feel immediate on a level's cold open. */
export const FTUE_CALLOUT_FADE_MS = 280;

/** Hand-cursor demonstration loop (§7.1.1 "Hand cursor demonstrates drag"),
 * one full cycle ms. Not PRD-specified — slow enough to read as a deliberate
 * demonstration, not a flicker. */
export const FTUE_HAND_CURSOR_LOOP_MS = 1400;
