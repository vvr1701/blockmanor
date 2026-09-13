/**
 * §8.5 anti-cheat submission + §8.6 streak, against the Firestore emulator.
 *
 * Emulator, not mocks, because every claim here is a claim about persisted
 * state: "one submission per user per day" is what the database refuses on the
 * second call, and "server-authoritative streak" is what is actually written to
 * `users/{uid}`. A mocked Firestore would prove the mock.
 *
 * The move logs are not fixtures. Each test PLAYS the published board with the
 * engine — the same `dailyGameConfig` + `simulate` the callable uses — and
 * submits the log it produced. So an honest submission is honest by
 * construction, and a rejection is a rejection of something the engine itself
 * says is wrong. Nothing under `packages/engine` is touched: no golden replay,
 * no determinism corpus.
 */

import {
  DAILY_ATTEMPTS_SUBCOLLECTION,
  DAILY_BOARDS_COLLECTION,
  REMOTE_CONFIG_DEFAULTS,
  USERS_COLLECTION,
  dailyGameConfig,
  dailyPlaySeed,
  engineVersion,
  parseDailyBoardDoc,
  type DailyBoardDoc,
  DAILY_MOVE_LOGS_SUBCOLLECTION,
  DAILY_STALE_AFTER_MS,
} from '@blockmanor/shared';
import {
  applyPlacement,
  createGame,
  getLegalPlacements,
  simulate,
  TRAY_SIZE,
  type Move,
  type PieceId,
} from '@blockmanor/engine';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNumber: vi.fn<(key: string) => number>(),
  /** Per-key Remote Config provenance, so the `!== 'remote'` branch is reachable. */
  getSource: vi.fn<(key: string) => string>(),
}));

vi.mock('firebase-admin/remote-config', () => ({
  getRemoteConfig: () => ({
    getServerTemplate: async () => ({
      evaluate: () => ({
        getValue: (key: string) => ({
          asNumber: () => mocks.getNumber(key),
          getSource: () => mocks.getSource(key),
        }),
      }),
    }),
  }),
}));

const publish = await import('../src/daily/publish');
const { publishDailyBoard, OPS_ALERTS_COLLECTION } = publish;
const { startDailyAttempt } = await import('../src/daily/playStart');
const { submitDailyAttempt, ENGINE_DRIFT_ALERT, moveLogHash } = await import('../src/daily/submit');
const { attemptSeed, dailySeed, openSequence, sealSequence } = await import('../src/daily/seal');
const { nextStreak, previousUtcDate } = await import('../src/daily/streak');

/** Injected, never the deployed value — `DAILY_BOARD_SALT` is not provisioned. */
const SALT = 'test-salt-not-the-real-one';
const DATE = '2026-08-09';
const YESTERDAY = '2026-08-08';
const ACTIVATES_AT = Date.UTC(2026, 7, 9);
const NOON = ACTIVATES_AT + 12 * 3_600_000;
/** Mid-day on any board's own UTC day — `honestRun` must work for any date. */
const middayOf = (date: string): number => Date.parse(`${date}T12:00:00.000Z`);
const UID = 'alice';
/** §13 default `daily_streak_min_moves`. Never hardcoded in `src/`. */
const MIN_MOVES = REMOTE_CONFIG_DEFAULTS.daily_streak_min_moves;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is unset — run via `firebase emulators:exec --only firestore`',
    );
  }
  if (getApps().length === 0) initializeApp({ projectId: 'demo-blockmanor' });
});

const db = () => getFirestore();
const attemptRef = (date = DATE, uid = UID) =>
  db().collection(USERS_COLLECTION).doc(uid).collection(DAILY_ATTEMPTS_SUBCOLLECTION).doc(date);
const userRef = (uid = UID) => db().collection(USERS_COLLECTION).doc(uid);

async function board(date = DATE): Promise<DailyBoardDoc> {
  return parseDailyBoardDoc(
    (await db().collection(DAILY_BOARDS_COLLECTION).doc(date).get()).data(),
  );
}

/**
 * Re-publish `date`'s board as a §8.2 solvability RE-ROLL: identical content,
 * re-sealed under the `-rN` attempt seed and carrying that `revision`.
 *
 * Built by re-sealing a really-generated board rather than hand-writing a
 * document, so everything except `revision` is exactly what the generator
 * produced. Forcing the generator itself to publish a `-rN` needs roll 0 to
 * fail the solvability gate and roll 1 to pass it, which no Remote Config value
 * arranges deterministically.
 */
