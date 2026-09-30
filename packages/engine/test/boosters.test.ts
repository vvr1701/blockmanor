/** Boosters — PRD §9.3 (hammer / broom / hourglass) as pure engine actions. */

import { describe, expect, it } from 'vitest';
import { cellColor, cellKind, type CellKind } from '../src/board';
import {
  IllegalMoveError,
  applyBooster,
  createGame,
  type BoosterAction,
  type GameState,
} from '../src/simulate';
import {
  assertTerminalEventPairing,
  boardFrom,
  config,
  eventsOf,
  level,
  play,
  setTray,
} from './helpers';

const EMPTY = '........';

function gameWith(rows: readonly string[], goals: Record<string, unknown>[] = []): GameState {
  const state = createGame(config('level', { level: level({ goals }) }), 'boosters');
  state.board = boardFrom(rows);
  setTray(state, ['P01', 'P01', 'P01']);
  return state;
}

/** One obstacle at (0,0) on an otherwise empty board. */
const lone = (ch: string): string[] => [`${ch}.......`, ...Array<string>(7).fill(EMPTY)];

describe('hammer (PRD §9.3)', () => {
  it('destroys a plain block', () => {
    const { state, events } = applyBooster(gameWith(lone('#')), { type: 'hammer', r: 0, c: 0 });
    expect(cellKind(state.board, 0, 0)).toBe('empty');
    expect(events).toEqual([{ type: 'BOOSTER_USED', booster: 'hammer', cells: [{ r: 0, c: 0 }] }]);
  });

  // "counts as a hit": for every obstacle the hammer's outcome must equal what a
  // line clear through that cell does — same resulting cell, same OBSTACLE_HIT,
  // same goal credit. The line clear is the oracle, not a re-derivation of §7.8.
  const cases: [string, CellKind, string][] = [
    ['c', 'empty', 'crate'],
    ['d', 'crate', 'crate'], // crate2 hit 1 of 2 → crate, credits nothing
    ['h', 'filled', 'chain'], // chain breaks, the block stays
    ['i', 'empty', 'ivy'],
    ['x', 'empty', 'heirloom'],
  ];
  for (const [ch, after, goal] of cases) {
    it(`hits '${ch}' exactly like one line clear through it`, () => {
      const goals = [{ type: goal, count: 3 }];
      const hammered = applyBooster(gameWith(lone(ch), goals), { type: 'hammer', r: 0, c: 0 });
      const lined = play(
        gameWith([`${ch}######.`, ...Array<string>(7).fill(EMPTY)], goals),
        0,
        0,
        7,
      );

      expect(cellKind(hammered.state.board, 0, 0)).toBe(after);
      expect(cellKind(lined.state.board, 0, 0)).toBe(after);
      expect(eventsOf(hammered.events, 'OBSTACLE_HIT')).toEqual(
        eventsOf(lined.events, 'OBSTACLE_HIT'),
      );
      expect(eventsOf(hammered.events, 'GOAL_PROGRESS')).toEqual(
        eventsOf(lined.events, 'GOAL_PROGRESS'),
      );
      expect(hammered.state.goals).toEqual(lined.state.goals);
    });
  }

  it('crate2 takes two hammers; only the 2nd credits the crate goal (§7.8)', () => {
    const first = applyBooster(gameWith(lone('d'), [{ type: 'crate', count: 1 }]), {
      type: 'hammer',
      r: 0,
      c: 0,
    });
    expect(first.state.goals[0]?.remaining).toBe(1);
    expect(first.state.status).toBe('playing');

    const second = applyBooster(first.state, { type: 'hammer', r: 0, c: 0 });
    expect(cellKind(second.state.board, 0, 0)).toBe('empty');
    expect(second.state.goals[0]?.remaining).toBe(0);
  });

  it('chain: the surviving block keeps its colour', () => {
    const { state } = applyBooster(gameWith(lone('h')), { type: 'hammer', r: 0, c: 0 });
    expect(cellColor(state.board, 0, 0)).toBe(1);
  });

  it('destroying ivy restarts the §7.8 spread window, as a line clear does', () => {
    const state = gameWith(lone('i'));
    state.placements = 4;
    const next = applyBooster(state, { type: 'hammer', r: 0, c: 0 }).state;
    expect(next.lastIvyDestroyedAt).toBe(4);
  });

  it('refuses an empty cell, an off-board or fractional target', () => {
    const state = gameWith(lone('#'));
    for (const action of [
      { type: 'hammer', r: 0, c: 1 },
      { type: 'hammer', r: 8, c: 0 },
      { type: 'hammer', r: -1, c: 0 },
      { type: 'hammer', r: 0, c: 0.5 },
    ] as const) {
      expect(() => applyBooster(state, action)).toThrow(IllegalMoveError);
    }
  });
});

