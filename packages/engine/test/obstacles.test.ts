/** Obstacle behaviors — PRD §7.8, one block per row of the table. */

import { describe, expect, it } from 'vitest';
import { cellColor, cellKind, isOccupied } from '../src/board';
import { IVY_MAX_TILES, ivyCount } from '../src/obstacles';
import { createGame, getLegalPlacements, type GameState } from '../src/simulate';
import { boardFrom, config, eventsOf, level, play, setTray } from './helpers';

const EMPTY_ROWS = (n: number): string[] => Array<string>(n).fill('........');

/** One obstacle at (0,0), row 0 otherwise filled and one cell short at (0,7). */
function rowWithObstacle(ch: string): string[] {
  return [`${ch}######.`, ...EMPTY_ROWS(7)];
}

function gameWith(
  rows: readonly string[],
  goals: Record<string, unknown>[],
  seed = 'obstacles',
): GameState {
  const state = createGame(config('level', { level: level({ goals }) }), seed);
  state.board = boardFrom(rows);
  setTray(state, ['P01', 'P01', 'P01']);
  return state;
}

describe('obstacles (PRD §7.8)', () => {
  it('never allows a placement on an obstacle cell (all types occupy)', () => {
    const state = gameWith(['cdhix...', ...EMPTY_ROWS(7)], []);
    const anchors = getLegalPlacements(state, 0).map((p) => `${p.r},${p.c}`);
    for (let c = 0; c < 5; c++) expect(anchors).not.toContain(`0,${c}`);
    expect(anchors).toContain('0,5');
  });

  it('crate: destroyed by a clear → empty cell, counts toward its goal', () => {
    const state = gameWith(rowWithObstacle('c'), [{ type: 'crate', count: 2 }]);
    const { state: next, events } = play(state, 0, 0, 7);

    expect(eventsOf(events, 'OBSTACLE_HIT')).toEqual([
      { type: 'OBSTACLE_HIT', obstacle: 'crate', r: 0, c: 0, destroyed: true },
    ]);
    expect(eventsOf(events, 'GOAL_PROGRESS')[0]).toEqual({
      type: 'GOAL_PROGRESS',
      goal: 'crate',
      remaining: 1,
    });
    expect(cellKind(next.board, 0, 0)).toBe('empty');
  });

  it('crate2: 1st hit becomes a crate (still occupying, no goal credit), 2nd hit counts', () => {
    const first = play(gameWith(rowWithObstacle('d'), [{ type: 'crate', count: 1 }]), 0, 0, 7);

    expect(cellKind(first.state.board, 0, 0)).toBe('crate');
    expect(isOccupied(first.state.board, 0, 0)).toBe(true);
    expect(eventsOf(first.events, 'OBSTACLE_HIT')).toEqual([
      { type: 'OBSTACLE_HIT', obstacle: 'crate2', r: 0, c: 0, destroyed: false },
    ]);
    expect(eventsOf(first.events, 'GOAL_PROGRESS')).toHaveLength(0);
    expect(first.state.goals[0]?.remaining).toBe(1);

    // Refill the row and clear it again — the 2nd hit destroys the derived crate
    // and credits the `crate` goal (§7.8 "on 2nd hit" + the §7.7 example level).
    const state = first.state;
    setTray(state, ['P08', 'P02', 'P01']);
    const second = play(play(state, 0, 0, 1).state, 1, 0, 6);

    expect(cellKind(second.state.board, 0, 0)).toBe('empty');
    expect(eventsOf(second.events, 'OBSTACLE_HIT')).toEqual([
      { type: 'OBSTACLE_HIT', obstacle: 'crate', r: 0, c: 0, destroyed: true },
    ]);
    expect(second.state.goals[0]?.remaining).toBe(0);
    expect(second.state.status).toBe('won');
  });

  it('chain: break leaves the block it overlaid, which clears on a later line', () => {
    const first = play(gameWith(rowWithObstacle('h'), [{ type: 'chain', count: 2 }]), 0, 0, 7);

    expect(cellKind(first.state.board, 0, 0)).toBe('filled');
    expect(cellColor(first.state.board, 0, 0)).toBe(1); // the overlaid block's color survives
    expect(eventsOf(first.events, 'OBSTACLE_HIT')).toEqual([
      { type: 'OBSTACLE_HIT', obstacle: 'chain', r: 0, c: 0, destroyed: false },
    ]);
    expect(first.state.goals[0]?.remaining).toBe(1); // chain-break counts

    const state = first.state;
    setTray(state, ['P08', 'P02', 'P01']);
    const second = play(play(state, 0, 0, 1).state, 1, 0, 6);
    expect(cellKind(second.state.board, 0, 0)).toBe('empty');
    expect(eventsOf(second.events, 'OBSTACLE_HIT')).toHaveLength(0); // it is a plain block now
    expect(second.state.goals[0]?.remaining).toBe(1);
  });

  it('ivy: destroyed by a clear and counts', () => {
    const { state, events } = play(
      gameWith(rowWithObstacle('i'), [{ type: 'ivy', count: 2 }]),
      0,
      0,
      7,
    );
    expect(cellKind(state.board, 0, 0)).toBe('empty');
    expect(eventsOf(events, 'OBSTACLE_HIT')[0]?.destroyed).toBe(true);
    expect(state.goals[0]?.remaining).toBe(1);
  });

  it('heirloom: collected by a clear → empty cell, counts', () => {
    const { state, events } = play(
      gameWith(rowWithObstacle('x'), [{ type: 'heirloom', count: 2 }]),
      0,
      0,
      7,
    );
    expect(cellKind(state.board, 0, 0)).toBe('empty');
    expect(eventsOf(events, 'OBSTACLE_HIT')[0]).toEqual({
      type: 'OBSTACLE_HIT',
      obstacle: 'heirloom',
      r: 0,
      c: 0,
      destroyed: true,
    });
    expect(state.goals[0]?.remaining).toBe(1);
  });

  it('obstacle cells count toward a row being full (§7.8)', () => {
    // Row 0 is 7 obstacles + one empty cell; filling it clears the row.
    const state = gameWith(['ccddhhi.', ...EMPTY_ROWS(7)], [{ type: 'crate', count: 9 }]);
    const { events } = play(state, 0, 0, 7);
    expect(eventsOf(events, 'LINES_CLEARED')[0]?.rows).toEqual([0]);
  });
});

