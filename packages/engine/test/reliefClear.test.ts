/** `reliefClear` — PRD §9.4's continue grant as a pure engine action. */

import { describe, expect, it } from 'vitest';
import { cellKind, setCell, type CellRef } from '../src/board';
import {
  IllegalMoveError,
  applyBooster,
  createGame,
  reliefClear,
  type GameConfig,
  type GameState,
} from '../src/simulate';
import {
  TUNING,
  assertTerminalEventPairing,
  boardFrom,
  config,
  eventsOf,
  level,
  setTray,
} from './helpers';

const FULL = '########';
const EMPTY = '........';
const CRATE_GOAL = [{ type: 'crate', count: 5 }];

/** A level that died with a crate goal unmet, on the given board. */
function lostGame(rows: readonly string[], cfg: Partial<GameConfig> = {}): GameState {
  const state = createGame(config('level', { level: level({ goals: CRATE_GOAL }), ...cfg }), 'rc');
  state.board = boardFrom(rows);
  setTray(state, ['P11', 'P11', 'P11']);
  state.status = 'lost';
  return state;
}

const clearedCells = (s: GameState): CellRef[] =>
  eventsOf(reliefClear(s, 12).events, 'RELIEF_CLEARED')[0]?.cells ?? [];

describe('densest region (PRD §9.4, §0 v1.38(i))', () => {
  it('clears the 12 plain cells nearest the centre: Chebyshev, then row-major', () => {
    // Every window holds 9 → the tie goes to the top-left window, centre (1,1).
    const { events } = reliefClear(lostGame(Array<string>(8).fill(FULL)), 12);
    expect(eventsOf(events, 'RELIEF_CLEARED')[0]).toEqual({
      type: 'RELIEF_CLEARED',
      centre: { r: 1, c: 1 },
      cells: [
        [1, 1], // d=0
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 2],
        [2, 0],
        [2, 1],
        [2, 2], // d=1
        [0, 3],
        [1, 3],
        [2, 3], // d=2, row-major: (0,3) before (3,0)
      ].map(([r, c]) => ({ r, c })),
    });
  });

  it('picks the window with the most OCCUPIED cells, obstacles included', () => {
    // 9 crates top-left vs 8 plain blocks bottom-right: counting plain cells only
    // would pick the bottom-right; §9.4 counts occupancy, so the crates win.
    const crates = 'ccc.....';
    const s = lostGame([crates, crates, crates, EMPTY, EMPTY, '.....###', '.....###', '.....##.']);
    const ev = eventsOf(reliefClear(s, 1).events, 'RELIEF_CLEARED')[0];
    expect(ev?.centre).toEqual({ r: 1, c: 1 });
    // ...and the nearest PLAIN cell is then taken, however far: (5,5) at distance 4.
    expect(ev?.cells).toEqual([{ r: 5, c: 5 }]);
  });

  it('ties on density go to the lowest row, then the lowest column', () => {
    const rows = [EMPTY, EMPTY, EMPTY, '.....##.', '.....##.', EMPTY, '.##.....', '.##.....'];
    // Both 2×2 clusters give 4-cell windows; the first in row-then-column order has
    // top-left (2,4) — lower row than the bottom cluster's, lower column than (2,5).
    expect(eventsOf(reliefClear(lostGame(rows), 1).events, 'RELIEF_CLEARED')[0]?.centre).toEqual({
      r: 3,
      c: 5,
    });
  });

  it('never touches an obstacle: the next-nearest plain cell is taken instead', () => {
    const rows = ['h#######', '#c######', ...Array<string>(6).fill(FULL)];
    const s = lostGame(rows);
    const cells = clearedCells(s);
    expect(cells).not.toContainEqual({ r: 0, c: 0 });
    expect(cells).not.toContainEqual({ r: 1, c: 1 });
    expect(cells).toHaveLength(12);
    const next = reliefClear(s, 12).state;
    expect(cellKind(next.board, 0, 0)).toBe('chain');
    expect(cellKind(next.board, 1, 1)).toBe('crate');
    for (const { r, c } of cells) expect(cellKind(next.board, r, c)).toBe('empty');
  });

  it('clears every plain cell when fewer than `count` exist', () => {
    const s = lostGame(['##cccccc', ...Array<string>(7).fill('cccccccc')]);
    expect(clearedCells(s)).toEqual([
      { r: 0, c: 0 },
      { r: 0, c: 1 },
    ]);
  });
});

