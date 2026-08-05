/** Tray, mercy, game over and win precedence — PRD §6.3, §6.4, §6.7, §8.1. */

import { describe, expect, it } from 'vitest';
import { BOARD_SIZE } from '../src/board';
import { SMALL_POOL, drawPiece, type PieceId } from '../src/pieces';
import { ivyCount } from '../src/obstacles';
import { hasAnyLegalAnchor } from '../src/placement';
import { createRng } from '../src/rng';
import {
  MAX_TRAY_REDRAWS,
  TRAY_SIZE,
  applyPlacement,
  createGame,
  finalResult,
  getLegalPlacements,
  isGameOver,
  simulate,
} from '../src/simulate';
import { boardFrom, config, eventsOf, level, play, setTray, TUNING } from './helpers';

const trayIds = (tray: { pieceId: PieceId }[]): PieceId[] => tray.map((s) => s.pieceId);

/** Fully prefilled board (no empty cell): nothing is ever placeable. */
const FULL_PREFILL = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => ({
  r: Math.floor(i / BOARD_SIZE),
  c: i % BOARD_SIZE,
  type: 'filled',
}));

/** Same, minus (7,7): only P01 fits. */
const ONE_HOLE_PREFILL = FULL_PREFILL.filter((cell) => !(cell.r === 7 && cell.c === 7));

/** Re-derives the raw draw stream for a seed, mercy disabled (1 RNG call per piece). */
function drawGroups(seed: string, groups: number): PieceId[][] {
  const rng = createRng(seed);
  return Array.from({ length: groups }, () =>
    Array.from({ length: TRAY_SIZE }, () => drawPiece(rng)),
  );
}

describe('tray (PRD §6.3)', () => {
  it('holds 3 pieces and refills only when all 3 are used', () => {
    const state = createGame(config('endless'), 'tray');
    expect(state.tray).toHaveLength(TRAY_SIZE);
    state.board = boardFrom(Array<string>(8).fill('........'));
    setTray(state, ['P01', 'P01', 'P01']);

    const a = play(state, 0, 0, 0);
    expect(eventsOf(a.events, 'TRAY_REFILLED')).toHaveLength(0);
    expect(a.state.tray[0]?.used).toBe(true);
    const b = play(a.state, 1, 3, 0);
    expect(eventsOf(b.events, 'TRAY_REFILLED')).toHaveLength(0);
    const c = play(b.state, 2, 6, 0);

    const [refill] = eventsOf(c.events, 'TRAY_REFILLED');
    expect(refill?.pieces).toHaveLength(TRAY_SIZE);
    expect(c.state.tray.every((s) => !s.used)).toBe(true);
  });

  it('redraws a dead tray up to 5 times, then accepts it (§6.3)', () => {
    const cfg = config('level', {
      level: level({ seedSalt: 'DEAD', prefill: FULL_PREFILL }),
      tuning: { ...TUNING, mercy_threshold: 1 }, // fillRatio 1 is not > 1 → no mercy rolls
    });
    const state = createGame(cfg, 'redraw');
    const groups = drawGroups('redraw|DEAD', MAX_TRAY_REDRAWS + 1);

    // Nothing is placeable, so all 6 attempts are spent and the last one is kept.
    expect(trayIds(state.tray)).toEqual(groups[MAX_TRAY_REDRAWS]);
    expect(state.status).toBe('lost');
    expect(isGameOver(state)).toBe(true);
  });

  it('keeps the first tray that contains a placeable piece', () => {
    const cfg = config('level', {
      level: level({ seedSalt: 'HOLE', prefill: ONE_HOLE_PREFILL }),
      tuning: { ...TUNING, mercy_threshold: 1 },
    });
    let sawRedraw = false;

    for (let i = 0; i < 30; i++) {
      const seed = `hole-${i}`;
      const state = createGame(cfg, seed);
      const groups = drawGroups(`${seed}|HOLE`, MAX_TRAY_REDRAWS + 1);
      const expected =
        groups.find((g) => g.some((id) => hasAnyLegalAnchor(state.board, id))) ??
        groups[MAX_TRAY_REDRAWS];

      expect(trayIds(state.tray), seed).toEqual(expected);
      if (expected !== groups[0]) sawRedraw = true;
    }
    expect(sawRedraw).toBe(true); // the guarantee actually fires in this sample
  });

  it('is disabled on the Daily Board — the first dead tray stands (§6.3, §8.1)', () => {
    const cfg = config('daily', { level: level({ seedSalt: 'HOLE', prefill: ONE_HOLE_PREFILL }) });
    for (let i = 0; i < 10; i++) {
      const seed = `daily-${i}`;
      const state = createGame(cfg, seed);
      expect(trayIds(state.tray), seed).toEqual(drawGroups(`${seed}|HOLE`, 1)[0]);
    }
  });
});

