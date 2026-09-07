/**
 * §8.3 play-start against the Firestore emulator.
 *
 * Emulator and not a unit test on purpose: both properties worth proving here
 * are Firestore's own. "One attempt means one" is `create()` refusing to
 * overwrite — a mocked Firestore would prove only that the mock refuses — and
 * "a refused start does not consume the attempt" is a claim about what is
 * actually in the database afterwards.
 *
 * Run by CI's `emulator` job under `firebase emulators:exec --only firestore`.
 * Remote Config is mocked (there is no RC emulator) exactly as in
 * `publish.emulator.test.ts`; play-start itself reads no Remote Config at all
 * (§8.2 / v1.7) — the mock is only there for `publishDailyBoard`, which seeds
 * the board these tests play against.
 */

import {
  DAILY_ATTEMPTS_SUBCOLLECTION,
  DAILY_BOARDS_COLLECTION,
  REMOTE_CONFIG_DEFAULTS,
  USERS_COLLECTION,
  parseDailyBoardDoc,
  type DailyBoardDoc,
} from '@blockmanor/shared';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getNumber: vi.fn<(key: string) => number>() }));

vi.mock('firebase-admin/remote-config', () => ({
  getRemoteConfig: () => ({
    getServerTemplate: async () => ({
      evaluate: () => ({
        getValue: (key: string) => ({
          asNumber: () => mocks.getNumber(key),
          getSource: () => 'remote',
        }),
      }),
    }),
  }),
}));

const { publishDailyBoard } = await import('../src/daily/publish');
const { startDailyAttempt } = await import('../src/daily/playStart');
const { attemptSeed, dailySeed, openSequenceWithKey, sequenceKey } =
  await import('../src/daily/seal');

/** Injected, never the deployed value — `DAILY_BOARD_SALT` is not provisioned. */
const SALT = 'test-salt-not-the-real-one';
const DATE = '2026-08-09';
const ACTIVATES_AT = Date.UTC(2026, 7, 9);
const DAY_MS = 86_400_000;
const UID = 'alice';
const PIECE_COUNT = 60;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is unset — run via `firebase emulators:exec --only firestore`',
    );
  }
  if (getApps().length === 0) initializeApp({ projectId: 'demo-blockmanor' });
});

const attemptRef = (date = DATE, uid = UID) =>
  getFirestore()
    .collection(USERS_COLLECTION)
    .doc(uid)
    .collection(DAILY_ATTEMPTS_SUBCOLLECTION)
    .doc(date);

beforeEach(async () => {
  mocks.getNumber.mockImplementation((key) => {
    const fallback = REMOTE_CONFIG_DEFAULTS[key as keyof typeof REMOTE_CONFIG_DEFAULTS];
    return typeof fallback === 'number' ? fallback : 0;
  });
  const db = getFirestore();
  await db.recursiveDelete(db.collection(DAILY_BOARDS_COLLECTION));
  await db.recursiveDelete(db.collection(USERS_COLLECTION));
  await publishDailyBoard(DATE, SALT, '2026-08-08T23:45:00.000Z');
});

async function board(date = DATE): Promise<DailyBoardDoc> {
  return parseDailyBoardDoc(
    (await getFirestore().collection(DAILY_BOARDS_COLLECTION).doc(date).get()).data(),
  );
}

/** Mid-day on D, well inside the board's live window. */
const middayOf = (activatesAt: number): number => activatesAt + 12 * 3_600_000;

/** The §8.2 key for a board, derived the way generation derived it. */
const keyFor = (board: DailyBoardDoc): Buffer =>
  sequenceKey(attemptSeed(dailySeed(SALT, board.date), board.revision));

describe('§8.3 play-start — the sequence', () => {
  it('returns the plaintext the published seal opens to, and nothing else', async () => {
    const result = await startDailyAttempt(UID, DATE, SALT, middayOf(ACTIVATES_AT));
    const doc = await board();

    // The seam that makes this a real assertion rather than "60 strings came
    // back": the sequence is opened independently, from the sealed blob in the
    // published document under the key generation derived, and must be the very
    // same list. A callable that invented, reordered or truncated a sequence
    // fails here.
    expect(result.sequence).toStrictEqual(
      openSequenceWithKey(keyFor(doc), doc.engineConfig.pieceSequence),
    );
    expect(result.sequence).toHaveLength(PIECE_COUNT);
    expect(doc.engineConfig.pieceCount).toBe(PIECE_COUNT);

    // §16: the salt never leaves the server, and neither does anything it can be
    // derived from — including the key itself. The response is exactly the
    // three specced fields.
    expect(Object.keys(result).sort()).toStrictEqual(['date', 'sequence', 'startedAt']);
    const wire = JSON.stringify(result);
    expect(wire).not.toContain(SALT);
    expect(wire).not.toContain(keyFor(doc).toString('base64'));
    expect(wire).not.toContain(doc.engineConfig.pieceSequence.ct);
  });

  it("hands out this day's sequence, not another day's", async () => {
    await publishDailyBoard('2026-08-10', SALT, '2026-08-09T23:45:00.000Z');
    const today = await startDailyAttempt(UID, DATE, SALT, middayOf(ACTIVATES_AT));
    const tomorrow = await startDailyAttempt(
      UID,
      '2026-08-10',
      SALT,
      middayOf(Date.UTC(2026, 7, 10)),
    );
    expect(tomorrow.sequence).not.toStrictEqual(today.sequence);

    // And the two seals stay independent (§8.2 v1.14): one day's key is useless
    // against another day's blob, which is what the two-HMAC derivation buys.
    const doc = await board();
    const tomorrowKey = keyFor(await board('2026-08-10'));
    expect(() => openSequenceWithKey(tomorrowKey, doc.engineConfig.pieceSequence)).toThrow();
  });
});

