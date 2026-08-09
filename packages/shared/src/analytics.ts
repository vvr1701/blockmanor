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

/** Keyed by §14 event name; extend per-section as each PRD subsection lands. */
export interface AnalyticsEvents {
  ftue_step: FtueStepParams;
  ftue_complete: FtueCompleteParams;
}

export type AnalyticsEventName = keyof AnalyticsEvents;
