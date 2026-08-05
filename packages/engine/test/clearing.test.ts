/** Clearing & scoring — PRD §6.5, §6.6. */

import { describe, expect, it } from 'vitest';
import { findFullLines } from '../src/clearing';
import { cellKind, fillCount, isOccupied } from '../src/board';
import { createGame } from '../src/simulate';
import { boardFrom, config, eventsOf, play, setTray, TUNING } from './helpers';

/** Row 3 and column 5 are each one cell short — of the SAME cell (3,5). */
const INTERSECTION = [
  '.....#..',
  '.....#..',
  '.....#..',
  '#####.##',
  '.....#..',
  '.....#..',
  '.....#..',
  '.....#..',
];

describe('clearing (PRD §6.5)', () => {
  it('clears the union of full rows and columns, counting an intersection once', () => {
    const state = createGame(config('endless'), 'x');
    state.board = boardFrom(INTERSECTION);
    setTray(state, ['P01', 'P01', 'P01']);

    const { state: next, events } = play(state, 0, 3, 5);
    const [cleared] = eventsOf(events, 'LINES_CLEARED');

    expect(cleared?.rows).toEqual([3]);
    expect(cleared?.cols).toEqual([5]);
    // 8 + 8 - 1: the intersection cell is in the union exactly once.
    expect(cleared?.cells).toHaveLength(15);
    expect(new Set(cleared?.cells.map((c) => `${c.r},${c.c}`)).size).toBe(15);
    expect(fillCount(next.board)).toBe(0);
  });

  it('scores the union once — 10 × 15 cells × 2 lines (§6.6)', () => {
    const state = createGame(config('endless'), 'x');
    state.board = boardFrom(INTERSECTION);
    setTray(state, ['P01', 'P01', 'P01']);
    const { events } = play(state, 0, 3, 5);
    const [cleared] = eventsOf(events, 'LINES_CLEARED');
    expect(cleared?.points).toBe(10 * 15 * 2);
  });

  it('clears multiple simultaneously-full rows atomically', () => {
    const state = createGame(config('endless'), 'x');
    state.board = boardFrom([
      '#######.',
      '#######.',
      '#######.',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    setTray(state, ['P05', 'P01', 'P01']);
    const { state: next, events } = play(state, 0, 0, 7);
    const [cleared] = eventsOf(events, 'LINES_CLEARED');
    expect(cleared?.rows).toEqual([0, 1, 2]);
    expect(cleared?.cells).toHaveLength(24);
    expect(cleared?.points).toBe(10 * 24 * 3);
    expect(fillCount(next.board)).toBe(0);
  });

  it('applies no gravity — surviving blocks never move (§6.5)', () => {
    const state = createGame(config('endless'), 'x');
    state.board = boardFrom([
      '#######.',
      '#.....#.',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    setTray(state, ['P01', 'P01', 'P01']);
    const { state: next } = play(state, 0, 0, 7);
    expect(isOccupied(next.board, 0, 0)).toBe(false);
    expect(cellKind(next.board, 1, 0)).toBe('filled');
    expect(cellKind(next.board, 1, 6)).toBe('filled');
    expect(cellKind(next.board, 2, 0)).toBe('empty');
  });

  it('detects nothing on a board with no full line', () => {
    expect(findFullLines(boardFrom(['#######.', ...Array(7).fill('........')]))).toEqual({
      rows: [],
      cols: [],
    });
  });
});

describe('combo (PRD §6.6)', () => {
  /** Rows 0..3 each one cell short in column 7 — four independent single-row clears. */
  const LADDER = [
    '#######.',
    '#######.',
    '#######.',
    '#######.',
    '........',
    '........',
    '........',
    '........',
  ];

  it('multiplies by the PRE-increment counter and reports the post-increment level', () => {
    let state = createGame(config('endless'), 'combo');
    state.board = boardFrom(LADDER);
    setTray(state, ['P01', 'P01', 'P01']);

    const first = play(state, 0, 0, 7);
    state = first.state;
    expect(eventsOf(first.events, 'LINES_CLEARED')[0]?.points).toBe(10 * 8 * 1); // ×1.0
    expect(eventsOf(first.events, 'LINES_CLEARED')[0]?.comboDisplay).toBe(1);
    expect(state.combo).toBe(1);

    const second = play(state, 1, 1, 7);
    state = second.state;
    expect(eventsOf(second.events, 'LINES_CLEARED')[0]?.points).toBe(Math.floor(10 * 8 * 1 * 1.25));
    expect(eventsOf(second.events, 'LINES_CLEARED')[0]?.comboDisplay).toBe(2);

    const third = play(state, 2, 2, 7);
    expect(eventsOf(third.events, 'LINES_CLEARED')[0]?.points).toBe(Math.floor(10 * 8 * 1 * 1.5));
  });

  it('survives ONE non-clearing placement and resets on the SECOND (§6.6 boundary)', () => {
    let state = createGame(config('endless'), 'combo2');
    state.board = boardFrom(LADDER);
    setTray(state, ['P01', 'P01', 'P01']);

    state = play(state, 0, 0, 7).state; // clear → combo 1
    expect(state.combo).toBe(1);

    // Miss #1 — combo held.
    const miss1 = play(state, 1, 7, 0);
    state = miss1.state;
    expect(state.combo).toBe(1);
    expect(state.missStreak).toBe(1);
    expect(eventsOf(miss1.events, 'COMBO_RESET')).toHaveLength(0);

    // A clear here would still use the held combo.
    const held = play(state, 2, 1, 7);
    expect(eventsOf(held.events, 'LINES_CLEARED')[0]?.points).toBe(Math.floor(10 * 8 * 1 * 1.25));

    // Miss #2 instead — combo resets to 0 and the renderer is told.
    setTray(state, ['P01', 'P01', 'P01']);
    const miss2 = play(state, 0, 7, 1);
    expect(miss2.state.combo).toBe(0);
    expect(eventsOf(miss2.events, 'COMBO_RESET')).toHaveLength(1);

    // No repeat event once the counter is already 0.
    const miss3 = play(miss2.state, 1, 7, 2);
    expect(eventsOf(miss3.events, 'COMBO_RESET')).toHaveLength(0);
  });
});

describe('perfect clear (PRD §6.6)', () => {
  it('pays the flat bonus when the board is empty after a clear', () => {
    const state = createGame(config('endless'), 'pc');
    state.board = boardFrom(['#######.', ...Array(7).fill('........')]);
    setTray(state, ['P01', 'P01', 'P01']);
    const { state: next, events } = play(state, 0, 0, 7);

    expect(eventsOf(events, 'PERFECT_CLEAR')[0]?.bonus).toBe(300);
    expect(next.score).toBe(1 + 10 * 8 * 1 + 300);
    expect(fillCount(next.board)).toBe(0);
  });

  it('pays nothing when a block survives the clear', () => {
    const state = createGame(config('endless'), 'pc2');
    state.board = boardFrom(['#######.', '#.......', ...Array(6).fill('........')]);
    setTray(state, ['P01', 'P01', 'P01']);
    const { events } = play(state, 0, 0, 7);
    expect(eventsOf(events, 'PERFECT_CLEAR')).toHaveLength(0);
  });
});

describe('[RC] values are plumbed, never hardcoded (§13)', () => {
  const tuned = {
    ...TUNING,
    score_clear_base: 20,
    combo_step: 1,
    perfect_clear_bonus: 7,
  };

  it('changing score_clear_base / combo_step / perfect_clear_bonus changes the outcome', () => {
    let state = createGame(config('endless', { tuning: tuned }), 'rc');
    state.board = boardFrom([
      '#######.',
      '#######.',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    setTray(state, ['P01', 'P01', 'P01']);

    const first = play(state, 0, 0, 7);
    state = first.state;
    expect(eventsOf(first.events, 'LINES_CLEARED')[0]?.points).toBe(20 * 8 * 1); // base 20, combo 0

    const second = play(state, 1, 1, 7);
    // combo_step 1 → second consecutive clear doubles.
    expect(eventsOf(second.events, 'LINES_CLEARED')[0]?.points).toBe(20 * 8 * 1 * 2);
    expect(eventsOf(second.events, 'PERFECT_CLEAR')[0]?.bonus).toBe(7);
  });
});
