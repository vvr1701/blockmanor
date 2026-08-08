/**
 * The audio seam — PRD §7.4 / §15.1. Deliberately out of scope THIS session:
 * §15.1's own rule is "every named cue above MUST exist before its screen
 * ships — no silent interactions on rewarding moments", and this repo has
 * zero audio assets, so shipping a sprite sheet now would either violate
 * that rule (missing cues) or invent placeholder sounds §15.1 also forbids.
 * §7.4 additionally names `expo-av`, which Expo deprecated in favor of
 * `expo-audio` on SDK 57 — wiring either up before real assets exist is a
 * premature amendment, not an oversight.
 *
 * `playCue` is the ONE seam every §7.4 juice moment calls through — a no-op
 * today, so dropping in the real sprite sheet later is a one-file change:
 * swap this function's body for an `expo-audio` player lookup, nothing else
 * in `JuiceLayer.tsx`/`DragLayer.tsx` moves.
 */

/** The §15.1 "Gameplay (from §7.4)" cue inventory — exactly the 8 names this
 * session's juice table calls, spelled exactly as §15.1 requires (file names
 * are permanent). */
export type SfxCue =
  | 'piece_pick'
  | 'snap_thock'
  | 'clear_chime'
  | 'combo_layer'
  | 'perfect_gliss'
  | 'near_death_amb'
  | 'win_fanfare'
  | 'fail_thud';

/**
 * No-op: blocked on audio assets (see header). `semitones` is accepted now
 * (clear_chime's §6.6/§7.4 pitch-per-combo requirement) so call sites don't
 * need to change when this stops being a no-op.
 */
export function playCue(_cue: SfxCue, _semitones = 0): void {
  // Intentionally empty — see file header.
}
