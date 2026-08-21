/**
 * Cloud Functions entrypoint (PRD §4.2).
 *
 * Deployed functions:
 *  - `generateDailyBoardScheduled` — §8.2 Daily Board generation, 23:45 UTC,
 *    for the following UTC day.
 *  - `regenerateDailyBoard` — §8.2 admin-only manual re-trigger (self-heal).
 *
 * Still to come: §8.3's play-start callable (hands the client the sequence key)
 * and §8.5's submission/anti-cheat callable, which re-simulates from the frozen
 * `engineConfig` snapshot this function publishes.
 */

export { generateDailyBoardScheduled, regenerateDailyBoard } from './daily/publish';

// The SECRET half of the §8.2 seam: seed derivation and sequence sealing. These
// stay server-side forever (§16 — the salt lives only in Functions config), and
// §8.3's play-start callable and §8.5's submission callable import them here.
export { attemptSeed, dailySeed, openSequence, sequenceKey } from './daily/seal';
export { DAILY_BOARD_SALT } from './daily/publish';

// The NON-SECRET half — document types, the `dailyGameConfig` builder and the
// fetch-boundary zod schema — is in `@blockmanor/shared` (§4.2), because
// `apps/mobile` must import the very same builder §8.5 re-simulates with.
// Imported from there, not re-exported from here, so there is one import path.