async function republishAsRevision(date: string, revision: string): Promise<void> {
  const doc = await board(date);
  const seed = dailySeed(SALT, date);
  const sequence = openSequence(attemptSeed(seed, doc.revision), doc.engineConfig.pieceSequence);
  await db()
    .collection(DAILY_BOARDS_COLLECTION)
    .doc(date)
    .update({
      revision,
      'engineConfig.pieceSequence': sealSequence(attemptSeed(seed, revision), sequence),
    });
}

/**
 * Play a board honestly from a sequence already in hand, taking the first legal
 * placement each time. `limit` stops early — that is §8.3's app-kill path, a
 * legitimate partial log.
 *
 * Pure: no Firestore, no play-start. That is what lets a test build a SECOND
 * log for a uid whose one attempt is already spent, which is exactly the
 * position a duplicate-submission test needs to be in.
 */
function playFrom(
  doc: DailyBoardDoc,
  sequence: readonly PieceId[],
  date: string,
  limit = Number.POSITIVE_INFINITY,
): { moves: Move[]; score: number } {
  let state = createGame(dailyGameConfig(doc.engineConfig, sequence, date), dailyPlaySeed(date));
  const moves: Move[] = [];
  while (state.status === 'playing' && moves.length < limit) {
    let move: Move | undefined;
    for (let i = 0; i < state.tray.length && !move; i++) [move] = getLegalPlacements(state, i);
    if (!move) break;
    moves.push(move);
    state = applyPlacement(state, move).state;
  }
  return { moves, score: state.score };
}

/**
 * §8.3 play-start under `uid`, then play. The sequence comes back through the
 * callable, so this is the list a real player is handed — not one re-derived
 * from the salt behind the callable's back.
 *
 * `uid` defaults to the uid these tests SUBMIT as, on purpose. An earlier
 * version started under throwaway `runner-*` uids, which meant the suite was
 * silently asserting that submission needs no started attempt — the exact
 * contract the §8.6 back-fill blocker turned on. Start and submit are the same
 * player here, as they are in the app.
 */
async function honestRun(
  date = DATE,
  limit = Number.POSITIVE_INFINITY,
  uid = UID,
): Promise<{ moves: Move[]; score: number; sequence: PieceId[]; doc: DailyBoardDoc }> {
  const doc = await board(date);
  const { sequence } = await startDailyAttempt(uid, date, SALT, middayOf(date));
  return { sequence, doc, ...playFrom(doc, sequence, date, limit) };
}

beforeEach(async () => {
  mocks.getNumber.mockImplementation((key) => {
    const fallback = REMOTE_CONFIG_DEFAULTS[key as keyof typeof REMOTE_CONFIG_DEFAULTS];
    return typeof fallback === 'number' ? fallback : 0;
  });
  mocks.getSource.mockImplementation(() => 'remote');
  await db().recursiveDelete(db().collection(DAILY_BOARDS_COLLECTION));
  await db().recursiveDelete(db().collection(USERS_COLLECTION));
  await db().recursiveDelete(db().collection(OPS_ALERTS_COLLECTION));
  await publishDailyBoard(DATE, SALT, '2026-08-08T23:45:00.000Z');
});

describe('§8.5 re-simulation', () => {
  it('accepts an honest run and stores the RE-SIMULATED score', async () => {
    const run = await honestRun();
    const result = await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    expect(result.score).toBe(run.score);
    expect(result.moves).toBe(run.moves.length);

    const stored = await attemptRef().get();
    expect(stored.get('status')).toBe('submitted');
    expect(stored.get('score')).toBe(run.score);
    expect(stored.get('moveCount')).toBe(run.moves.length);
    expect(typeof stored.get('boardHash')).toBe('string');
  });

  it('accepts a PARTIAL log — §8.3 app kill is normal, not an attack', async () => {
    const run = await honestRun(DATE, 5);
    expect(run.moves).toHaveLength(5);
    const result = await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    // The run never ended, so the engine still calls it `playing`. Accepted.
    expect(result.status).toBe('playing');
    expect(result.score).toBe(run.score);
  });

  it('rejects an EDITED claimedScore (§8.8 acceptance criterion)', async () => {
    const run = await honestRun();
    await expect(
      submitDailyAttempt(
        UID,
        { date: DATE, moves: run.moves, claimedScore: run.score + 1 },
        SALT,
        NOON,
      ),
    ).rejects.toMatchObject({ details: { reason: 'score-mismatch' } });
    // Rejected means nothing was written: no score, no submission, no streak.
    expect((await attemptRef().get()).get('status')).not.toBe('submitted');
    expect((await userRef().get()).exists).toBe(false);
  });

  it('logs daily_cheat_rejected on a score mismatch (§8.5)', async () => {
    const { logger } = await import('firebase-functions/v2');
    const warn = vi.spyOn(logger, 'warn');
    const run = await honestRun(DATE, 10);
    await expect(
      submitDailyAttempt(UID, { date: DATE, moves: run.moves, claimedScore: 999_999 }, SALT, NOON),
    ).rejects.toThrow();
    expect(warn).toHaveBeenCalledWith(
      'daily_cheat_rejected',
      expect.objectContaining({ reason: 'score-mismatch', simulatedScore: run.score }),
    );
    warn.mockRestore();
  });

  it('rejects a move log that does not replay on this board', async () => {
    const run = await honestRun(DATE, 10);
    // Legal shape (the zod bounds pass), illegal on this board: overlay the
    // first move on top of itself.
    const moves = [...run.moves, run.moves[0] as Move];
    await expect(
      submitDailyAttempt(UID, { date: DATE, moves, claimedScore: run.score }, SALT, NOON),
    ).rejects.toMatchObject({ details: { reason: 'illegal-move' } });
  });

  it('re-simulates from the FROZEN snapshot, not live Remote Config (§8.2 v1.7)', async () => {
    const run = await honestRun();
    // A LiveOps push lands between play and submit. The frozen scoring constants
    // are what the run was played under, so the honest score must still verify.
    mocks.getNumber.mockImplementation((key) => (key === 'score_clear_base' ? 9_999 : 1));
    await expect(
      submitDailyAttempt(
        UID,
        { date: DATE, moves: run.moves, claimedScore: run.score },
        SALT,
        NOON,
      ),
    ).resolves.toMatchObject({ score: run.score });
  });
});

