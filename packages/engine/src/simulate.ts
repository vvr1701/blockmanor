/**
 * The state machine — PRD §4.3 (public contract), §6.3, §6.4, §6.6, §6.7.
 *
 * Pure and deterministic: identical (config, seed, moves) MUST produce identical
 * results on device and in Cloud Functions — that is the Daily Board anti-cheat
 * foundation (§4.3, §8.5). No React/RN/network/storage, no ambient clock, no
 * `Math.random`; the only entropy is the seeded PRNG in rng.ts.
 *
 * `GameEvent[]` is the ONLY engine→renderer channel (§4.3). Mercy draws (§6.4)
 * and tray redraws (§6.3) are deliberately NOT evented — they are invisible
 * systems and eventing them would leak them into the UI.
 */

import {
  cloneBoard,
  createBoard,
  fillCount,
  fillRatio,
  setCell,
  type Board,
  type CellRef,
  type ObstacleKind,
} from './board';
import { applyClears } from './clearing';
import type { LevelConfig } from './levels';
import { IVY_MAX_TILES, IVY_SPREAD_EVERY, spreadIvy, type GoalType } from './obstacles';
import {
  hasAnyLegalAnchor,
  legalAnchorsFor,
  placementCells,
  type Move,
  type Placement,
} from './placement';
import {
  PIECE_BY_ID,
  PIECE_IDS,
  SMALL_POOL,
  drawPiece,
  pieceColor,
  pieceWeight,
  type PieceId,
} from './pieces';
import { cloneRng, createRng, fnv1a, nextFloat, type Rng } from './rng';
import { COMBO_RESET_AFTER_MISSES, clearPoints, placementPoints, starsFor } from './scoring';

/** §6.3: the tray holds 3 pieces and refills when all are used. */
export const TRAY_SIZE = 3;
/** §6.3 placeability guarantee: redraw the whole tray up to 5 times, then accept a dead tray. */
export const MAX_TRAY_REDRAWS = 5;

/**
 * The [RC] engine knobs of §13, keyed exactly as the Remote Config keys so a
 * config snapshot is assignable with no mapping layer (and no call-site literal
 * can drift from the registry — CLAUDE.md rule 3).
 */
export interface EngineTuning {
  mercy_threshold: number;
  mercy_small_prob: number;
  score_clear_base: number;
  combo_step: number;
  perfect_clear_bonus: number;
}

/**
 * `daily` is the §8.1 carve-out mode: no mercy RNG (§6.4), no redraw guarantee
 * (§6.3). The engine implements those semantics only — it neither generates nor
 * knows daily content (that is §8.2, server-side).
 */
export type GameMode = 'level' | 'endless' | 'daily';

export interface GameConfig {
  mode: GameMode;
  tuning: EngineTuning;
  /** Present for `mode: 'level'` (§7.7). Endless and daily have no goals. */
  level?: LevelConfig;
  /**
   * §4.3 / §8.2 fixed piece sequence. When present, draws consume it IN ORDER
   * instead of the §6.2 weighted draw; mercy (§6.4) and the redraw guarantee
   * (§6.3) are off; and running out ends the run as `'completed'`.
   *
   * The engine consumes a sequence, it never generates one — generation is the
   * §8.2 Cloud Function.
   */
  pieceSequence?: readonly PieceId[];
}

export interface TraySlot {
  pieceId: PieceId;
  used: boolean;
}

export interface GoalProgress {
  type: GoalType;
  remaining: number;
}

/**
 * §8.2: `'completed'` is a distinct terminal status from `'lost'` — the player
 * outlived the fixed sequence rather than running out of room. Both are "attempt
 * over" for §8.4/§8.6, and neither is a win.
 */
export type GameStatus = 'playing' | 'won' | 'lost' | 'completed';

export interface GameState {
  readonly config: GameConfig;
  board: Board;
  tray: TraySlot[];
  rng: Rng;
  score: number;
  /** §6.6 combo counter. */
  combo: number;
  /** Consecutive non-clearing placements; combo resets at 2 (§6.6). */
  missStreak: number;
  goals: GoalProgress[];
  /** Placements applied so far — drives the §7.8 ivy cadence. */
  placements: number;
  /** Placement number at which ivy was last destroyed (0 = never). */
  lastIvyDestroyedAt: number;
  /** Read cursor into `config.pieceSequence` (§8.2). Unused without a sequence. */
  sequenceIndex: number;
  status: GameStatus;
}