describe('mercy RNG (PRD §6.4)', () => {
  // 40 of 64 cells filled → fillRatio 0.625 > mercy_threshold 0.55.
  const HALF_FULL = Array.from({ length: 40 }, (_, i) => ({
    r: Math.floor(i / BOARD_SIZE),
    c: i % BOARD_SIZE,
    type: 'filled',
  }));

  const mercyLevel = (extra: Record<string, unknown> = {}) =>
    level({ seedSalt: 'MERCY', prefill: HALF_FULL, ...extra });

  it('draws from SMALL_POOL when fillRatio is over the threshold', () => {
    const cfg = config('level', {
      level: mercyLevel(),
      tuning: { ...TUNING, mercy_small_prob: 1 },
    });
    for (let i = 0; i < 20; i++) {
      for (const id of trayIds(createGame(cfg, `mercy-${i}`).tray)) {
        expect(SMALL_POOL, `seed mercy-${i}`).toContain(id);
      }
    }
  });

  it('does not trigger at or below the threshold (strict >)', () => {
    const cfg = config('level', {
      // fillRatio is exactly 0.625 here, so a 0.625 threshold must NOT trigger.
      level: mercyLevel(),
      tuning: { ...TUNING, mercy_threshold: 0.625, mercy_small_prob: 1 },
    });
    const large = Array.from({ length: 20 }, (_, i) => trayIds(createGame(cfg, `t-${i}`).tray))
      .flat()
      .filter((id) => !SMALL_POOL.includes(id));
    expect(large.length).toBeGreaterThan(0);
  });

  it('is off when the level sets mercy:false (§7.7) and on the Daily Board (§8.1)', () => {
    const off = config('level', {
      level: mercyLevel({ mercy: false }),
      tuning: { ...TUNING, mercy_small_prob: 1 },
    });
    const daily = config('daily', {
      level: mercyLevel(),
      tuning: { ...TUNING, mercy_small_prob: 1 },
    });

    for (const cfg of [off, daily]) {
      const large = Array.from({ length: 20 }, (_, i) => trayIds(createGame(cfg, `m-${i}`).tray))
        .flat()
        .filter((id) => !SMALL_POOL.includes(id));
      expect(large.length).toBeGreaterThan(0);
    }
  });

  it('respects pieceWeightOverrides even inside the small pool', () => {
    const cfg = config('level', {
      level: mercyLevel({
        pieceWeightOverrides: { P01: 0, P02: 0, P03: 0, P12: 0, P13: 0, P14: 0, P15: 0 },
      }),
      tuning: { ...TUNING, mercy_small_prob: 1 },
    });
    for (let i = 0; i < 20; i++) {
      for (const id of trayIds(createGame(cfg, `o-${i}`).tray)) {
        expect(['P04', 'P05']).toContain(id);
      }
    }
  });
});