describe('§8.5 structural rejections', () => {
  it('rejects a second submission for the same day', async () => {
    const run = await honestRun(DATE, 8);
    await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    // Alice's one attempt is spent, so the second log is replayed from the
    // sequence she already holds — which is exactly how a real double-submit
    // would be built.
    const second = playFrom(run.doc, run.sequence, DATE, 4);
    await expect(
      submitDailyAttempt(
        UID,
        { date: DATE, moves: second.moves, claimedScore: second.score },
        SALT,
        NOON,
      ),
    ).rejects.toMatchObject({ details: { reason: 'already-submitted' } });
    // The first submission is still the one on record.
    expect((await attemptRef().get()).get('moveCount')).toBe(run.moves.length);
  });

  it('rejects concurrent submissions — only one lands', async () => {
    const run = await honestRun(DATE, 8);
    const payload = { date: DATE, moves: run.moves, claimedScore: run.score };
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => submitDailyAttempt(UID, payload, SALT, NOON)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await userRef().get()).get('streak')).toBe(1);
  });

  it('rejects more moves than the board has pieces (§8.5, frozen daily_piece_count)', async () => {
    const doc = await board();
    const run = await honestRun(DATE, 4);
    const moves = Array.from(
      { length: doc.engineConfig.pieceCount + 1 },
      () => run.moves[0] as Move,
    );
    await expect(
      submitDailyAttempt(UID, { date: DATE, moves, claimedScore: 0 }, SALT, NOON),
    ).rejects.toMatchObject({ details: { reason: 'too-many-moves' } });
  });

  it('reads the ceiling from the SNAPSHOT, so an RC push cannot move it', async () => {
    const doc = await board();
    const run = await honestRun(DATE, 4);
    const overLong = Array.from(
      { length: doc.engineConfig.pieceCount + 1 },
      () => run.moves[0] as Move,
    );
    // Live RC now says the limit is huge. The snapshot still says 60.
    mocks.getNumber.mockImplementation((key) => (key === 'daily_piece_count' ? 900 : 1));
    await expect(
      submitDailyAttempt(UID, { date: DATE, moves: overLong, claimedScore: 0 }, SALT, NOON),
    ).rejects.toMatchObject({ details: { reason: 'too-many-moves' } });
  });

  it('rejects a submission for a date more than 36h old', async () => {
    const run = await honestRun(DATE, 8);
    const payload = { date: DATE, moves: run.moves, claimedScore: run.score };
    // 35h59m after the board went live: still inside the window.
    await expect(
      submitDailyAttempt(UID, payload, SALT, ACTIVATES_AT + 36 * 3_600_000 - 60_000),
    ).resolves.toMatchObject({ date: DATE });

    await db().recursiveDelete(db().collection(USERS_COLLECTION));
    await expect(
      submitDailyAttempt(UID, payload, SALT, ACTIVATES_AT + 36 * 3_600_000 + 1),
    ).rejects.toMatchObject({ details: { reason: 'stale-date' } });
  });

  it('rejects a submission before the board is live, and one for no board at all', async () => {
    const run = await honestRun(DATE, 8);
    await expect(
      submitDailyAttempt(
        UID,
        { date: DATE, moves: run.moves, claimedScore: run.score },
        SALT,
        ACTIVATES_AT - 1,
      ),
    ).rejects.toMatchObject({ details: { reason: 'not-yet-live' } });
    await expect(
      submitDailyAttempt(UID, { date: '2026-08-20', moves: [], claimedScore: 0 }, SALT, NOON),
    ).rejects.toMatchObject({ details: { reason: 'not-published' } });
  });

  it('refuses a submission with no started attempt — a missed day cannot be back-filled', async () => {
    // §8.6 blocker. §8.1 makes the board "identical ... for every player", so
    // the sequence is not a per-player secret: one player who started can share
    // it with anyone. `leaker` stands for that.
    const run = await honestRun(DATE, 12, 'leaker');

    // Alice never opened the board. She MISSED the day.
    await userRef().set({ streak: 5, lastStreakDate: YESTERDAY });
    expect((await attemptRef().get()).exists).toBe(false);

    // 30h in: past the board's own UTC day (24h), inside §8.5's stale window
    // (36h). Play-start already refuses here (PRD v1.19(iv))…
    const closed = ACTIVATES_AT + 30 * 3_600_000;
    await expect(startDailyAttempt(UID, DATE, SALT, closed)).rejects.toMatchObject({
      details: { reason: 'closed' },
    });
    // …and submit must not be the second door onto the same board.
    await expect(
      submitDailyAttempt(
        UID,
        { date: DATE, moves: run.moves, claimedScore: run.score },
        SALT,
        closed,
      ),
    ).rejects.toMatchObject({ details: { reason: 'not-started' } });

    // "A missed UTC day resets to 0" survives: nothing moved.
    const user = await userRef().get();
    expect(user.get('streak')).toBe(5);
    expect(user.get('lastStreakDate')).toBe(YESTERDAY);
    expect((await attemptRef().get()).exists).toBe(false);
  });

  it('refuses it mid-day too — the requirement is a started attempt, not a closed day', async () => {
    const run = await honestRun(DATE, 12, 'leaker');
    await expect(
      submitDailyAttempt(
        UID,
        { date: DATE, moves: run.moves, claimedScore: run.score },
        SALT,
        NOON,
      ),
    ).rejects.toMatchObject({ details: { reason: 'not-started' } });
    expect((await userRef().get()).exists).toBe(false);
  });

  it('plays and submits end to end on a re-rolled (-rN) board', async () => {
    // Every other test in this suite publishes a `revision: ''` board, so both
    // seals key off the empty string and a regression that ignored `revision`
    // would go unseen — while on a real re-roll day it would surface as
    // `internal` for EVERY honest player, the "honest submissions fail
    // together" mode §8.5 exists to prevent.
    await republishAsRevision(DATE, '-r1');
    expect((await board()).revision).toBe('-r1');

    // Play-start keys the seal off `revision` too, so this covers both callables.
    const run = await honestRun(DATE, 12);
    await expect(
      submitDailyAttempt(
        UID,
        { date: DATE, moves: run.moves, claimedScore: run.score },
        SALT,
        NOON,
      ),
    ).resolves.toMatchObject({ score: run.score, moves: 12 });
  });

  it('rejects a malformed payload at the trust boundary', async () => {
    for (const bad of [
      {},
      { date: 'today', moves: [], claimedScore: 0 },
      { date: DATE, moves: [{ pieceIndex: 9, r: 0, c: 0 }], claimedScore: 0 },
      { date: DATE, moves: [{ pieceIndex: 0, r: 99, c: 0 }], claimedScore: 0 },
      { date: DATE, moves: [{ pieceIndex: 0, r: 0, c: 0 }], claimedScore: -1 },
      { date: DATE, moves: 'lots', claimedScore: 0 },
    ]) {
      await expect(submitDailyAttempt(UID, bad, SALT, NOON)).rejects.toMatchObject({
        code: 'invalid-argument',
      });
    }
  });
});

