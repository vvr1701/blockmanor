/** Shared test scaffolding: board literals, config builders, a seeded random bot. */

import {
  BOARD_SIZE,
  createBoard,
  isOccupied,
  setCell,
  type Board,
  type CellKind,
} from '../src/board';
import { PIECE_BY_ID } from '../src/pieces';
import { validateLevel, type LevelConfig } from '../src/levels';
import type { Move, Placement } from '../src/placement';
import type { PieceId } from '../src/pieces';
import { createRng, nextInt } from '../src/rng';
import {
  TRAY_SIZE,
  applyBooster,
  applyPlacement,
  createGame,
  finalResult,
  getLegalPlacements,
  type BoosterAction,
  type EngineTuning,
  type FinalResult,
  type GameConfig,
  type GameEvent,
  type GameMode,
  type GameState,
} from '../src/simulate';

/** PRD §13 defaults. Tests that assert [RC] plumbing override these explicitly. */
export const TUNING: EngineTuning = {
  mercy_threshold: 0.55,
  mercy_small_prob: 0.65,
  score_clear_base: 10,
  combo_step: 0.25,
  perfect_clear_bonus: 300,
};

const CHARS: Readonly<Record<string, CellKind>> = {
  '.': 'empty',
  '#': 'filled',
  c: 'crate',
  d: 'crate2',
  h: 'chain',
  i: 'ivy',
  x: 'heirloom',
};

/** 8 rows of 8 chars: `.` empty · `#` filled · c crate · d crate2 · h chain · i ivy · x heirloom. */
export function boardFrom(rows: readonly string[]): Board {
  const board = createBoard();
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const kind = CHARS[ch];
      if (kind === undefined) throw new Error(`Unknown board char "${ch}"`);
      if (kind !== 'empty') setCell(board, r, c, kind, 1);
    });
  });
  return board;
}

export function level(partial: Record<string, unknown> = {}): LevelConfig {
  return validateLevel({
    id: 1,
    chapter: 1,
    seedSalt: 'T1',
    goals: [],
    stars: { s2: 1000, s3: 2000 },
    ...partial,
  });
}

export function config(mode: GameMode, opts: Partial<GameConfig> = {}): GameConfig {
  const base: GameConfig = { mode, tuning: { ...TUNING } };
  return { ...base, ...opts };
}

export function setTray(state: GameState, ids: readonly PieceId[]): void {
  state.tray = ids.map((pieceId) => ({ pieceId, used: false }));
}

/** Apply a placement in-place, returning the events (test ergonomics only). */
export function play(
  state: GameState,
  pieceIndex: number,
  r: number,
  c: number,
): { state: GameState; events: GameEvent[] } {
  return applyPlacement(state, { pieceIndex, r, c });
}

export const eventsOf = <T extends GameEvent['type']>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** Would this placement complete a row or column? Mask-only, no board mutation. */
function completesLine(board: Board, pieceId: PieceId, r: number, c: number): boolean {
  const occ = board.occ.slice();
  for (const [dr, dc] of PIECE_BY_ID[pieceId].cells) {
    occ[r + dr] = (occ[r + dr] ?? 0) | (1 << (c + dc));
  }
  return occ.some((row) => row === 0xff) || occ.reduce((a, b) => a & b, 0xff) !== 0;
}

/**
 * §4.3 contract, checked on EVERY fuzzed placement: a terminal status and its
 * terminal event are produced together in one `applyPlacement` return — exactly
 * one of each, never one without the other (the renderer's `LevelSession`
 * throws on a `'won'` batch with no `LEVEL_WON`).
 */
const TERMINAL_EVENT = {
  won: 'LEVEL_WON',
  lost: 'GAME_OVER',
  completed: 'SEQUENCE_EXHAUSTED',
} as const;