describe('game over and win (PRD §6.7)', () => {
  /**
   * Placing at (7,7) completes row 7 AND column 7. The clear destroys the only
   * crate — the last goal — while the two unused P11 pieces have nowhere left to
   * go, so win and board-death land on the same move.
   */
  const WIN_OR_DEATH = [
    '.#######',
    '#.######',
    '##.#####',
    '###.####',
    '####.###',
    '#####.##',
    '######.#',
    'c######.',
  ];

  const deathGame = (goalCount: number, stars = { s2: 1000, s3: 2000 }) => {
    const state = createGame(
      config('level', {
        level: level({ goals: [{ type: 'crate', count: goalCount }], stars }),
      }),
      'precedence',
    );
    state.board = boardFrom(WIN_OR_DEATH);
    setTray(state, ['P01', 'P11', 'P11']);
    return state;
  };

  it('wins the moment the last goal hits 0, ahead of a simultaneous death', () => {
    const { state, events } = play(deathGame(1), 0, 7, 7);

    expect(state.status).toBe('won');
    expect(eventsOf(events, 'LEVEL_WON')).toHaveLength(1);
    expect(eventsOf(events, 'GAME_OVER')).toHaveLength(0);
    expect(eventsOf(events, 'TRAY_REFILLED')).toHaveLength(0);
    expect(finalResult(state).stars).toBe(1);
  });

  it('dies on that exact move when the goal is NOT met', () => {
    const { state, events } = play(deathGame(2), 0, 7, 7);

    expect(state.status).toBe('lost');
    expect(eventsOf(events, 'GAME_OVER')).toHaveLength(1);
    expect(eventsOf(events, 'LEVEL_WON')).toHaveLength(0);
    expect(finalResult(state).stars).toBe(0);
    expect(finalResult(state).goals).toEqual([{ type: 'crate', remaining: 1 }]);
  });

  it('awards stars from the level thresholds on win (§7.5)', () => {
    const { state } = play(deathGame(1, { s2: 100, s3: 200 }), 0, 7, 7);
    expect(finalResult(state).stars).toBe(3);
    const { state: two } = play(deathGame(1, { s2: 100, s3: 5000 }), 0, 7, 7);
    expect(finalResult(two).stars).toBe(2);
  });

  it('reports game over when no unused tray piece fits', () => {
    const state = createGame(config('endless'), 'over');
    state.board = boardFrom(['#######.', ...Array<string>(7).fill('########')]);
    setTray(state, ['P11', 'P11', 'P11']);
    expect(isGameOver(state)).toBe(true);
    expect(getLegalPlacements(state, 0)).toEqual([]);
  });

  it('marks a game that starts dead as lost', () => {
    const state = createGame(
      config('level', { level: level({ seedSalt: 'DEAD', prefill: FULL_PREFILL }) }),
      'dead-start',
    );
    expect(state.status).toBe('lost');
  });

  it('rejects illegal, used-slot, unknown-slot and post-game moves', () => {
    const state = createGame(config('endless'), 'errors');
    state.board = boardFrom(['########', ...Array<string>(7).fill('........')]);
    setTray(state, ['P01', 'P01', 'P01']);

    expect(() => applyPlacement(state, { pieceIndex: 0, r: 0, c: 0 })).toThrow(/Illegal placement/);
    expect(() => applyPlacement(state, { pieceIndex: 9, r: 1, c: 0 })).toThrow(/No tray slot/);

    const after = play(state, 0, 1, 0).state;
    expect(() => applyPlacement(after, { pieceIndex: 0, r: 2, c: 0 })).toThrow(/already used/);

    after.status = 'won';
    expect(() => applyPlacement(after, { pieceIndex: 1, r: 2, c: 0 })).toThrow(/already won/);
  });

  it('does not mutate the previous state', () => {
    const state = createGame(config('endless'), 'immutable');
    state.board = boardFrom(Array<string>(8).fill('........'));
    setTray(state, ['P01', 'P01', 'P01']);
    const before = JSON.stringify(state.board);

    play(state, 0, 4, 4);
    expect(JSON.stringify(state.board)).toBe(before);
    expect(state.tray[0]?.used).toBe(false);
    expect(state.score).toBe(0);
  });
});