describe('ivy spread (PRD §7.8)', () => {
  const IVY_MIDDLE = [...EMPTY_ROWS(4), '....i...', ...EMPTY_ROWS(3)];

  /** Three placements that never complete a line. */
  function threeQuietPlacements(state: GameState, row = 7): ReturnType<typeof play> {
    const a = play(state, 0, row, 0);
    const b = play(a.state, 1, row, 2);
    return play(b.state, 2, row, 4);
  }

  it('grows on every 3rd placement into an orthogonally adjacent empty cell', () => {
    const state = gameWith(IVY_MIDDLE, [{ type: 'ivy', count: 5 }]);
    const first = play(state, 0, 7, 0);
    expect(eventsOf(first.events, 'IVY_SPREAD')).toHaveLength(0);
    const second = play(first.state, 1, 7, 2);
    expect(eventsOf(second.events, 'IVY_SPREAD')).toHaveLength(0);

    const third = play(second.state, 2, 7, 4);
    const [spread] = eventsOf(third.events, 'IVY_SPREAD');
    expect(spread).toBeDefined();
    expect(spread?.from).toEqual({ r: 4, c: 4 });
    expect(Math.abs((spread?.to.r ?? 0) - 4) + Math.abs((spread?.to.c ?? 0) - 4)).toBe(1);
    expect(ivyCount(third.state.board)).toBe(2);
  });

  it('does not grow when ivy was destroyed within the last 3 placements', () => {
    // Placement 1 clears row 0 and destroys the ivy there.
    const state = gameWith(
      ['i######.', ...EMPTY_ROWS(3), '....i...', ...EMPTY_ROWS(3)],
      [{ type: 'ivy', count: 5 }],
    );
    const first = play(state, 0, 0, 7);
    expect(first.state.lastIvyDestroyedAt).toBe(1);

    const third = play(play(first.state, 1, 7, 0).state, 2, 7, 2);
    expect(eventsOf(third.events, 'IVY_SPREAD')).toHaveLength(0);
    expect(ivyCount(third.state.board)).toBe(1);

    // Placements 4–6 are clear of the suppression window, so growth resumes.
    setTray(third.state, ['P01', 'P01', 'P01']);
    const sixth = threeQuietPlacements(third.state, 6);
    expect(eventsOf(sixth.events, 'IVY_SPREAD')).toHaveLength(1);
  });

  it('never grows past 16 tiles (§7.8 hard cap)', () => {
    // 16 ivy tiles, deliberately never a full row/col so nothing clears them.
    const state = gameWith(
      ['iiiiiii.', 'iiiiiii.', 'ii......', ...EMPTY_ROWS(5)],
      [{ type: 'ivy', count: 99 }],
    );
    expect(ivyCount(state.board)).toBe(IVY_MAX_TILES);
    const third = threeQuietPlacements(state);
    expect(eventsOf(third.events, 'IVY_SPREAD')).toHaveLength(0);
    expect(ivyCount(third.state.board)).toBe(IVY_MAX_TILES);
  });

  it('does nothing AND consumes no RNG when every ivy tile is boxed in', () => {
    const boxedIn = gameWith(
      ['i#......', '#.......', ...EMPTY_ROWS(6)],
      [{ type: 'ivy', count: 5 }],
    );
    const third = threeQuietPlacements(boxedIn);
    expect(eventsOf(third.events, 'IVY_SPREAD')).toHaveLength(0);
    expect(ivyCount(third.state.board)).toBe(1);

    // THE load-bearing half of the §7.8 v1.6 ruling, asserted differentially:
    // the same board with the ivy swapped for a plain block has no ivy to
    // consider at all, so if the boxed-in run burned a draw the two PRNG states
    // diverge. (An absolute before/after check would be wrong — the tray refill
    // on the 3rd placement legitimately consumes RNG in both runs.)
    const noIvy = gameWith(['##......', '#.......', ...EMPTY_ROWS(6)], [{ type: 'ivy', count: 5 }]);
    expect(threeQuietPlacements(noIvy).state.rng.s).toBe(third.state.rng.s);
    // Guard the guard: this only proves anything because a spread DOES move the
    // RNG relative to the same baseline.
    const canGrow = gameWith(IVY_MIDDLE, [{ type: 'ivy', count: 5 }]);
    expect(threeQuietPlacements(canGrow).state.rng.s).not.toBe(third.state.rng.s);
  });

  it('grows from a reachable tile when only SOME ivy is boxed in (§7.8 candidate set)', () => {
    // (0,0) is boxed in by walls; (4,4) is free. The rejected reading would
    // sometimes pick (0,0) and grow nothing; the rule says growth always happens.
    const board = ['i#......', '#.......', '........', '........', '....i...', ...EMPTY_ROWS(3)];
    for (const seed of ['s0', 's1', 's2', 's3', 's4', 's5']) {
      const state = gameWith(board, [{ type: 'ivy', count: 9 }], seed);
      const third = threeQuietPlacements(state);
      const [spread] = eventsOf(third.events, 'IVY_SPREAD');
      expect(spread, seed).toBeDefined();
      // Always sourced from the free tile, never the boxed-in one.
      expect(spread?.from, seed).toEqual({ r: 4, c: 4 });
      expect(ivyCount(third.state.board), seed).toBe(3);
    }
  });
});
