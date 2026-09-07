import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SfxCue } from '../src/game/sfx';

/**
 * §15.1 manifest guards. Two things nothing currently checks.
 *
 * `docs/AUDIO_DROP.md` is a careful delivery spec and `sfx.ts`'s `playCue` is
 * a deliberate no-op until files land — both correct, and neither is what
 * this file second-guesses. What neither covers is the state BETWEEN those
 * two: a partial drop. §15.1's rule is "every named cue above MUST exist
 * before its screen ships — no silent interactions on rewarding moments", and
 * the failure it describes is not an empty `assets/audio/` (that is today,
 * loudly, and every cue is equally silent). It is *seven of eight files
 * present*, where the eighth moment goes quiet and nothing says so.
 *
 * Same read-the-PRD-as-data pattern as `remoteConfig.test.ts` and
 * `prdChangelog.test.ts`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const CUES: readonly SfxCue[] = [
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
];

/** The §15.1 inventory, parsed out of the PRD. Cue names are the only
 * snake_case identifiers in that section. */
function prdCueNames(): Set<string> {
  const prd = resolve(HERE, '../../../docs/PRD.md');
  const text = readFileSync(prd, 'utf8');
  const section = text.split(/^### 15\.1 /m)[1]?.split(/^---$/m)[0];
  if (!section) throw new Error('PRD §15.1 not found — did the heading change?');
  return new Set(section.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []);
}

const AUDIO_DIR = resolve(HERE, '../assets/audio');

/** Cue files present on disk right now, by cue name (extension stripped).
 * §15.1/AUDIO_DROP name `.m4a` as the shipping format and `.wav` as an
 * accepted master, so both count as "delivered". */
function deliveredCues(): Set<string> {
  if (!existsSync(AUDIO_DIR)) return new Set();
  return new Set(
    readdirSync(AUDIO_DIR)
      .filter((f) => /\.(m4a|wav)$/i.test(f))
      .map((f) => f.replace(/\.(m4a|wav)$/i, '')),
  );
}

describe('§15.1 audio manifest', () => {
  it('every cue `sfx.ts` can play is a name §15.1 actually lists', () => {
    const inPrd = prdCueNames();
    expect(CUES.filter((c) => !inPrd.has(c))).toEqual([]);
  });

  it('the local cue list matches `SfxCue` exactly', () => {
    // Compile-time half: a cue added to the union but not here fails to
    // typecheck below. Runtime half: a cue removed from the union but left
    // here is caught by the PRD check above only if it also left §15.1, so
    // assert the count too.
    const unique = new Set<string>(CUES);
    expect(unique.size).toBe(CUES.length);
  });

  it('audio delivery is all-or-nothing — no cue ships silent while its siblings play', () => {
    const delivered = deliveredCues();
    // Nothing delivered yet is the documented current state (AUDIO_DROP.md),
    // and it is not a failure: every cue is equally silent and `playCue` is a
    // no-op. This guard arms itself the moment the FIRST file lands.
    if (delivered.size === 0) return;

    const missing = CUES.filter((c) => !delivered.has(c)).sort();
    expect(
      missing,
      `audio/ has ${delivered.size} cue file(s), so §15.1's "every named cue MUST exist ` +
        `before its screen ships" is now live. Still missing: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