describe('fixed piece sequence (PRD §4.3, §8.2)', () => {
  const SEQ: PieceId[] = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06'];
  const seqConfig = (pieceSequence: PieceId[]) => config('daily', { pieceSequence });

  it('consumes the sequence in order, three at a time', () => {
    let state = createGame(seqConfig(SEQ), 'seq');
    expect(trayIds(state.tray)).toEqual(['P01', 'P02', 'P03']);
    expect(state.sequenceIndex).toBe(3);

    // Empty the tray; the refill must be the NEXT three, not a fresh draw.
    state = play(state, 0, 0, 0).state;
    state = play(state, 1, 2, 0).state;
    const third = play(state, 2, 4, 0);
    expect(trayIds(third.state.tray)).toEqual(['P04', 'P05', 'P06']);
    expect(eventsOf(third.events, 'TRAY_REFILLED')[0]?.pieces).toEqual(['P04', 'P05', 'P06']);
    expect(third.state.sequenceIndex).toBe(6);
  });

  it('is a pure function of the sequence — the seed cannot change the pieces', () => {
    for (const seed of ['a', 'b', 'zzz']) {
      expect(trayIds(createGame(seqConfig(SEQ), seed).tray)).toEqual(['P01', 'P02', 'P03']);
    }
  });

  it('ends as completed (not lost) when the sequence runs out', () => {
    let state = createGame(seqConfig(['P01', 'P01', 'P01']), 'exhaust');
    state = play(state, 0, 0, 0).state;
    state = play(state, 1, 2, 0).state;
    const last = play(state, 2, 4, 0);

    expect(last.state.status).toBe('completed');
    expect(isGameOver(last.state)).toBe(true);
    const [exhausted] = eventsOf(last.events, 'SEQUENCE_EXHAUSTED');
    expect(exhausted?.moves).toBe(3);
    expect(exhausted?.score).toBe(last.state.score);
    // §8.2: surviving the sequence is NOT a death and NOT a win.
    expect(eventsOf(last.events, 'GAME_OVER')).toHaveLength(0);
    expect(eventsOf(last.events, 'LEVEL_WON')).toHaveLength(0);
    expect(finalResult(last.state)).toMatchObject({ status: 'completed', stars: 0, moves: 3 });
  });

  it('accepts a tail shorter than the tray (length need not divide by 3)', () => {
    let state = createGame(seqConfig(['P01', 'P01', 'P01', 'P01']), 'tail');
    state = play(state, 0, 0, 0).state;
    state = play(state, 1, 2, 0).state;
    const refill = play(state, 2, 4, 0);
    expect(trayIds(refill.state.tray)).toEqual(['P01']);
    expect(refill.state.status).toBe('playing');

    const done = play(refill.state, 0, 6, 0);
    expect(done.state.status).toBe('completed');
  });

  it('an empty sequence completes immediately rather than reporting a loss', () => {
    const state = createGame(seqConfig([]), 'empty');
    expect(state.status).toBe('completed');
    expect(state.tray).toHaveLength(0);
  });

  it('still dies when the board fills before the sequence runs out (§8.2 whichever first)', () => {
    // P11 (3x3) into a board with only a 1-cell hole: no legal placement at all.
    const state = createGame(
      config('daily', {
        pieceSequence: ['P11', 'P11', 'P11', 'P11', 'P11', 'P11'],
        level: level({ prefill: ONE_HOLE_PREFILL }),
      }),
      'seq-death',
    );
    expect(state.status).toBe('lost');
  });

  it('disables the redraw guarantee — a dead sequence tray stands (§6.3)', () => {
    const state = createGame(
      config('level', {
        pieceSequence: ['P11', 'P11', 'P11'],
        level: level({ prefill: ONE_HOLE_PREFILL }),
      }),
      'seq-no-redraw',
    );
    // Even in level mode, the sequence overrides the guarantee: tray is the
    // sequence verbatim and the game is over.
    expect(trayIds(state.tray)).toEqual(['P11', 'P11', 'P11']);
    expect(state.status).toBe('lost');
  });

  it('disables mercy — a near-full board still gets the sequence verbatim (§6.4)', () => {
    // fillRatio here is far above mercy_threshold; mercy would force SMALL_POOL.
    const heavy: PieceId[] = ['P11', 'P08', 'P09'];
    const state = createGame(
      config('level', {
        pieceSequence: heavy,
        level: level({ prefill: FULL_PREFILL.slice(0, 50) }),
      }),
      'seq-no-mercy',
    );
    expect(trayIds(state.tray)).toEqual(heavy);
    expect(heavy.every((id) => !SMALL_POOL.includes(id))).toBe(true);
  });

  it('consumes NO RNG for draws — the sequence is the only source of pieces', () => {
    // A sequence run must not advance the PRNG on any refill. Without this,
    // a stray draw (e.g. a future refactor hoisting the mercy roll above the
    // sequence check) is invisible: both current sequence fixtures are
    // obstacle-free, so no ivy spread ever makes the RNG observable in them.
    let state = createGame(seqConfig(SEQ), 'rng-inv');
    const before = state.rng.s;
    let guard = 0;
    while (state.status === 'playing' && guard++ < 20) {
      const [move] = getLegalPlacements(
        state,
        state.tray.findIndex((s) => !s.used),
      );
      if (!move) break;
      state = applyPlacement(state, move).state;
      expect(state.rng.s).toBe(before);
    }
    expect(state.status).toBe('completed'); // it really did run to exhaustion
    expect(state.rng.s).toBe(before);
  });

  it('rejects an unknown piece id at the trust boundary (§4.3)', () => {
    expect(() => createGame(seqConfig(['P01', 'P99' as PieceId]), 'bad')).toThrow(
      /Unknown piece id/,
    );
  });

  it('replays identically through simulate() — the §8.5 anti-cheat path', () => {
    const cfg = seqConfig(SEQ);
    let state = createGame(cfg, 'replay');
    const moves = [];
    for (const m of [
      { pieceIndex: 0, r: 0, c: 0 },
      { pieceIndex: 1, r: 2, c: 0 },
      { pieceIndex: 2, r: 4, c: 0 },
    ]) {
      moves.push(m);
      state = applyPlacement(state, m).state;
    }
    expect(simulate(cfg, 'replay', moves)).toEqual(finalResult(state));
  });
});