export type GameEvent =
  | {
      type: 'PIECE_PLACED';
      pieceId: PieceId;
      pieceIndex: number;
      r: number;
      c: number;
      cells: CellRef[];
      points: number;
    }
  | {
      type: 'LINES_CLEARED';
      rows: number[];
      cols: number[];
      cells: CellRef[];
      /**
       * §6.6: the POST-increment counter — the combo LEVEL the renderer announces
       * ("COMBO x2!") and pitches the §7.4 chime to. A first clear is 1 here while
       * scoring ×1.0. Deliberately one more than the multiplier's input.
       */
      comboDisplay: number;
      points: number;
    }
  | { type: 'OBSTACLE_HIT'; obstacle: ObstacleKind; r: number; c: number; destroyed: boolean }
  | { type: 'GOAL_PROGRESS'; goal: GoalType; remaining: number }
  | { type: 'IVY_SPREAD'; from: CellRef; to: CellRef }
  | { type: 'PERFECT_CLEAR'; bonus: number }
  | { type: 'COMBO_RESET' }
  | { type: 'TRAY_REFILLED'; pieces: PieceId[] }
  | { type: 'LEVEL_WON'; score: number; stars: number }
  /** §8.2: the fixed sequence ran out with the board still alive — a completed attempt. */
  | { type: 'SEQUENCE_EXHAUSTED'; score: number; moves: number }
  | { type: 'GAME_OVER'; score: number };

export interface FinalResult {
  status: GameStatus;
  score: number;
  /** 0 unless the level was won (§7.5: star 1 = win). */
  stars: number;
  moves: number;
  combo: number;
  goals: GoalProgress[];
  fill: number;
  /** Digest of the final board — cheap byte-stable comparison for §8.5 re-simulation. */
  boardHash: string;
}

export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}

/**
 * A malformed `GameConfig` — distinct from `IllegalMoveError` on purpose. The
 * §8.5 Cloud Function must tell "the daily board doc is corrupt" apart from
 * "this player submitted an illegal move": different alert, different log line.
 */
export class EngineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineConfigError';
  }
}

// --- draws (§6.3, §6.4) ---------------------------------------------------

const mercyEnabled = (config: GameConfig): boolean =>
  config.mode !== 'daily' && (config.level?.mercy ?? true);

/**
 * §6.4: on EVERY piece draw, if `fillRatio > mercy_threshold` then with
 * probability `mercy_small_prob` the draw comes from SMALL_POOL (weighted).
 * Not evented — invisible by design.
 */
function drawOne(state: GameState): PieceId {
  const overrides = state.config.level?.pieceWeightOverrides;
  const t = state.config.tuning;
  if (mercyEnabled(state.config) && fillRatio(state.board) > t.mercy_threshold) {
    if (nextFloat(state.rng) < t.mercy_small_prob) {
      const smallTotal = SMALL_POOL.reduce(
        (sum, id) => sum + pieceWeight(PIECE_BY_ID[id], overrides),
        0,
      );
      // A level may zero out the whole small pool via overrides; fall back rather than throw.
      if (smallTotal > 0) return drawPiece(state.rng, SMALL_POOL, overrides);
    }
  }
  return drawPiece(state.rng, PIECE_IDS, overrides);
}

/**
 * §6.3 placeability guarantee: if none of the 3 drawn pieces has ≥1 legal
 * placement, redraw the entire tray (max 5 redraws) before accepting a dead
 * tray. Disabled on the Daily Board (fixed sequence, §8.1/§8.2).
 *
 * `exhausted` is only ever true in fixed-sequence mode (§4.3 `pieceSequence`):
 * the sequence ran dry, which §8.2 defines as a completed attempt, not a loss.
 */
function refillTray(state: GameState): { pieces: PieceId[]; exhausted: boolean } {
  const sequence = state.config.pieceSequence;
  if (sequence) {
    // A short tail is a legal tray: the sequence length need not divide by 3.
    const pieces = sequence.slice(state.sequenceIndex, state.sequenceIndex + TRAY_SIZE);
    state.sequenceIndex += pieces.length;
    state.tray = pieces.map((pieceId) => ({ pieceId, used: false }));
    // Mercy (§6.4) and the redraw guarantee (§6.3) are off here by construction —
    // this branch never reaches `drawOne`, which is where both live.
    return { pieces: [...pieces], exhausted: pieces.length === 0 };
  }

  const guaranteed = state.config.mode !== 'daily';
  const maxAttempts = guaranteed ? MAX_TRAY_REDRAWS + 1 : 1;
  let pieces: PieceId[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    pieces = [];
    for (let i = 0; i < TRAY_SIZE; i++) pieces.push(drawOne(state));
    if (!guaranteed || pieces.some((id) => hasAnyLegalAnchor(state.board, id))) break;
  }
  state.tray = pieces.map((pieceId) => ({ pieceId, used: false }));
  return { pieces, exhausted: false };
}