export function assertTerminalEventPairing(
  status: GameState['status'],
  events: readonly GameEvent[],
): void {
  for (const [terminal, type] of Object.entries(TERMINAL_EVENT)) {
    const n = events.filter((e) => e.type === type).length;
    const expected = status === terminal ? 1 : 0;
    if (n !== expected) {
      throw new Error(`§4.3: status "${status}" returned ${n}x ${type} (expected ${expected})`);
    }
  }
}

/**
 * Seeded bot: mostly greedy (takes a line-clearing move ~70% of the time),
 * otherwise random. Greedy enough to reach deep boards — combos, obstacle
 * chains, ivy cadence — instead of suffocating after ten random drops.
 */
export function randomPlaythrough(
  gameConfig: GameConfig,
  seed: string,
  botSeed: string,
  maxMoves = 200,
): { moves: Move[]; result: FinalResult } {
  const rng = createRng(botSeed);
  let state = createGame(gameConfig, seed);
  const moves: Move[] = [];

  while (state.status === 'playing' && moves.length < maxMoves) {
    const options: Placement[] = [];
    for (let i = 0; i < TRAY_SIZE; i++) options.push(...getLegalPlacements(state, i));
    if (options.length === 0) break;

    const clearing = options.filter((p) => {
      const slot = state.tray[p.pieceIndex];
      return slot ? completesLine(state.board, slot.pieceId, p.r, p.c) : false;
    });
    const pool = clearing.length > 0 && nextInt(rng, 10) < 7 ? clearing : options;

    const pick = pool[nextInt(rng, pool.length)];
    if (!pick) break;
    moves.push(pick);
    const result = applyPlacement(state, pick);
    assertTerminalEventPairing(result.state.status, result.events);
    state = result.state;
  }

  return { moves, result: finalResult(state) };
}

/**
 * §9.3 booster fuzz bot: `randomPlaythrough`'s bot, plus a seeded ~10% chance
 * per turn of a random hammer (occupied cell), broom (non-empty row) or
 * hourglass. Kept separate so the pinned §5 corpus's RNG draws are untouched.
 * `simulate()` replays placements only, so the trace itself (every action and
 * every event) is the determinism artifact here.
 */
export function boosterPlaythrough(
  gameConfig: GameConfig,
  seed: string,
  botSeed: string,
  maxMoves = 200,
): { trace: { action: Placement | BoosterAction; events: GameEvent[] }[]; result: FinalResult } {
  const rng = createRng(botSeed);
  let state = createGame(gameConfig, seed);
  const trace: { action: Placement | BoosterAction; events: GameEvent[] }[] = [];

  while (state.status === 'playing' && trace.length < maxMoves) {
    let action: Placement | BoosterAction | undefined;
    if (nextInt(rng, 10) === 0) {
      const occupied: { r: number; c: number }[] = [];
      for (let r = 0; r < BOARD_SIZE; r++)
        for (let c = 0; c < BOARD_SIZE; c++)
          if (isOccupied(state.board, r, c)) occupied.push({ r, c });
      const kind = nextInt(rng, 3);
      const cell = occupied[nextInt(rng, Math.max(1, occupied.length))];
      if (kind === 2 || !cell) action = { type: 'hourglass' };
      else if (kind === 0) action = { type: 'hammer', r: cell.r, c: cell.c };
      else action = { type: 'broom', row: cell.r };
    } else {
      const options: Placement[] = [];
      for (let i = 0; i < TRAY_SIZE; i++) options.push(...getLegalPlacements(state, i));
      const clearing = options.filter((p) => {
        const slot = state.tray[p.pieceIndex];
        return slot ? completesLine(state.board, slot.pieceId, p.r, p.c) : false;
      });
      const pool = clearing.length > 0 && nextInt(rng, 10) < 7 ? clearing : options;
      action = pool[nextInt(rng, pool.length)];
    }
    if (!action) break;
    const result =
      'pieceIndex' in action ? applyPlacement(state, action) : applyBooster(state, action);
    assertTerminalEventPairing(result.state.status, result.events);
    trace.push({ action, events: result.events });
    state = result.state;
  }

  return { trace, result: finalResult(state) };
}