describe('per-level ivy tuning (PRD §7.7, §7.8)', () => {
  /** One ivy tile with room to grow, and a tray that never clears a line. */
  const IVY_BOARD = [
    'i.......',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ];

  const runPlacements = (ivySpreadInterval: number, count: number) => {
    let state = createGame(config('level', { level: level({ ivySpreadInterval }) }), 'ivy-tune');
    state.board = boardFrom(IVY_BOARD);
    const spreads = [];
    for (let i = 0; i < count; i++) {
      setTray(state, ['P01', 'P01', 'P01']);
      const step = play(state, 0, 7, i % BOARD_SIZE);
      state = step.state;
      spreads.push(eventsOf(step.events, 'IVY_SPREAD').length);
    }
    return spreads;
  };

  it('spreads on the level-configured interval, not the default 3', () => {
    // interval 2 → grows on placements 2, 4, 6 …
    expect(runPlacements(2, 4)).toEqual([0, 1, 0, 1]);
    // interval 4 → nothing until placement 4.
    expect(runPlacements(4, 4)).toEqual([0, 0, 0, 1]);
  });

  it('honours a level-configured ivyMaxTiles cap', () => {
    let state = createGame(
      config('level', { level: level({ ivySpreadInterval: 1, ivyMaxTiles: 3 }) }),
      'ivy-cap',
    );
    state.board = boardFrom(IVY_BOARD);
    for (let i = 0; i < 8; i++) {
      setTray(state, ['P01', 'P01', 'P01']);
      state = play(state, 0, 7, i % BOARD_SIZE).state;
    }
    expect(ivyCount(state.board)).toBe(3);
  });
});
