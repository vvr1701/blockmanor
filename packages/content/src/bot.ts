/**
 * Greedy balance bot — the level-authoring pipeline's stand-in for a player.
 *
 * Policy (level-authoring skill): "maximize immediate clears, tiebreak on
 * keeping large-piece placeability". Concretely, each legal placement is scored
 * on, in order:
 *   1. cells cleared right now (the thing a human sees and chases)
 *   2. how many LARGE pieces still fit afterwards (the thing that kills runs)
 *   3. cells left empty — prefer not filling the board
 * Exact ties are broken by a seeded PRNG, never by array order, so a level's
 * measured win-rate is not an artifact of how the engine happens to enumerate
 * placements.
 *
 * It is deliberately NOT a strong solver. Its job is to be a FIXED yardstick:
 * a level's bot win-rate only means something because the bot never changes.
 * Changing this policy invalidates every committed `_balance_report.json`, the
 * same way changing the PRNG invalidates the golden replays (§4.3).
 */

import {
  CELL_COUNT,
  applyPlacement,
  createGame,
  createRng,
  fillCount,
  finalResult,
  getLegalPlacements,
  hasAnyLegalAnchor,
  nextInt,
  type FinalResult,
  type GameConfig,
  type GameState,
  type Move,
  type PieceId,
  type Placement,
  type Rng,
} from '@blockmanor/engine';

/**
 * The pieces whose placeability is worth protecting: the 3x3 and both pentas.
 * If these still fit, almost everything else does too — so this is a cheap
 * proxy for "the board still has room to breathe".
 */
const LARGE_PIECES: readonly PieceId[] = ['P11', 'P08', 'P09'];

/** Hard stop so a pathological level cannot hang the harness. */
export const MAX_BOT_MOVES = 400;

interface Scored {
  placement: Placement;
  cleared: number;
  breathing: number;
  empty: number;
}

/**
 * Score one placement by actually applying it. `applyPlacement` is pure and
 * clones internally, so the caller's state is untouched — which also means the
 * bot scores against the REAL post-clear board, obstacle reactions and ivy
 * spread included, rather than a simplified model that could drift from the
 * engine's rules.
 */
function score(state: GameState, placement: Placement): Scored {
  const { state: next, events } = applyPlacement(state, placement);

  let cleared = 0;
  for (const event of events) if (event.type === 'LINES_CLEARED') cleared += event.cells.length;

  let breathing = 0;
  for (const id of LARGE_PIECES) if (hasAnyLegalAnchor(next.board, id)) breathing++;

  return { placement, cleared, breathing, empty: CELL_COUNT - fillCount(next.board) };
}

/** Lexicographic on (cleared, breathing, empty). Returns >0 when `a` is better. */
const compare = (a: Scored, b: Scored): number =>
  a.cleared - b.cleared || a.breathing - b.breathing || a.empty - b.empty;

/** The bot's move for a state, or null when nothing is legal. */
export function chooseMove(state: GameState, rng: Rng): Placement | null {
  const best: Scored[] = [];
  for (const [index, slot] of state.tray.entries()) {
    if (slot.used) continue;
    for (const placement of getLegalPlacements(state, index)) {
      const candidate = score(state, placement);
      const cmp = best.length === 0 ? 1 : compare(candidate, best[0] as Scored);
      if (cmp > 0) {
        best.length = 0;
        best.push(candidate);
      } else if (cmp === 0) {
        best.push(candidate);
      }
    }
  }
  if (best.length === 0) return null;
  // Seeded tiebreak: array order must never decide a balance number.
  return (best[nextInt(rng, best.length)] as Scored).placement;
}

export interface BotRun {
  moves: Move[];
  result: FinalResult;
}

/**
 * Play one seed to completion. `botSeed` is separate from the game seed so the
 * same board can be probed with different tiebreak luck, and so a level's seed
 * sweep is reproducible independently of the engine's own draw stream.
 */
export function playout(config: GameConfig, seed: string, botSeed: string): BotRun {
  const rng = createRng(botSeed);
  let state = createGame(config, seed);
  const moves: Move[] = [];

  while (state.status === 'playing' && moves.length < MAX_BOT_MOVES) {
    const move = chooseMove(state, rng);
    if (!move) break;
    moves.push(move);
    state = applyPlacement(state, move).state;
  }

  return { moves, result: finalResult(state) };
}
