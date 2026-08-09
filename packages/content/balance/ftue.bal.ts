/**
 * FTUE scripted-level gate — PRD §7.1, §0 v1.11 amendment.
 *
 * L1–L5 are hand-authored teaching boards (designed `prefill` + a fixed
 * `pieceSequence`, §4.3), not generator output. They are exempt from the
 * §7.9 bot-measured targets and the ±10pp band: a fixed-sequence tutorial
 * board wins by construction, so a 500-seed bot sweep over it would measure
 * nothing.
 *
 * This is the replacement gate: replay each level's OWN `pieceSequence`
 * through the engine via the designed move script and assert BOTH
 *   1. the level is winnable by that sequence, AND
 *   2. the specific teaching beat the level exists to teach actually fires —
 *      a row clear (L1), a column clear (L2), a multi-line combo with
 *      `comboDisplay >= 2` (L3), a crate destroyed AND the crate goal
 *      reaching 0 (L4), a normal win (L5).
 * Every assertion below reads the engine's own `GameEvent[]` — never a
 * re-derivation of the clearing/combo/goal rules. A scripted level that is
 * winnable but never fires its lesson is a broken tutorial that a
 * winnability-only gate would pass; that is exactly what this file exists to
 * catch.
 *
 * §0 v1.11 (extended): L1-L5 are teaching levels, not skill tests — they
 * award 3 stars on completion, unconditionally; no s2/s3 skill thresholds;
 * first real star pressure begins at L6. Mechanically this is `stars:
 * {s2:0, s3:0}` in each level file — the engine's own `starsFor` (§6.6,
 * untouched) awards star 3 the moment `score >= s3`, and every scripted win
 * here scores > 0, so 0/0 forces 3 stars by construction without any engine
 * or schema change. Asserted below against the engine's own `LEVEL_WON`
 * event, never re-derived.
 */

import { describe, expect, it } from 'vitest';
import {
  applyPlacement,
  createGame,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Move,
} from '@blockmanor/engine';
import { FTUE_LEVELS } from '../src/ftueLevels';
import { REFERENCE_TUNING } from '../src/harness';
import { parseLevel, type LevelJson } from '../src/schema';

const levelById = (id: number): LevelJson => {
  const json = FTUE_LEVELS.find((l) => l.id === id);
  if (!json) throw new Error(`FTUE level ${id} not found in FTUE_LEVELS`);
  return json;
};

/** Replay a designed move script through the engine, collecting every event
 * from every placement — not just the final one, since e.g. L3's teaching
 * beat fires on the SECOND of three placements. */