describe('redraw and revival (PRD §9.4, §0 v1.38(ii)–(iii))', () => {
  it('revives to playing: RELIEF_CLEARED, then a fresh TRAY_REFILLED, no terminal event', () => {
    const s = lostGame(Array<string>(8).fill(FULL));
    s.tray[0] = { pieceId: 'P11', used: true };
    const { state, events } = reliefClear(s, 12);
    expect(state.status).toBe('playing');
    expect(events.map((e) => e.type)).toEqual(['RELIEF_CLEARED', 'TRAY_REFILLED']);
    expect(eventsOf(events, 'TRAY_REFILLED')[0]?.pieces).toEqual(state.tray.map((t) => t.pieceId));
    expect(state.tray.every((t) => !t.used)).toBe(true);
    assertTerminalEventPairing(state.status, events);
  });

  it('draws exactly what an hourglass would on the CLEARED board (mercy + §6.3 included)', () => {
    // Fill 0.75 before the clear (mercy fires above 0.6), 0.5625 after (it does
    // not), so the RNG position tells which board the redraw was drawn against.
    const rows = [...Array<string>(6).fill(FULL), EMPTY, EMPTY];
    const tuning = { ...TUNING, mercy_threshold: 0.6, mercy_small_prob: 1 };
    const s = lostGame(rows, { tuning });
    const relief = reliefClear(s, 12);

    const oracle = (clear: boolean): GameState => {
      const alive = createGame(s.config, 'rc');
      alive.board = boardFrom(rows);
      alive.rng = { ...s.rng };
      if (clear) for (const { r, c } of clearedCells(s)) setCell(alive.board, r, c, 'empty');
      return applyBooster(alive, { type: 'hourglass' }).state;
    };
    expect(relief.state.tray).toEqual(oracle(true).tray);
    expect(relief.state.rng).toEqual(oracle(true).rng);
    expect(relief.state.rng).not.toEqual(oracle(false).rng);
  });

  it('a relief that still leaves nothing placeable stays lost with one GAME_OVER', () => {
    const { state, events } = reliefClear(lostGame(Array<string>(8).fill('cccccccc')), 12);
    expect(state.status).toBe('lost');
    expect(events.map((e) => e.type)).toEqual(['RELIEF_CLEARED', 'TRAY_REFILLED', 'GAME_OVER']);
    expect(eventsOf(events, 'RELIEF_CLEARED')[0]?.cells).toEqual([]);
    assertTerminalEventPairing(state.status, events);
    // Still a lost level with a goal unmet, so a further continue remains callable.
    expect(() => reliefClear(state, 12)).not.toThrow();
  });

  it('is deterministic: the same state and count give the same result (a safe dry run)', () => {
    const s = lostGame(Array<string>(8).fill(FULL));
    expect(reliefClear(s, 12)).toEqual(reliefClear(s, 12));
  });
});

describe('relief invariants (PRD §9.4, §4.3)', () => {
  it('is not a placement: no score/combo/ivy/goal change, no clear, perfect-clear or booster event', () => {
    // 12 plain cells only → the relief empties the board completely.
    const s = lostGame(['####....', '####....', '####....', ...Array<string>(5).fill(EMPTY)]);
    Object.assign(s, { score: 50, combo: 2, missStreak: 1, placements: 7, lastIvyDestroyedAt: 3 });
    const { state, events } = reliefClear(s, 12);
    expect(state.board.occ.every((row) => row === 0)).toBe(true);
    expect([state.score, state.combo, state.missStreak, state.placements]).toEqual([50, 2, 1, 7]);
    expect(state.lastIvyDestroyedAt).toBe(3);
    expect(state.goals).toEqual(s.goals);
    for (const t of [
      'LINES_CLEARED',
      'PERFECT_CLEAR',
      'PIECE_PLACED',
      'COMBO_RESET',
      'BOOSTER_USED',
      'OBSTACLE_HIT',
      'GOAL_PROGRESS',
      'LEVEL_WON',
    ] as const) {
      expect(eventsOf(events, t)).toHaveLength(0);
    }
  });

  it('never mutates the input state', () => {
    const s = lostGame(Array<string>(8).fill(FULL));
    const before = JSON.stringify(s);
    reliefClear(s, 12);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('is refused unless the level is lost with a goal unmet (§9.4 trigger)', () => {
    const board = Array<string>(8).fill(FULL);
    const refused: GameState[] = [];
    for (const status of ['playing', 'won', 'completed'] as const) {
      const s = lostGame(board);
      s.status = status;
      refused.push(s);
    }
    const met = lostGame(board);
    met.goals = met.goals.map((g) => ({ ...g, remaining: 0 }));
    const goalless = createGame(config('level', { level: level() }), 'g');
    goalless.status = 'lost';
    const endless = createGame(config('endless'), 'e');
    endless.status = 'lost';
    const daily = createGame(config('daily', { level: level({ goals: CRATE_GOAL }) }), 'd');
    daily.status = 'lost';
    const ftue = lostGame(board, { pieceSequence: ['P01', 'P01', 'P01', 'P01'] });
    refused.push(met, goalless, endless, daily, ftue);

    for (const s of refused) {
      const before = JSON.stringify(s);
      expect(() => reliefClear(s, 12)).toThrow(IllegalMoveError);
      expect(JSON.stringify(s)).toBe(before);
    }
  });

  it('refuses a non-positive or fractional count', () => {
    const s = lostGame(Array<string>(8).fill(FULL));
    for (const n of [0, -1, 1.5, Number.NaN]) {
      expect(() => reliefClear(s, n)).toThrow(IllegalMoveError);
    }
  });
});
