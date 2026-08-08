/**
 * Cloud Functions entrypoint (PRD §4.2).
 *
 * Deployed functions:
 *  - `generateDailyBoardScheduled` — §8.2 Daily Board generation, 00:00 UTC.
 *
 * Still to come: §8.3's play-start callable (hands the client the sequence key)
 * and §8.5's submission/anti-cheat callable, which re-simulates from the frozen
 * `engineConfig` snapshot this function publishes.
 */

export { generateDailyBoardScheduled } from './daily/publish';

// The §8.3 / §8.5 seam, exported so those functions consume the snapshot rather
// than re-deriving anything from Remote Config.
export {
  dailyGameConfig,
  dailyPlaySeed,
  type DailyBoardDoc,
  type DailyEngineConfig,
  type DailyPrefillCell,
} from './daily/generate';
export {
  attemptSeed,
  dailySeed,
  openSequence,
  sequenceKey,
  type SealedSequence,
} from './daily/seal';
export { DAILY_BOARDS_COLLECTION, DAILY_BOARD_SALT } from './daily/publish';
