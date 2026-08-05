/**
 * @blockmanor/engine — the pure, deterministic game engine (PRD §6).
 *
 * Public contract: PRD §4.3. Breaking it requires a PRD amendment first.
 * Zero runtime dependencies; no React/RN/network/storage/clock/`Math.random`.
 */

export {
  BOARD_SIZE,
  BLOCK_COLOR_COUNT,
  CELL_COUNT,
  cellColor,
  cellIndex,
  cellKind,
  computeOcc,
  createBoard,
  fillCount,
  fillRatio,
  isOccupied,
  type Board,
  type CellKind,
  type CellRef,
  type ObstacleKind,
} from './board';

export { applyClears, findFullLines, type ClearResult, type ObstacleHit } from './clearing';

export {
  PIECES,
  PIECE_BY_ID,
  PIECE_IDS,
  SMALL_POOL,
  drawPiece,
  pieceColor,
  pieceWeight,
  type Piece,
  type PieceId,
  type PieceWeightOverrides,
} from './pieces';

export {
  canPlace,
  hasAnyLegalAnchor,
  legalAnchorsFor,
  placementCells,
  type Move,
  type Placement,
} from './placement';

export {
  GOAL_TYPES,
  IVY_MAX_TILES,
  IVY_SPREAD_EVERY,
  ivyCount,
  resolveOnClear,
  spreadIvy,
  type GoalType,
} from './obstacles';

export { COMBO_RESET_AFTER_MISSES, clearPoints, placementPoints, starsFor } from './scoring';

export {
  LevelSchemaError,
  validateLevel,
  type LevelConfig,
  type LevelGoal,
  type LevelPrefillCell,
  type LevelStars,
} from './levels';

export { createRng, cloneRng, fnv1a, nextFloat, nextInt, nextU32, type Rng } from './rng';

export {
  EngineConfigError,
  IllegalMoveError,
  MAX_TRAY_REDRAWS,
  TRAY_SIZE,
  applyPlacement,
  boardHash,
  createGame,
  finalResult,
  getLegalPlacements,
  isGameOver,
  simulate,
  type EngineTuning,
  type FinalResult,
  type GameConfig,
  type GameEvent,
  type GameMode,
  type GameState,
  type GameStatus,
  type GoalProgress,
  type TraySlot,
} from './simulate';
