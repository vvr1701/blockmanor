/**
 * @blockmanor/content — level data plus the Stage-0 authoring tooling (PRD §5).
 *
 * Tooling only at Stage 0: the generator and balance harness exist so that
 * shipped levels 1–60 (Stage 1, §7.9) can be measured rather than guessed.
 */

export {
  levelSchema,
  parseLevel,
  goalTypeSchema,
  prefillTypeSchema,
  type LevelJson,
} from './schema';
export { chooseMove, playout, MAX_BOT_MOVES, type BotRun } from './bot';
export {
  generateLevel,
  type GeneratorParams,
  type ObstacleType,
  type PatternClass,
} from './generator';
export {
  buildReport,
  measureLevel,
  specFrom,
  DEFAULT_SEEDS,
  HARNESS_VERSION,
  REFERENCE_TUNING,
  WIN_RATE_TOLERANCE_PP,
  type BalanceReport,
  type LevelBalance,
  type LevelSpec,
} from './harness';
