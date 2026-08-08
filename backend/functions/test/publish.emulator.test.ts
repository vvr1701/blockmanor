/**
 * PRD §8.2 publication + Firestore rules — EMULATOR-DEPENDENT, ALL SKIPPED.
 *
 * WHY THEY ARE SKIPPED: these need the Firestore emulator, which needs the
 * Firebase CLI and a JRE. Neither is installed in this environment, and no
 * Firebase project has been provisioned yet either. They have therefore NEVER
 * BEEN RUN — do not read a green suite as coverage of anything in this file.
 *
 * TO RUN THEM: install a JRE and `npm i -g firebase-tools`, add
 * `@firebase/rules-unit-testing` to this package, then
 *   firebase emulators:exec --only firestore "pnpm --filter @blockmanor/functions test"
 * and change `describe.skip` to `describe`.
 *
 * Everything §8.2 specifies that can be checked WITHOUT an emulator is checked
 * in `generate.test.ts`, and that is the bulk of the section: seed derivation,
 * prefill, sequence, the frozen snapshot, sealing, the solvability gate and the
 * §8.5 determinism contract.
 */

import { describe, expect, it } from 'vitest';
import { utcDate } from '../src/daily/publish';

describe('§8.2 publication (emulator required — NOT RUN)', () => {
  it.skip('writes dailyBoards/{date} with the sealed sequence and frozen snapshot', () => {
    // Would assert: after publishDailyBoard('2026-08-09', salt, iso), the doc at
    // dailyBoards/2026-08-09 exists, its engineConfig.pieceSequence is a
    // SealedSequence, and its plaintext appears nowhere in the stored JSON.
    expect.fail('emulator unavailable');
  });

  it.skip('is idempotent: a scheduler retry leaves the first document untouched', () => {
    // Would assert: a second publishDailyBoard for the same date returns
    // { status: 'exists' } and the stored doc is byte-unchanged — including the
    // case where Remote Config changed between the two runs, which is the only
    // way determinism alone would not have covered it.
    expect.fail('emulator unavailable');
  });

  it.skip('reads Remote Config exactly once per generation', () => {
    // Would assert against an instrumented admin RemoteConfig: one
    // getServerTemplate call for a whole publish, and zero on any later read of
    // the document (PRD v1.7 — RC is never in the daily path after generation).
    expect.fail('emulator unavailable');
  });

  it.skip('falls back to the §13 registry defaults when Remote Config is unreadable', () => {
    // Would assert: with RC erroring, the published snapshot equals
    // REMOTE_CONFIG_DEFAULTS for all five engine keys and daily_piece_count,
    // and a warning is logged.
    expect.fail('emulator unavailable');
  });
});

describe('§8.2 Firestore rules (emulator required — NOT RUN)', () => {
  it.skip('a signed-in client can read dailyBoards/{date}', () => {
    expect.fail('emulator unavailable');
  });

  it.skip('an unauthenticated client cannot read dailyBoards/{date}', () => {
    expect.fail('emulator unavailable');
  });

  it.skip('no client may write dailyBoards/{date}', () => {
    // create, update and delete all denied — §8.2 boards come only from the
    // scheduled function via the Admin SDK.
    expect.fail('emulator unavailable');
  });

  it.skip('a client reads only its own users/{uid} and writes none of it', () => {
    // §4.4/§8.6: streak (and, from Stage 2, wallet) are server-authoritative.
    expect.fail('emulator unavailable');
  });

  it.skip('every unlisted collection is denied for read and write', () => {
    expect.fail('emulator unavailable');
  });
});

// One thing in publish.ts is pure and does not need the emulator, so it is
// tested for real rather than skipped: the schedule fires at 00:00 UTC and the
// document key must be that UTC day, never a local one (§8.1, §8.6).
describe('§8.2 UTC date keying (no emulator needed)', () => {
  it('keys the board by UTC day, including either side of the boundary', () => {
    expect(utcDate('2026-08-09T00:00:00.000Z')).toBe('2026-08-09');
    expect(utcDate('2026-08-09T23:59:59.999Z')).toBe('2026-08-09');
    // A scheduler that fires a hair early must still key the day it names.
    expect(utcDate('2026-08-10T00:00:00.000Z')).toBe('2026-08-10');
    // An offset instant is normalised to UTC, never to the runner's zone.
    expect(utcDate('2026-08-09T05:30:00.000+05:30')).toBe('2026-08-09');
    expect(utcDate('2026-08-10T04:00:00.000+05:30')).toBe('2026-08-09');
  });
});