describe('§8.2 engineVersion drift (v1.12/v1.14, ruled for §8.5)', () => {
  const driftDate = '2026-08-09';

  it('raises a durable ops alert and changes NOTHING about the submission', async () => {
    const run = await honestRun();
    // The board says it was generated under a different engine than this deploy.
    await db()
      .collection(DAILY_BOARDS_COLLECTION)
      .doc(driftDate)
      .update({ engineVersion: 'daily-sim-v2+deadbeef' });

    // The honest submission is still accepted, on its own merits. A mismatch is
    // an ops signal, never a player verdict: we deployed under them.
    await expect(
      submitDailyAttempt(
        UID,
        { date: driftDate, moves: run.moves, claimedScore: run.score },
        SALT,
        NOON,
      ),
    ).resolves.toMatchObject({ score: run.score, streakGranted: true });

    const alert = await db()
      .collection(OPS_ALERTS_COLLECTION)
      .doc(`${driftDate}_${ENGINE_DRIFT_ALERT}`)
      .get();
    expect(alert.exists).toBe(true);
    expect(alert.get('boardEngineVersion')).toBe('daily-sim-v2+deadbeef');
    expect(alert.get('liveEngineVersion')).toBe(engineVersion());
    expect(typeof alert.get('raisedAt')).toBe('string');
  });

  it('re-raises after a failed durable write — the memo records success, not intent', async () => {
    // A date of its own: `alerted` is module state that outlives a test, and the
    // case above already spent DATE. That is the memo working, not a leak.
    // `raiseOpsAlert` swallows persistence failures by design (an alert must
    // never block a submission). If the drift memo were set BEFORE the write,
    // one Firestore blip would turn a whole warm instance's drift day into log
    // lines nobody queries later — losing exactly the durable half the alert
    // exists for.
    const own = '2026-08-10';
    await publishDailyBoard(own, SALT, '2026-08-09T23:45:00.000Z');
    await db()
      .collection(DAILY_BOARDS_COLLECTION)
      .doc(own)
      .update({ engineVersion: 'daily-sim-v2+deadbeef' });

    const raise = vi.spyOn(publish, 'raiseOpsAlert').mockResolvedValueOnce(false);
    const first = await honestRun(own, MIN_MOVES, 'first');
    await submitDailyAttempt(
      'first',
      { date: own, moves: first.moves, claimedScore: first.score },
      SALT,
      middayOf(own),
    );
    // The write "failed", so nothing was persisted and nothing was memoised.
    expect((await db().collection(OPS_ALERTS_COLLECTION).get()).empty).toBe(true);

    // Next submission on the same instance must try again, not skip.
    raise.mockRestore();
    const second = await honestRun(own, MIN_MOVES, 'second');
    await submitDailyAttempt(
      'second',
      { date: own, moves: second.moves, claimedScore: second.score },
      SALT,
      middayOf(own),
    );
    expect(
      (await db().collection(OPS_ALERTS_COLLECTION).doc(`${own}_${ENGINE_DRIFT_ALERT}`).get())
        .exists,
    ).toBe(true);
  });

  it('raises no alert when the fingerprints agree', async () => {
    const run = await honestRun(DATE, MIN_MOVES);
    await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    expect((await db().collection(OPS_ALERTS_COLLECTION).get()).empty).toBe(true);
  });
});