function replay(
  json: LevelJson,
  moves: readonly Move[],
): { state: GameState; events: GameEvent[] } {
  const config: GameConfig = {
    mode: 'level',
    tuning: REFERENCE_TUNING,
    level: parseLevel(json),
    ...(json.pieceSequence ? { pieceSequence: json.pieceSequence } : {}),
  };
  let state = createGame(config, `ftue-replay-L${json.id}`);
  const events: GameEvent[] = [];
  for (const move of moves) {
    const result = applyPlacement(state, move);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

describe('FTUE scripted levels L1-L5 (PRD §7.1, §0 v1.11)', () => {
  it('L1 teaches a ROW clear and is winnable by its own sequence', () => {
    const json = levelById(1);
    expect(json.pieceSequence).toEqual(['P01', 'P02', 'P05']);
    const { state, events } = replay(json, [
      { pieceIndex: 0, r: 7, c: 7 }, // P01 dot completes row 7
      { pieceIndex: 1, r: 0, c: 0 }, // P02 duo-h decoy
      { pieceIndex: 2, r: 0, c: 3 }, // P05 tri-v decoy
    ]);
    expect(state.status).not.toBe('lost');
    expect(state.status).toBe('completed'); // no goals: sequence exhaustion is the "win"
    expect(events.some((e) => e.type === 'LINES_CLEARED' && e.rows.length >= 1)).toBe(true);
  });

  it('L2 teaches a COLUMN clear and is winnable by its own sequence', () => {
    const json = levelById(2);
    expect(json.pieceSequence).toEqual(['P01', 'P02', 'P05']);
    const { state, events } = replay(json, [
      { pieceIndex: 0, r: 7, c: 0 }, // P01 dot completes column 0
      { pieceIndex: 1, r: 0, c: 2 }, // P02 duo-h decoy
      { pieceIndex: 2, r: 0, c: 5 }, // P05 tri-v decoy
    ]);
    expect(state.status).not.toBe('lost');
    expect(state.status).toBe('completed');
    expect(events.some((e) => e.type === 'LINES_CLEARED' && e.cols.length >= 1)).toBe(true);
  });

  it('L3 teaches a MULTI-LINE COMBO (comboDisplay >= 2) and is winnable by its own sequence', () => {
    const json = levelById(3);
    expect(json.pieceSequence).toEqual(['P01', 'P01', 'P02']);
    const { state, events } = replay(json, [
      { pieceIndex: 0, r: 5, c: 0 }, // P01 dot completes row 5 -> comboDisplay 1
      { pieceIndex: 1, r: 6, c: 0 }, // P01 dot completes row 6 -> comboDisplay 2
      { pieceIndex: 2, r: 0, c: 0 }, // P02 duo-h decoy, no clear
    ]);
    expect(state.status).not.toBe('lost');
    expect(state.status).toBe('completed');
    const clears = events.filter((e) => e.type === 'LINES_CLEARED');
    expect(clears).toHaveLength(2);
    expect(clears.some((e) => e.type === 'LINES_CLEARED' && e.comboDisplay >= 2)).toBe(true);
  });

  it('L4 teaches the FIRST CRATE GOAL: crate destroyed AND the goal reaching 0', () => {
    const json = levelById(4);
    expect(json.pieceSequence).toEqual(['P01']);
    expect(json.goals).toEqual([{ type: 'crate', count: 1 }]);
    const { state, events } = replay(json, [{ pieceIndex: 0, r: 7, c: 7 }]);
    expect(state.status).toBe('won');
    expect(events.some((e) => e.type === 'LEVEL_WON')).toBe(true);
    expect(
      events.some((e) => e.type === 'OBSTACLE_HIT' && e.obstacle === 'crate' && e.destroyed),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'GOAL_PROGRESS' && e.goal === 'crate' && e.remaining === 0),
    ).toBe(true);
    // §0 v1.11 (extended): teaching levels award 3 stars unconditionally.
    const won = events.find((e) => e.type === 'LEVEL_WON');
    expect(won?.type === 'LEVEL_WON' && won.stars).toBe(3);
  });

  it('L5 is a NORMAL WIN (free play) by its own sequence', () => {
    const json = levelById(5);
    expect(json.pieceSequence).toEqual(['P02', 'P01']);
    expect(json.goals).toEqual([{ type: 'crate', count: 1 }]);
    const { state, events } = replay(json, [
      { pieceIndex: 0, r: 0, c: 0 }, // P02 duo-h decoy
      { pieceIndex: 1, r: 6, c: 7 }, // P01 dot completes row 6, destroys the crate, wins
    ]);
    expect(state.status).toBe('won');
    expect(events.some((e) => e.type === 'LEVEL_WON')).toBe(true);
    // §0 v1.11 (extended): teaching levels award 3 stars unconditionally.
    const won = events.find((e) => e.type === 'LEVEL_WON');
    expect(won?.type === 'LEVEL_WON' && won.stars).toBe(3);
  });

  it('L1-L3 carry no crate goal — L4 is the first (§7.1 / §0 v1.11 teaching order)', () => {
    for (const id of [1, 2, 3]) {
      expect(levelById(id).goals, `L${id}`).toEqual([]);
    }
  });

  it('L1-L5 carry no skill thresholds — stars {s2:0, s3:0} (§0 v1.11 extended)', () => {
    for (const id of [1, 2, 3, 4, 5]) {
      expect(levelById(id).stars, `L${id}`).toEqual({ s2: 0, s3: 0 });
    }
  });
});
