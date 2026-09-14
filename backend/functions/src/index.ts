/**
 * Cloud Functions entrypoint (PRD §4.2).
 *
 * Deployed functions:
 *  - `generateDailyBoardScheduled` — §8.2 Daily Board generation, 23:45 UTC,
 *    for the following UTC day.
 *  - `regenerateDailyBoard` — §8.2 admin-only manual re-trigger (self-heal).
 *  - `dailyPlayStart` — §8.3 play-start: consumes the one attempt and returns
 *    the OPENED piece sequence. Per PRD v1.19(ii) the key stays server-side and
 *    the callable opens the seal itself.
 *  - `dailySubmit` — §8.5 anti-cheat submission: re-simulates the move log from
 *    the frozen `engineConfig` snapshot, and awards the §8.6 streak.
 *
 * §8.4's percentile histogram is maintained inside `dailySubmit`.
 */

export { generateDailyBoardScheduled, regenerateDailyBoard } from './daily/publish';
export { dailyPlayStart } from './daily/playStart';
export { dailySubmit } from './daily/submit';
export { registerPush, sendPushScheduled } from './push/push';

// The SECRET half of the §8.2 seam: seed derivation and sequence sealing. These
// stay server-side forever (§16 — the salt lives only in Functions config), and
// §8.3's play-start callable and §8.5's submission callable import them here.
// `sequenceKey` is exported for tests and derivation only — it is never part of
// any callable's response (PRD v1.19(ii)).
export {
  attemptSeed,
  dailySeed,
  openSequence,
  openSequenceWithKey,
  sequenceKey,
} from './daily/seal';
export { DAILY_BOARD_SALT } from './daily/publish';

// The NON-SECRET half — document types, the `dailyGameConfig` builder and the
// fetch-boundary zod schema — is in `@blockmanor/shared` (§4.2), because
// `apps/mobile` must import the very same builder §8.5 re-simulates with.
// Imported from there, not re-exported from here, so there is one import path.