describe('broom (PRD §9.3)', () => {
  it('hits every occupied cell of the row once, obstacles per §7.8, other rows untouched', () => {
    const state = gameWith(
      ['#c.dh.i#', '########', ...Array<string>(6).fill(EMPTY)],
      [
        { type: 'crate', count: 5 },
        { type: 'chain', count: 5 },
        { type: 'ivy', count: 5 },
      ],
    );
    const { state: next, events } = applyBooster(state, { type: 'broom', row: 0 });

    expect([...Array(8).keys()].map((c) => cellKind(next.board, 0, c))).toEqual([
      'empty',
      'empty',
      'empty',
      'crate',
      'filled',
      'empty',
      'empty',
      'empty',
    ]);
    expect(eventsOf(events, 'BOOSTER_USED')[0]?.cells).toEqual(
      [0, 1, 3, 4, 6, 7].map((c) => ({ r: 0, c })),
    );
    expect(eventsOf(events, 'OBSTACLE_HIT').map((e) => [e.obstacle, e.destroyed])).toEqual([
      ['crate', true],
      ['crate2', false],
      ['chain', false],
      ['ivy', true],
    ]);
    expect(next.goals.map((g) => g.remaining)).toEqual([4, 4, 4]);
    // Row 1 is full but is NOT a line clear — a booster never triggers §6.5 clearing.
    for (let c = 0; c < 8; c++) expect(cellKind(next.board, 1, c)).toBe('filled');
  });

  it('refuses an empty row and an off-board row', () => {
    const state = gameWith(lone('#'));
    expect(() => applyBooster(state, { type: 'broom', row: 1 })).toThrow(IllegalMoveError);
    expect(() => applyBooster(state, { type: 'broom', row: 8 })).toThrow(IllegalMoveError);
  });
});

describe('hourglass (PRD §9.3)', () => {
  it('deals a fresh 3-piece tray from the run RNG, deterministically', () => {
    const state = gameWith(lone('#'));
    state.tray[0] = { pieceId: 'P01', used: true };
    const a = applyBooster(state, { type: 'hourglass' });
    const b = applyBooster(state, { type: 'hourglass' });

    expect(a).toEqual(b);
    expect(a.state.tray).toHaveLength(3);
    expect(a.state.tray.every((s) => !s.used)).toBe(true);
    expect(a.state.rng.s).not.toBe(state.rng.s);
    const refill = eventsOf(a.events, 'TRAY_REFILLED')[0];
    expect(refill?.pieces).toEqual(a.state.tray.map((s) => s.pieceId));
    expect(a.events[0]).toEqual({ type: 'BOOSTER_USED', booster: 'hourglass', cells: [] });
  });

  it('a dead redraw ends the run with GAME_OVER (§6.3 guarantee exhausted, §6.7)', () => {
    const state = gameWith(Array<string>(8).fill('cccccccc'));
    const { state: next, events } = applyBooster(state, { type: 'hourglass' });
    expect(next.status).toBe('lost');
    expect(eventsOf(events, 'GAME_OVER')).toHaveLength(1);
    assertTerminalEventPairing(next.status, events);
  });

  it('is refused on a fixed pieceSequence (no "new draw" exists), hammer is not', () => {
    const state = createGame(
      config('level', { level: level(), pieceSequence: ['P01', 'P01', 'P01', 'P01'] }),
      's',
    );
    state.board = boardFrom(lone('#'));
    expect(() => applyBooster(state, { type: 'hourglass' })).toThrow(IllegalMoveError);
    expect(applyBooster(state, { type: 'hammer', r: 0, c: 0 }).state.status).toBe('playing');
  });
});

describe('booster invariants (PRD §9.3, §4.3)', () => {
  const ACTIONS: BoosterAction[] = [
    { type: 'hammer', r: 0, c: 0 },
    { type: 'broom', row: 0 },
    { type: 'hourglass' },
  ];

  it('is not a placement: no score, combo, miss streak or ivy-cadence change, no clear events', () => {
    for (const action of ACTIONS) {
      const state = gameWith(lone('#'));
      Object.assign(state, { score: 50, combo: 2, missStreak: 1, placements: 7 });
      const { state: next, events } = applyBooster(state, action);
      expect([next.score, next.combo, next.missStreak, next.placements]).toEqual([50, 2, 1, 7]);
      // Hammer/broom empty the board here, yet no PERFECT_CLEAR: §6.6's bonus is a placement's.
      for (const t of ['LINES_CLEARED', 'PERFECT_CLEAR', 'PIECE_PLACED', 'COMBO_RESET'] as const) {
        expect(eventsOf(events, t)).toHaveLength(0);
      }
    }
  });

  it('never mutates the input state', () => {
    for (const action of ACTIONS) {
      const state = gameWith(lone('d'));
      const before = JSON.stringify(state);
      applyBooster(state, action);
      expect(JSON.stringify(state)).toBe(before);
    }
  });

  it('meeting the last goal wins with LEVEL_WON (§6.7, §4.3 pairing)', () => {
    const state = gameWith(lone('c'), [{ type: 'crate', count: 1 }]);
    state.score = 1234;
    const { state: next, events } = applyBooster(state, { type: 'hammer', r: 0, c: 0 });
    expect(next.status).toBe('won');
    expect(eventsOf(events, 'LEVEL_WON')).toEqual([{ type: 'LEVEL_WON', score: 1234, stars: 2 }]);
    assertTerminalEventPairing(next.status, events);
  });

  it('is refused on a finished game and anywhere on the Daily Board (§8.5)', () => {
    const done = gameWith(lone('#'));
    done.status = 'lost';
    const daily = createGame(config('daily'), 'd');
    daily.board = boardFrom(lone('#'));
    for (const action of ACTIONS) {
      expect(() => applyBooster(done, action)).toThrow(IllegalMoveError);
      expect(() => applyBooster(daily, action)).toThrow(IllegalMoveError);
    }
  });
});
