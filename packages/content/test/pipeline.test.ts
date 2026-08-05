/** Generator, bot and harness — PRD §5 Stage-0 tooling, §7.9 pipeline. */

import { describe, expect, it } from 'vitest';
import {
  applyPlacement,
  createGame,
  getLegalPlacements,
  type GameConfig,
} from '@blockmanor/engine';
import { chooseMove, playout } from '../src/bot';
import { generateLevel, type PatternClass } from '../src/generator';
import { measureLevel, REFERENCE_TUNING } from '../src/harness';
import { parseLevel } from '../src/schema';

const base = (over: Record<string, unknown> = {}) => ({
  id: 1,
  chapter: 1,
  seedSalt: 'S',
  density: 0.25,
  pattern: 'scatter' as PatternClass,
  ...over,
});

const configFor = (json: unknown): GameConfig => ({
  mode: 'level',
  tuning: REFERENCE_TUNING,
  level: parseLevel(json),
});

describe('generator (PRD §5 tooling, §7.7 output)', () => {
  it('is a pure function of its params — same dials, same level', () => {
    expect(generateLevel(base())).toEqual(generateLevel(base()));
  });

  it('changes the board when the seedSalt changes', () => {
    // The salt IS the layout. Measuring one salt and shipping another would
    // invalidate the balance evidence, so this must never collapse.
    expect(generateLevel(base({ seedSalt: 'A' }))).not.toEqual(
      generateLevel(base({ seedSalt: 'B' })),
    );
  });

  it('honours density as a fraction of the 64 cells', () => {
    expect(generateLevel(base({ density: 0.25 })).prefill).toHaveLength(16);
    expect(generateLevel(base({ density: 0.5 })).prefill).toHaveLength(32);
    expect(generateLevel(base({ density: 0 })).prefill).toHaveLength(0);
  });

  it('places exactly the requested obstacle mix, rest plain blocks', () => {
    const level = generateLevel(base({ density: 0.25, obstacles: { crate: 3, ivy: 2 } }));
    const counts = (level.prefill ?? []).reduce<Record<string, number>>((acc, cell) => {
      acc[cell.type] = (acc[cell.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.crate).toBe(3);
    expect(counts.ivy).toBe(2);
    expect(counts.filled).toBe(11);
  });

  it('produces visibly different shapes per pattern class', () => {
    const shape = (pattern: PatternClass): string =>
      JSON.stringify(generateLevel(base({ pattern, density: 0.25 })).prefill);
    const shapes = new Set(
      (['edges', 'bands', 'scatter', 'mid-fragments'] as PatternClass[]).map(shape),
    );
    expect(shapes.size).toBe(4);
  });

  it('refuses an obstacle mix the density cannot hold', () => {
    expect(() => generateLevel(base({ density: 0.03, obstacles: { crate: 8 } }))).toThrow(
      /density too low/,
    );
  });

  it('emits levels that pass the §7.7 schema', () => {
    expect(() => parseLevel(generateLevel(base({ obstacles: { crate: 2 } })))).not.toThrow();
  });
});

describe('greedy bot (level-authoring policy)', () => {
  const cfg = configFor(generateLevel(base({ obstacles: { crate: 2 } })));

  it('replays identically for the same (game seed, bot seed)', () => {
    const a = playout(cfg, 'g1', 'b1');
    const b = playout(cfg, 'g1', 'b1');
    expect(b.moves).toEqual(a.moves);
    expect(b.result).toEqual(a.result);
  });

  it('is sensitive to the bot seed — tiebreaks are seeded, not positional', () => {
    const runs = ['b1', 'b2', 'b3', 'b4', 'b5'].map((s) => JSON.stringify(playout(cfg, 'g1', s)));
    expect(new Set(runs).size).toBeGreaterThan(1);
  });

  it('only ever returns a legal placement', () => {
    let state = createGame(cfg, 'legal');
    for (let i = 0; i < 12 && state.status === 'playing'; i++) {
      const move = chooseMove(state, { s: 1 });
      if (!move) break;
      const legal = getLegalPlacements(state, move.pieceIndex);
      expect(legal.some((p) => p.r === move.r && p.c === move.c)).toBe(true);
      state = applyPlacement(state, move).state;
    }
  });

  it('takes a line clear when one is available', () => {
    // Row 0 is one cell short at (0,7); a P01 there clears it. The bot must
    // prefer that over any of the many non-clearing placements.
    const state = createGame({ mode: 'endless', tuning: REFERENCE_TUNING }, 'clear');
    state.board.occ[0] = 0b01111111;
    for (let c = 0; c < 7; c++) state.board.kinds[c] = 'filled';
    state.tray = [{ pieceId: 'P01', used: false }];

    const move = chooseMove(state, { s: 7 });
    expect(move).toEqual({ pieceIndex: 0, r: 0, c: 7 });
  });
});

describe('harness (PRD §7.9)', () => {
  const spec = { level: parseLevel(generateLevel(base({ obstacles: { crate: 2 } }))), target: 0.5 };

  it('produces identical numbers across runs — the report is re-derivable', () => {
    expect(measureLevel(spec, 30)).toEqual(measureLevel(spec, 30));
  });

  it('flags a level outside the ±10pp band', () => {
    const measured = measureLevel(spec, 30);
    const impossible = measureLevel({ ...spec, target: measured.winRate + 0.5 }, 30);
    expect(impossible.withinTolerance).toBe(false);
    expect(measureLevel({ ...spec, target: measured.winRate }, 30).withinTolerance).toBe(true);
  });

  it('suggests star thresholds with s3 strictly above s2 (§7.5)', () => {
    const { suggestedStars } = measureLevel(spec, 40);
    expect(suggestedStars.s3).toBeGreaterThan(suggestedStars.s2);
  });

  it('measures against the §13 registry defaults, not ad-hoc numbers', () => {
    expect(REFERENCE_TUNING).toEqual({
      mercy_threshold: 0.55,
      mercy_small_prob: 0.65,
      score_clear_base: 10,
      combo_step: 0.25,
      perfect_clear_bonus: 300,
    });
  });
});
