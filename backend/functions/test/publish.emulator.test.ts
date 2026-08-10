/**
 * §8.2 publication against the Firestore emulator.
 *
 * Not part of the default `test` script — CI runs it under
 * `firebase emulators:exec --only firestore` (see `.github/workflows/ci.yml`).
 * Remote Config is mocked rather than emulated: there is no RC emulator, and its
 * validation is covered in `publish.test.ts`. Firestore is real, because the two
 * properties worth proving here are Firestore's: the document actually lands,
 * and `create()` really does refuse to overwrite it.
 */

import {
  parseDailyBoardDoc,
  DAILY_BOARDS_COLLECTION,
  ENGINE_VERSION,
  REMOTE_CONFIG_DEFAULTS,
} from '@blockmanor/shared';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getNumber: vi.fn<(key: string) => number>() }));

vi.mock('firebase-admin/remote-config', () => ({
  getRemoteConfig: () => ({
    getServerTemplate: async () => ({ evaluate: () => ({ getNumber: mocks.getNumber }) }),
  }),
}));

const { OPS_ALERTS_COLLECTION, SOLVABILITY_ALERT, publishDailyBoard } =
  await import('../src/daily/publish');
const { openSequence, attemptSeed, dailySeed } = await import('../src/daily/seal');

const SALT = 'test-salt-not-the-real-one';
const DATE = '2026-08-09';
/** The §13 default, so the solvability gate passes on the first roll. */
const PIECE_COUNT = 60;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is unset — run via `firebase emulators:exec --only firestore`',
    );
  }
  if (getApps().length === 0) initializeApp({ projectId: 'demo-blockmanor' });
});

/** The §13 defaults, restored per test — several tests move Remote Config. */
function liveDefaults(): void {
  mocks.getNumber.mockImplementation((key) => {
    if (key === 'daily_piece_count') return PIECE_COUNT;
    const fallback = REMOTE_CONFIG_DEFAULTS[key as keyof typeof REMOTE_CONFIG_DEFAULTS];
    return typeof fallback === 'number' ? fallback : 0;
  });
}

// Cleaning BEFORE rather than after: the emulator is shared with
// `rules.emulator.test.ts`, which seeds a `dailyBoards` document of its own, and
// `create()` cannot tell a leftover fixture from a real prior publication.
beforeEach(async () => {
  liveDefaults();
  await getFirestore().recursiveDelete(getFirestore().collection(DAILY_BOARDS_COLLECTION));
  await getFirestore().recursiveDelete(getFirestore().collection(OPS_ALERTS_COLLECTION));
});

describe('§8.2 publication', () => {
  it('writes dailyBoards/{date} with the sealed sequence and frozen snapshot', async () => {
    const published = await publishDailyBoard(DATE, SALT, `${DATE}T00:00:00.000Z`);
    expect(published.status).toBe('created');

    const snap = await getFirestore().collection(DAILY_BOARDS_COLLECTION).doc(DATE).get();
    expect(snap.exists).toBe(true);

    // Round-tripped through Firestore, then through the §4.2 fetch schema —
    // exactly what §8.3's client and §8.5's callable will do.
    const stored = parseDailyBoardDoc(snap.data());
    expect(stored.date).toBe(DATE);
    expect(stored.engineConfig.pieceCount).toBe(PIECE_COUNT);
    // v1.12: the two fields the publication boundary and §8.5 depend on survive
    // the Firestore round trip as the types the rules and the callable expect.
    expect(stored.engineVersion).toBe(ENGINE_VERSION);
    expect(stored.activatesAt).toBe(Date.UTC(2026, 7, 9));
    expect(typeof snap.get('activatesAt')).toBe('number');
    expect(stored.engineConfig.pieceSequence.alg).toBe('AES-256-GCM');
    expect(stored.configSource.daily_piece_count).toBe('live');

    // The plaintext sequence must NOT be recoverable from the stored bytes…
    const sequence = openSequence(
      attemptSeed(dailySeed(SALT, stored.date), stored.revision),
      stored.engineConfig.pieceSequence,
    );
    expect(sequence).toHaveLength(PIECE_COUNT);
    expect(JSON.stringify(snap.data())).not.toContain(sequence.join(''));
    expect(JSON.stringify(snap.data())).not.toContain(SALT);
  });

  it('is idempotent: a scheduler retry leaves the first document untouched', async () => {
    await publishDailyBoard(DATE, SALT, `${DATE}T00:00:00.000Z`);
    const first = (await getFirestore().collection(DAILY_BOARDS_COLLECTION).doc(DATE).get()).data();

    // Remote Config changes between the two runs — determinism alone would NOT
    // have covered this, only `create()` refusing to overwrite does. Swapping
    // the board out from under a mid-day player is the failure being prevented.
    mocks.getNumber.mockImplementation((key) => (key === 'daily_piece_count' ? 8 : 1));
    const retry = await publishDailyBoard(DATE, SALT, `${DATE}T00:05:00.000Z`);
    expect(retry.status).toBe('exists');

    const second = (
      await getFirestore().collection(DAILY_BOARDS_COLLECTION).doc(DATE).get()
    ).data();
    expect(second).toStrictEqual(first);
    expect((second as { engineConfig: { pieceCount: number } }).engineConfig.pieceCount).toBe(
      PIECE_COUNT,
    );
  });
});

describe('§8.2 solvability exhausted (PRD v1.12)', () => {
  it('publishes the best board anyway AND raises a durable ops alert', async () => {
    // A 1-piece sequence can never reach 15 placements, so every roll fails.
    mocks.getNumber.mockImplementation((key) => (key === 'daily_piece_count' ? 1 : 5));
    const published = await publishDailyBoard(DATE, SALT, `${DATE}T00:00:00.000Z`);

    // §8.1: a board still ships. A missing document breaks every client for 24h.
    expect(published.status).toBe('created');
    expect(published.doc?.solvability.passed).toBe(false);
    const board = await getFirestore().collection(DAILY_BOARDS_COLLECTION).doc(DATE).get();
    expect(board.exists).toBe(true);

    // …and it is not a bare log line: the alert is a document an operator can
    // query long after the logs have aged out.
    const alert = await getFirestore()
      .collection(OPS_ALERTS_COLLECTION)
      .doc(`${DATE}_${SOLVABILITY_ALERT}`)
      .get();
    expect(alert.exists).toBe(true);
    expect(alert.get('kind')).toBe(SOLVABILITY_ALERT);
    expect(alert.get('date')).toBe(DATE);
    expect(alert.get('rerollCap')).toBe(5);
    // Every roll's median, so the operator can see how far off the day was.
    expect(alert.get('medians')).toHaveLength(6);
    expect(alert.get('publishedMedian')).toBe(Math.max(...(alert.get('medians') as number[])));
    expect(typeof alert.get('raisedAt')).toBe('string');
  });

  it('raises no alert when the gate passes', async () => {
    await publishDailyBoard(DATE, SALT, `${DATE}T00:00:00.000Z`);
    const alerts = await getFirestore().collection(OPS_ALERTS_COLLECTION).get();
    expect(alerts.empty).toBe(true);
  });
});