describe('§8.6 streak', () => {
  it('grants +1 for playing, regardless of score', async () => {
    const run = await honestRun(DATE, MIN_MOVES);
    await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    const user = await userRef().get();
    expect(user.get('streak')).toBe(1);
    expect(user.get('lastStreakDate')).toBe(DATE);
    expect((await attemptRef().get()).get('streakGranted')).toBe(true);
  });

  it('extends a streak whose last credited day is yesterday', async () => {
    await userRef().set({ streak: 6, lastStreakDate: YESTERDAY });
    const run = await honestRun(DATE, MIN_MOVES);
    const result = await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    expect(result.streak).toBe(7);
    expect((await userRef().get()).get('streak')).toBe(7);
  });

  it('resets to 1 after a missed UTC day', async () => {
    await userRef().set({ streak: 42, lastStreakDate: '2026-08-06' });
    const run = await honestRun(DATE, MIN_MOVES);
    const result = await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    expect(result.streak).toBe(1);
  });

  it('consumes the attempt but grants NO streak below daily_streak_min_moves', async () => {
    const run = await honestRun(DATE, MIN_MOVES - 1);
    expect(run.moves).toHaveLength(MIN_MOVES - 1);
    await userRef().set({ streak: 4, lastStreakDate: YESTERDAY });

    const result = await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    expect(result.streakGranted).toBe(false);
    // §8.6: "the attempt is still consumed but no streak is granted."
    expect(result.streak).toBe(4);
    const user = await userRef().get();
    expect(user.get('streak')).toBe(4);
    expect(user.get('lastStreakDate')).toBe(YESTERDAY);
    expect((await attemptRef().get()).get('status')).toBe('submitted');
    // …and the day is spent: no second try at the streak.
    const better = playFrom(run.doc, run.sequence, DATE, MIN_MOVES + 2);
    await expect(
      submitDailyAttempt(
        UID,
        { date: DATE, moves: better.moves, claimedScore: better.score },
        SALT,
        NOON,
      ),
    ).rejects.toMatchObject({ details: { reason: 'already-submitted' } });
    expect((await userRef().get()).get('streak')).toBe(4);
  });

  it('grants exactly AT the threshold', async () => {
    const run = await honestRun(DATE, MIN_MOVES);
    const result = await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    expect(result.streakGranted).toBe(true);
  });

  it('honours a Remote-Config-raised daily_streak_min_moves', async () => {
    mocks.getNumber.mockImplementation((key) =>
      key === 'daily_streak_min_moves'
        ? 20
        : ((REMOTE_CONFIG_DEFAULTS[key as keyof typeof REMOTE_CONFIG_DEFAULTS] as number) ?? 0),
    );
    const run = await honestRun(DATE, 5);
    const result = await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      NOON,
    );
    expect(result.streakGranted).toBe(false);
  });

  it('falls back to the §13 default on a value the template never SET (provenance)', async () => {
    // Pins `getSource() !== 'remote'` on its own. 50 is a perfectly valid,
    // in-bounds integer — nothing else in the check can reject it. The only
    // thing wrong with it is that the admin SDK resolved it from
    // `defaultConfig`, not from the console, and `getSource()` is the only
    // thing that says so. (The empty-console case where `asNumber()` reads 0 is
    // caught by the lower bound below, which is exactly why it cannot pin this.)
    mocks.getSource.mockImplementation((key) =>
      key === 'daily_streak_min_moves' ? 'default' : 'remote',
    );
    mocks.getNumber.mockImplementation((key) =>
      key === 'daily_streak_min_moves'
        ? 50
        : ((REMOTE_CONFIG_DEFAULTS[key as keyof typeof REMOTE_CONFIG_DEFAULTS] as number) ?? 0),
    );
    const run = await honestRun(DATE, MIN_MOVES);
    await expect(
      submitDailyAttempt(
        UID,
        { date: DATE, moves: run.moves, claimedScore: run.score },
        SALT,
        NOON,
      ),
      // The §13 default (3) was used, so a 3-move run earns the day. Had the
      // unsourced 50 been trusted, it would not have.
    ).resolves.toMatchObject({ streakGranted: true });
  });

  it('falls back to the §13 default on an out-of-bounds live value', async () => {
    // One case per CLAUSE of the bounds check, each chosen so that only its own
    // clause can reject it. `n < 1` alone catches the first two and nothing
    // else — which is how the other three clauses survived a mutation sweep
    // once already.
    const cases = [
      {
        bad: 0,
        moves: MIN_MOVES - 1,
        granted: false,
        pins: 'lower bound — asNumber() renders a typo as 0',
      },
      { bad: -5, moves: MIN_MOVES - 1, granted: false, pins: 'lower bound — negative' },
      { bad: 3.5, moves: MIN_MOVES, granted: true, pins: 'Number.isInteger' },
      { bad: 5_000, moves: MIN_MOVES, granted: true, pins: 'upper bound' },
    ];
    for (const { bad, moves, granted, pins } of cases) {
      await db().recursiveDelete(db().collection(USERS_COLLECTION));
      mocks.getNumber.mockImplementation((key) =>
        key === 'daily_streak_min_moves'
          ? bad
          : ((REMOTE_CONFIG_DEFAULTS[key as keyof typeof REMOTE_CONFIG_DEFAULTS] as number) ?? 0),
      );
      const run = await honestRun(DATE, moves);
      const result = await submitDailyAttempt(
        UID,
        { date: DATE, moves: run.moves, claimedScore: run.score },
        SALT,
        NOON,
      );
      expect(result.streakGranted, `daily_streak_min_moves=${bad} pins ${pins}`).toBe(granted);
    }
  });

  it('credits the BOARD day, not the submission day, across the UTC boundary (§8.8)', async () => {
    // Played at 23:59 UTC on D, app-killed, submitted at 00:30 on D+1. A device
    // clock skewed ±3h changes neither: the credited day comes from the board.
    await userRef().set({ streak: 2, lastStreakDate: YESTERDAY });
    const run = await honestRun(DATE, MIN_MOVES);
    const result = await submitDailyAttempt(
      UID,
      { date: DATE, moves: run.moves, claimedScore: run.score },
      SALT,
      ACTIVATES_AT + 86_400_000 + 30 * 60_000,
    );
    expect(result.streak).toBe(3);
    expect((await userRef().get()).get('lastStreakDate')).toBe(DATE);
  });
});

