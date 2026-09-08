import { useMetaStore } from '../state/useMetaStore';

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

/** The §15.1 cue names this session's call sites reach: the "Gameplay (from
 * §7.4)" 8 (`JuiceLayer`/`DragLayer`), plus the §7.5 audit mn-4 UI/reward
 * cues (`GoldButton`, `GhostButton`, `WinScreen`), §7.10's `chest_open`
 * (`LevelMapScreen`'s chest sheet) and §12.2's `modal_open`/`modal_close`
 * (`PauseSheet`) — spelled exactly as §15.1 requires (file names are
 * permanent). */
export type SfxCue =
  | 'piece_pick'
  | 'snap_thock'
  | 'clear_chime'
  | 'combo_layer'
  | 'perfect_gliss'
  | 'near_death_amb'
  | 'win_fanfare'
  | 'fail_thud'
  | 'btn_tap'
  | 'btn_gold'
  | 'star_slam'
  | 'chest_open'
  | 'modal_open'
  | 'modal_close';

/**
 * No-op today beyond its §12.1 mute gate: blocked on audio assets (see file
 * header). `semitones` is accepted now (clear_chime's §6.6/§7.4
 * pitch-per-combo requirement) so call sites don't need to change when this
 * stops being a no-op.
 *
 * §12.1's acceptance is explicit that the SFX toggle "actually silences its
 * channel" — with nothing behind the no-op to silence, the only thing that
 * can honestly be muted is the CALL itself: `sfxEnabled: false` returns
 * before any future playback code (or asset lookup) would run.
 *
 * Returns whether the cue was actually REACHED (`true`) or muted before
 * anything would have played (`false`). No call site today reads this —
 * every one of them still fires `playCue('...')` with no receiver — it
 * exists so the mute gate has an observable effect to assert against
 * without needing a real audio side effect: "assert `playCue` is not
 * reached when muted" is exactly `expect(playCue(cue)).toBe(false)`.
 */
export function playCue(_cue: SfxCue, _semitones = 0): boolean {
  if (!useMetaStore.getState().sfxEnabled) return false;
  // Intentionally empty beyond the gate — see file header.
  return true;
}