const hasAnyMove = (state: GameState): boolean =>
  state.tray.some((slot) => !slot.used && hasAnyLegalAnchor(state.board, slot.pieceId));

// --- public API (§4.3) ----------------------------------------------------

export function createGame(config: GameConfig, seed: string): GameState {
  // §4.3 trust boundary: a `pieceSequence` arrives from the §8.2 server payload,
  // so validate the IDs here rather than failing obscurely on the first refill.
  for (const id of config.pieceSequence ?? []) {
    if (!(id in PIECE_BY_ID))
      throw new EngineConfigError(`Unknown piece id "${id}" in pieceSequence`);
  }

  // §7.7 `seedSalt` makes the same run seed produce a different piece stream per level.
  const rng = createRng(config.level ? `${seed}|${config.level.seedSalt}` : seed);
  const board = createBoard();
  for (const cell of config.level?.prefill ?? []) {
    setCell(board, cell.r, cell.c, cell.type, cell.color ?? 0);
  }

  const state: GameState = {
    config,
    board,
    tray: [],
    rng,
    score: 0,
    combo: 0,
    missStreak: 0,
    goals: (config.level?.goals ?? []).map((g) => ({ type: g.type, remaining: g.count })),
    placements: 0,
    lastIvyDestroyedAt: 0,
    sequenceIndex: 0,
    status: 'playing',
  };

  // An empty sequence is a run with nothing to place — completed, not lost (§8.2).
  const { exhausted } = refillTray(state);
  if (exhausted) state.status = 'completed';
  else if (!hasAnyMove(state)) state.status = 'lost';
  return state;
}

/** All legal anchors for one tray slot (§6.3). Empty for a used slot or a finished game. */
export function getLegalPlacements(state: GameState, pieceIndex: number): Placement[] {
  const slot = state.tray[pieceIndex];
  if (state.status !== 'playing' || !slot || slot.used) return [];
  return legalAnchorsFor(state.board, slot.pieceId).map(({ r, c }) => ({ pieceIndex, r, c }));
}

/**
 * §6.7: true once no further move is possible — board death OR a level win.
 * `state.status` distinguishes 'lost' from 'won'.
 */
export function isGameOver(state: GameState): boolean {
  return state.status !== 'playing' || !hasAnyMove(state);
}

function cloneState(s: GameState): GameState {
  return {
    config: s.config,
    board: cloneBoard(s.board),
    tray: s.tray.map((slot) => ({ ...slot })),
    rng: cloneRng(s.rng),
    score: s.score,
    combo: s.combo,
    missStreak: s.missStreak,
    goals: s.goals.map((g) => ({ ...g })),
    placements: s.placements,
    lastIvyDestroyedAt: s.lastIvyDestroyedAt,
    sequenceIndex: s.sequenceIndex,
    status: s.status,
  };
}

