/**
 * `playCue`'s §12.1 mute gate. §12.1's acceptance: "the SFX/music toggles
 * actually silence their channels." `playCue` is a deliberate no-op (§15.1,
 * blocked on real audio assets) so there is nothing to silence YET — the
 * testable half is that muted `sfxEnabled: false` stops the call from being
 * REACHED, which `playCue`'s return value makes directly assertable
 * (`false` = muted before anything would have played).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { playCue } from '../src/game/sfx';
import { useMetaStore } from '../src/state/useMetaStore';

beforeEach(() => {
  useMetaStore.setState({ sfxEnabled: true });
});

describe('playCue (PRD §12.1)', () => {
  it('is REACHED (returns true) when SFX is enabled — the default', () => {
    expect(playCue('btn_tap')).toBe(true);
  });

  it('is NOT reached (returns false) when SFX is muted', () => {
    useMetaStore.getState().setSfxEnabled(false);
    expect(playCue('btn_tap')).toBe(false);
  });

  it('re-enabling SFX makes it reachable again — the gate reads LIVE state, not a cached snapshot', () => {
    useMetaStore.getState().setSfxEnabled(false);
    expect(playCue('clear_chime', 2)).toBe(false);
    useMetaStore.getState().setSfxEnabled(true);
    expect(playCue('clear_chime', 2)).toBe(true);
  });

  it('the gate applies uniformly across every cue name, not just one', () => {
    useMetaStore.getState().setSfxEnabled(false);
    const cues = [
      'piece_pick',
      'snap_thock',
      'clear_chime',
      'combo_layer',
      'perfect_gliss',
      'near_death_amb',
      'win_fanfare',
      'fail_thud',
      'btn_tap',
      'btn_gold',
      'star_slam',
      'chest_open',
      'modal_open',
      'modal_close',
    ] as const;
    for (const cue of cues) {
      expect(playCue(cue), `"${cue}" was reached while muted`).toBe(false);
    }
  });
});