describe('§8.6 nextStreak (pure)', () => {
  it('covers every branch', () => {
    expect(previousUtcDate('2026-01-01')).toBe('2025-12-31');
    expect(previousUtcDate('2026-03-01')).toBe('2026-02-28');
    // No history: today is day 1.
    expect(nextStreak({ streak: 0 }, DATE)).toStrictEqual({ streak: 1, lastStreakDate: DATE });
    expect(nextStreak({ streak: 9 }, DATE)).toStrictEqual({ streak: 1, lastStreakDate: DATE });
    // Yesterday: extend.
    expect(nextStreak({ streak: 9, lastStreakDate: YESTERDAY }, DATE)).toStrictEqual({
      streak: 10,
      lastStreakDate: DATE,
    });
    // A gap: reset, and today still counts as 1.
    expect(nextStreak({ streak: 9, lastStreakDate: '2026-08-01' }, DATE)).toStrictEqual({
      streak: 1,
      lastStreakDate: DATE,
    });
    // Already credited, or a late arrival for an older day: unchanged.
    expect(nextStreak({ streak: 9, lastStreakDate: DATE }, DATE)).toStrictEqual({
      streak: 9,
      lastStreakDate: DATE,
    });
    expect(nextStreak({ streak: 9, lastStreakDate: '2026-08-10' }, DATE)).toStrictEqual({
      streak: 9,
      lastStreakDate: '2026-08-10',
    });
    // Across a month boundary.
    expect(nextStreak({ streak: 3, lastStreakDate: '2026-07-31' }, '2026-08-01')).toStrictEqual({
      streak: 4,
      lastStreakDate: '2026-08-01',
    });
  });
});