export function applyPlacement(
  prev: GameState,
  placement: Placement,
): { state: GameState; events: GameEvent[] } {
  if (prev.status !== 'playing') throw new IllegalMoveError(`Game already ${prev.status}`);
  const slot = prev.tray[placement.pieceIndex];
  if (!slot) throw new IllegalMoveError(`No tray slot ${placement.pieceIndex}`);
  if (slot.used) throw new IllegalMoveError(`Tray slot ${placement.pieceIndex} already used`);

  const legal = getLegalPlacements(prev, placement.pieceIndex).some(
    (p) => p.r === placement.r && p.c === placement.c,
  );
  if (!legal) {
    throw new IllegalMoveError(
      `Illegal placement: ${slot.pieceId} at (${placement.r}, ${placement.c})`,
    );
  }

  const state = cloneState(prev);
  const events: GameEvent[] = [];
  const t = state.config.tuning;
  const pieceId = slot.pieceId;
  const cells = placementCells(pieceId, placement.r, placement.c);

  // 1. Place (§6.3) and score the placement (§6.6).
  const color = pieceColor(pieceId);
  for (const cell of cells) setCell(state.board, cell.r, cell.c, 'filled', color);
  state.tray = state.tray.map((s, i) => (i === placement.pieceIndex ? { ...s, used: true } : s));
  state.placements += 1;
  const points = placementPoints(cells.length);
  state.score += points;
  events.push({
    type: 'PIECE_PLACED',
    pieceId,
    pieceIndex: placement.pieceIndex,
    r: placement.r,
    c: placement.c,
    cells,
    points,
  });

  // 2. Clear (§6.5) + obstacle reactions (§7.8) + combo/scoring (§6.6).
  const cleared = applyClears(state.board);
  if (cleared) {
    const lines = cleared.rows.length + cleared.cols.length;
    // Multiplier uses the PRE-increment combo counter; see scoring.ts for the reading.
    const gained = clearPoints(
      t.score_clear_base,
      cleared.cells.length,
      lines,
      t.combo_step,
      state.combo,
    );
    state.score += gained;
    state.combo += 1;
    state.missStreak = 0;
    events.push({
      type: 'LINES_CLEARED',
      rows: cleared.rows,
      cols: cleared.cols,
      cells: cleared.cells,
      comboDisplay: state.combo,
      points: gained,
    });

    for (const hit of cleared.hits) {
      events.push({
        type: 'OBSTACLE_HIT',
        obstacle: hit.obstacle,
        r: hit.r,
        c: hit.c,
        destroyed: hit.destroyed,
      });
    }
    if (cleared.ivyDestroyed) state.lastIvyDestroyedAt = state.placements;

    for (const goal of state.goals) {
      const hits = cleared.counts[goal.type] ?? 0;
      if (hits === 0) continue;
      goal.remaining = Math.max(0, goal.remaining - hits);
      events.push({ type: 'GOAL_PROGRESS', goal: goal.type, remaining: goal.remaining });
    }

    // §6.6 perfect clear: board fully empty after a clear. Floored like every
    // other score path — a fractional [RC] must never make `score` non-integer,
    // or the §8.5 exact-match re-simulation fails in a way nobody can diagnose.
    if (fillCount(state.board) === 0) {
      const bonus = Math.floor(t.perfect_clear_bonus);
      state.score += bonus;
      events.push({ type: 'PERFECT_CLEAR', bonus });
    }

    // §6.7: WIN the moment the last goal reaches 0 — takes precedence over a
    // simultaneous board-death, so nothing below this line runs.
    if (state.goals.length > 0 && state.goals.every((g) => g.remaining === 0)) {
      state.status = 'won';
      const stars = starsFor(state.score, state.config.level?.stars);
      events.push({ type: 'LEVEL_WON', score: state.score, stars });
      return { state, events };
    }
  } else {
    state.missStreak += 1;
    if (state.missStreak >= COMBO_RESET_AFTER_MISSES && state.combo > 0) {
      state.combo = 0;
      events.push({ type: 'COMBO_RESET' });
    }
  }

  // 3. Ivy spread (§7.8) — after clearing, so ivy grown this turn is not
  //    immediately cleared by the line that just resolved. Cadence and cap are
  //    per-level (§7.7), never [RC]: see obstacles.ts for why.
  const ivyInterval = state.config.level?.ivySpreadInterval ?? IVY_SPREAD_EVERY;
  const ivyMax = state.config.level?.ivyMaxTiles ?? IVY_MAX_TILES;
  if (
    state.placements % ivyInterval === 0 &&
    state.lastIvyDestroyedAt <= state.placements - ivyInterval
  ) {
    const grown = spreadIvy(state.board, state.rng, ivyMax);
    if (grown) events.push({ type: 'IVY_SPREAD', from: grown.from, to: grown.to });
  }

  // 4. Refill on empty tray (§6.3), then the §6.7 death check.
  if (state.tray.every((s) => s.used)) {
    const { pieces, exhausted } = refillTray(state);
    // §8.2: exhaustion outranks the death check below. The tray is empty at this
    // point, so `hasAnyMove` would otherwise mislabel a survived run as a loss.
    if (exhausted) {
      state.status = 'completed';
      events.push({ type: 'SEQUENCE_EXHAUSTED', score: state.score, moves: state.placements });
      return { state, events };
    }
    events.push({ type: 'TRAY_REFILLED', pieces });
  }
  if (!hasAnyMove(state)) {
    state.status = 'lost';
    events.push({ type: 'GAME_OVER', score: state.score });
  }

  return { state, events };
}

export function boardHash(board: Board): string {
  return fnv1a(`${board.kinds.join(',')}|${board.colors.join(',')}`).toString(16);
}

export function finalResult(state: GameState): FinalResult {
  return {
    status: state.status,
    score: state.score,
    stars: state.status === 'won' ? starsFor(state.score, state.config.level?.stars) : 0,
    moves: state.placements,
    combo: state.combo,
    goals: state.goals.map((g) => ({ ...g })),
    fill: fillCount(state.board),
    boardHash: boardHash(state.board),
  };
}

/**
 * §4.3 / §8.5: replay a move log. Throws `IllegalMoveError` on any move the rules
 * reject — a submission that does not replay is a rejected submission, never a
 * silently truncated one.
 */
export function simulate(config: GameConfig, seed: string, moves: readonly Move[]): FinalResult {
  let state = createGame(config, seed);
  for (const move of moves) {
    state = applyPlacement(state, move).state;
  }
  return finalResult(state);
}