describe('§8.3 one attempt means one', () => {
  it('records the attempt as consumed', async () => {
    await startDailyAttempt(UID, DATE, SALT, middayOf(ACTIVATES_AT));
    const doc = await attemptRef().get();
    expect(doc.exists).toBe(true);
    expect(doc.get('status')).toBe('started');
    expect(doc.get('date')).toBe(DATE);
    expect(typeof doc.get('startedAt')).toBe('string');
  });

  it('refuses a second call — an app kill and relaunch does not mint a new attempt', async () => {
    await startDailyAttempt(UID, DATE, SALT, middayOf(ACTIVATES_AT));
    await expect(
      startDailyAttempt(UID, DATE, SALT, middayOf(ACTIVATES_AT) + 60_000),
    ).rejects.toMatchObject({ details: { reason: 'attempt-consumed' } });
  });

  it('refuses concurrent calls too — only one of them gets a key', async () => {
    // The read-then-write version of this function passes every test above and
    // fails this one: both calls would see "not started".
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => startDailyAttempt(UID, DATE, SALT, middayOf(ACTIVATES_AT))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it("is per-user: one player's attempt does not spend another's", async () => {
    await startDailyAttempt(UID, DATE, SALT, middayOf(ACTIVATES_AT));
    await expect(
      startDailyAttempt('bob', DATE, SALT, middayOf(ACTIVATES_AT)),
    ).resolves.toMatchObject({ date: DATE });
  });
});

describe('§8.3 / §8.8 the board boundary is server time', () => {
  it('refuses the board before its activatesAt', async () => {
    // 23:45 UTC on D-1: the document exists (§8.2 v1.12 pre-generation) but the
    // board is not live.
    await expect(
      startDailyAttempt(UID, DATE, SALT, ACTIVATES_AT - 15 * 60_000),
    ).rejects.toMatchObject({ details: { reason: 'not-yet-live' } });
  });

  it('does NOT consume the attempt when it refuses', async () => {
    await expect(startDailyAttempt(UID, DATE, SALT, ACTIVATES_AT - 1)).rejects.toThrow();
    expect((await attemptRef().get()).exists).toBe(false);
    // …and the player can still play once the board goes live.
    await expect(startDailyAttempt(UID, DATE, SALT, ACTIVATES_AT)).resolves.toMatchObject({
      date: DATE,
    });
  });

  it('flips to allowed at exactly activatesAt', async () => {
    await expect(startDailyAttempt(UID, DATE, SALT, ACTIVATES_AT - 1)).rejects.toThrow();
    await expect(startDailyAttempt(UID, DATE, SALT, ACTIVATES_AT)).resolves.toMatchObject({
      date: DATE,
    });
  });

  it('refuses the board after its UTC day has closed (§8.1 one board per day)', async () => {
    await expect(startDailyAttempt(UID, DATE, SALT, ACTIVATES_AT + DAY_MS)).rejects.toMatchObject({
      details: { reason: 'closed' },
    });
  });

  it('is unmoved by a device clock skewed ±3h (§8.8)', async () => {
    // A device running 3h FAST at 21:30 UTC on D believes it is D+1 and asks for
    // D+1's board. The document exists — it was pre-generated at 23:45 on D-1's
    // schedule — and server time refuses it anyway.
    await publishDailyBoard('2026-08-10', SALT, '2026-08-09T23:45:00.000Z');
    const serverNow = ACTIVATES_AT + 21.5 * 3_600_000;
    await expect(startDailyAttempt(UID, '2026-08-10', SALT, serverNow)).rejects.toMatchObject({
      details: { reason: 'not-yet-live' },
    });
    // Same instant, the correct date: allowed.
    await expect(startDailyAttempt(UID, DATE, SALT, serverNow)).resolves.toMatchObject({
      date: DATE,
    });

    // A device running 3h SLOW at 00:30 UTC on D+1 believes it is still D and
    // asks for D's board, which has closed.
    await expect(
      startDailyAttempt('bob', DATE, SALT, ACTIVATES_AT + DAY_MS + 30 * 60_000),
    ).rejects.toMatchObject({ details: { reason: 'closed' } });
  });
});

describe('§8.3 malformed input', () => {
  it('rejects a date that is not YYYY-MM-DD', async () => {
    for (const bad of ['', 'tomorrow', '2026-8-9', '2026-08-09T00:00:00Z']) {
      await expect(startDailyAttempt(UID, bad, SALT, Date.now())).rejects.toThrow();
    }
  });

  it('reports an unpublished board distinctly from a sealed one', async () => {
    await expect(
      startDailyAttempt(UID, '2026-08-11', SALT, Date.UTC(2026, 7, 11, 12)),
    ).rejects.toMatchObject({ details: { reason: 'not-published' } });
  });

  it('fails as internal — never as a player error — on a corrupt board document', async () => {
    await getFirestore()
      .collection(DAILY_BOARDS_COLLECTION)
      .doc('2026-08-12')
      .set({ date: '2026-08-12', activatesAt: Date.UTC(2026, 7, 12) });
    await expect(
      startDailyAttempt(UID, '2026-08-12', SALT, Date.UTC(2026, 7, 12, 12)),
    ).rejects.toMatchObject({ code: 'internal' });
  });
});