describe('§0 v1.26(b) move-log dedupe, and the §8.5 re-audit test gaps', () => {
  const submit = (uid: string, run: { moves: Move[]; score: number }, at = NOON) =>
    submitDailyAttempt(uid, { date: DATE, moves: run.moves, claimedScore: run.score }, SALT, at);

  it('stores the move-log hash, and the first accepted log counts for the percentile', async () => {
    const run = await honestRun(DATE, 12);
    await expect(submit(UID, run)).resolves.toMatchObject({ countsForPercentile: true });

    const doc = await attemptRef().get();
    expect(doc.get('movesHash')).toBe(moveLogHash(run.moves));
    expect(doc.get('countsForPercentile')).toBe(true);
    const owner = await db()
      .collection(DAILY_BOARDS_COLLECTION)
      .doc(DATE)
      .collection(DAILY_MOVE_LOGS_SUBCOLLECTION)
      .doc(moveLogHash(run.moves))
      .get();
    expect(owner.get('uid')).toBe(UID);
  });

  it('a copied top log is accepted for the copier but never counts for the percentile', async () => {
    // The board is identical for everyone (§8.1), so any log replays for anyone
    // who started. Accepted — the copier did start the day — but excluded.
    const top = await honestRun(DATE, 14, 'topplayer');
    await expect(submit('topplayer', top)).resolves.toMatchObject({ countsForPercentile: true });

    await startDailyAttempt('copycat', DATE, SALT, NOON);
    await expect(submit('copycat', top, NOON + 1_000)).resolves.toMatchObject({
      score: top.score,
      countsForPercentile: false,
    });
    expect((await attemptRef(DATE, 'copycat').get()).get('countsForPercentile')).toBe(false);
  });

  it('two different logs both count for the percentile', async () => {
    // Without this, a hash that ignored the moves would drop everyone after the
    // day's first submission out of §8.4's histogram and still pass the suite.
    const a = await honestRun(DATE, 5, 'alice');
    const b = await honestRun(DATE, 8, 'bob');
    await expect(submit('alice', a)).resolves.toMatchObject({ countsForPercentile: true });
    await expect(submit('bob', b)).resolves.toMatchObject({ countsForPercentile: true });
  });

  it('a copy with moves reordered inside a tray is the same log (§0 v1.27)', async () => {
    const top = await honestRun(DATE, Number.POSITIVE_INFINITY, 'topplayer');
    await submit('topplayer', top);
    const config = dailyGameConfig(top.doc.engineConfig, top.sequence, DATE);
    let reordered: Move[] | undefined;
    for (let i = 0; i + 1 < top.moves.length && !reordered; i++) {
      if (i % TRAY_SIZE === TRAY_SIZE - 1) continue; // i and i+1 straddle a refill
      const swapped = top.moves.slice();
      [swapped[i], swapped[i + 1]] = [swapped[i + 1]!, swapped[i]!];
      try {
        if (simulate(config, dailyPlaySeed(DATE), swapped).score === top.score) reordered = swapped;
      } catch {
        // illegal in this order; try the next pair
      }
    }
    expect(reordered, 'an in-tray swap that replays to the same score').toBeDefined();
    expect(moveLogHash(reordered!)).toBe(moveLogHash(top.moves));

    await startDailyAttempt('copycat', DATE, SALT, NOON);
    await expect(
      submitDailyAttempt(
        'copycat',
        { date: DATE, moves: reordered!, claimedScore: top.score },
        SALT,
        NOON + 1_000,
      ),
    ).resolves.toMatchObject({ score: top.score, countsForPercentile: false });
  });

  it('the move-log hash sorts within a tray, never across trays', () => {
    const m = (pieceIndex: number, r: number, c: number): Move => ({ pieceIndex, r, c });
    const log = [m(0, 0, 0), m(1, 1, 1), m(2, 2, 2), m(0, 3, 3), m(1, 4, 4)];
    expect(moveLogHash([m(2, 2, 2), m(0, 0, 0), m(1, 1, 1), m(1, 4, 4), m(0, 3, 3)])).toBe(
      moveLogHash(log),
    );
    // The same placements moved into another tray are a different game.
    expect(moveLogHash([m(0, 3, 3), m(1, 1, 1), m(2, 2, 2), m(0, 0, 0), m(1, 4, 4)])).not.toBe(
      moveLogHash(log),
    );
    expect(moveLogHash([m(0, 0, 0), m(1, 1, 1), m(2, 2, 2), m(0, 3, 3), m(1, 4, 5)])).not.toBe(
      moveLogHash(log),
    );
  });

  it('first accepted wins under real concurrency, and owns the move log', async () => {
    const top = await honestRun(DATE, Number.POSITIVE_INFINITY, 'u0');
    const uids = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'];
    for (const u of uids.slice(1)) await startDailyAttempt(u, DATE, SALT, NOON);
    const results = await Promise.all(uids.map((u) => submit(u, top)));
    const winners = uids.filter((_, i) => results[i]!.countsForPercentile);
    expect(winners).toHaveLength(1);
    const owner = await db()
      .collection(DAILY_BOARDS_COLLECTION)
      .doc(DATE)
      .collection(DAILY_MOVE_LOGS_SUBCOLLECTION)
      .doc(moveLogHash(top.moves))
      .get();
    expect(owner.get('uid')).toBe(winners[0]);
  });

  it('never logs daily_cheat_rejected for an honest submission on a drifted board', async () => {
    const { logger } = await import('firebase-functions/v2');
    const warn = vi.spyOn(logger, 'warn');
    try {
      const run = await honestRun();
      await db()
        .collection(DAILY_BOARDS_COLLECTION)
        .doc(DATE)
        .update({ engineVersion: 'daily-sim-v2+deadbeef' });
      await expect(submit(UID, run)).resolves.toMatchObject({ streakGranted: true });
      expect(warn.mock.calls.filter(([msg]) => msg === 'daily_cheat_rejected')).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses every attempt status other than exactly "started"', async () => {
    const run = await honestRun(DATE, 12);
    for (const status of ['STARTED', 'abandoned', '', null, 1, ['started'], ' started']) {
      await attemptRef().set({ date: DATE, status });
      await expect(submit(UID, run)).rejects.toMatchObject({ details: { reason: 'not-started' } });
    }
  });

  it('accepts at exactly activatesAt + 36h and refuses one millisecond later', async () => {
    const run = await honestRun(DATE, 12);
    await expect(submit(UID, run, ACTIVATES_AT + DAILY_STALE_AFTER_MS + 1)).rejects.toMatchObject({
      details: { reason: 'stale-date' },
    });
    await expect(submit(UID, run, ACTIVATES_AT + DAILY_STALE_AFTER_MS)).resolves.toMatchObject({
      score: run.score,
    });
  });

  it('logs a not-started submission as daily_cheat_rejected', async () => {
    const { logger } = await import('firebase-functions/v2');
    const warn = vi.spyOn(logger, 'warn');
    try {
      const run = await honestRun(DATE, 12, 'leaker');
      await expect(submit(UID, run)).rejects.toMatchObject({ details: { reason: 'not-started' } });
      expect(warn).toHaveBeenCalledWith(
        'daily_cheat_rejected',
        expect.objectContaining({ reason: 'not-started', uid: UID }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('stores streakGranted=false on the submission for a run below daily_streak_min_moves', async () => {
    const run = await honestRun(DATE, REMOTE_CONFIG_DEFAULTS.daily_streak_min_moves - 1);
    await expect(submit(UID, run)).resolves.toMatchObject({ streakGranted: false });
    expect((await attemptRef().get()).get('streakGranted')).toBe(false);
  });
});
