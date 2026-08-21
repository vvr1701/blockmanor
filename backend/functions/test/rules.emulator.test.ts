/**
 * `backend/firestore.rules`, executed — PRD §4.4, §8.2, §8.5.
 *
 * These run against the Firestore emulator, so they are NOT part of the default
 * `test` script (no JRE, no Firebase CLI on a plain dev box). CI runs them:
 *   firebase emulators:exec --only firestore --project demo-blockmanor \
 *     "pnpm --filter @blockmanor/functions test:emulator"
 * `emulators:exec` exports FIRESTORE_EMULATOR_HOST, which is how the SDK below
 * finds the emulator; the rules file is read straight off disk here so the test
 * exercises the exact artifact `firebase deploy` ships.
 *
 * The shape being defended: DENY by default, and no client write anywhere. Every
 * server-authoritative collection (dailyBoards, streak, wallet, leaderboards)
 * mutates only through Cloud Functions, which use the Admin SDK and bypass rules
 * entirely — so there is nothing to "allow" for writes at any stage.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const DATE = '2026-08-09';
/** Day D+1, pre-generated at D-1 23:45 UTC and not live yet (§8.2 v1.12). */
const TOMORROW = '2999-01-01';
const activatesAt = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    // `demo-` prefixed ids are emulator-only: the SDK will never reach a real
    // project, so this test cannot touch production even if misconfigured.
    projectId: 'demo-blockmanor',
    firestore: {
      rules: readFileSync(fileURLToPath(new URL('../../firestore.rules', import.meta.url)), 'utf8'),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed the documents a client would try to read. Rules are off for the seed,
  // which is exactly how the Admin SDK writes in production.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'dailyBoards', DATE), {
      date: DATE,
      generatorVersion: 1,
      activatesAt: activatesAt(DATE),
    });
    // The document ruling 3 creates: tomorrow's board, published early, sealed.
    await setDoc(doc(db, 'dailyBoards', TOMORROW), {
      date: TOMORROW,
      generatorVersion: 1,
      activatesAt: activatesAt(TOMORROW),
      solvability: { medianMoves: 31 },
    });
    // A pre-v1.12 document, i.e. one with no `activatesAt` at all.
    await setDoc(doc(db, 'dailyBoards', '2026-01-01'), { date: '2026-01-01' });
    await setDoc(doc(db, 'users', 'alice'), { streak: 3 });
    await setDoc(doc(db, 'users', 'bob'), { streak: 99 });
    await setDoc(doc(db, 'users', 'alice', 'submissions', DATE), { score: 1200 });
    await setDoc(doc(db, 'leaderboards', DATE), { p50: 900 });
  });
});

describe('§8.2 dailyBoards/{date}', () => {
  it('denies an unauthenticated read', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'dailyBoards', DATE)));
  });

  it('allows a signed-in player to read an ACTIVATED board', async () => {
    // §4.3 anonymous auth, and server time is past this board's `activatesAt`.
    const db = env.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(db, 'dailyBoards', DATE)));
  });

  it('denies reading a board before its activatesAt (§8.2 v1.12)', async () => {
    // The exposure ruling 3 creates: generation moved to D-1 23:45 UTC, so
    // tomorrow's document EXISTS today. Its prefill and solvability median are
    // in the clear, so "the sequence is encrypted anyway" is not a defence —
    // the rule is what stops a player seeing tomorrow's board a day early.
    for (const ctx of [env.authenticatedContext('alice'), env.unauthenticatedContext()]) {
      await assertFails(getDoc(doc(ctx.firestore(), 'dailyBoards', TOMORROW)));
    }
  });

  it('fails closed on a document with no activatesAt', async () => {
    // An older generator, or a corrupt write: the comparison errors, so it
    // denies. Never the other way round.
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(db, 'dailyBoards', '2026-01-01')));
  });

  it('flips to allowed the moment server time passes activatesAt', async () => {
    // Same document, same reader: only `activatesAt` moves. This is what proves
    // the gate is the boundary itself and not some other clause of the rule.
    const db = env.authenticatedContext('alice').firestore();
    const soon = doc(db, 'dailyBoards', '2030-06-01');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'dailyBoards', '2030-06-01'), {
        date: '2030-06-01',
        activatesAt: Date.now() + 60_000,
      });
    });
    await assertFails(getDoc(soon));

    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'dailyBoards', '2030-06-01'), {
        date: '2030-06-01',
        activatesAt: Date.now() - 60_000,
      });
    });
    await assertSucceeds(getDoc(soon));
  });

  it('reads server time, not the caller (§8.8 device clock is never trusted)', async () => {
    // `request.time` is the emulator's clock. A client cannot supply it, which
    // is the whole reason the boundary is enforced here rather than in the app.
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(db, 'dailyBoards', TOMORROW)));
    await assertSucceeds(getDoc(doc(db, 'dailyBoards', DATE)));
  });

  it('denies every client write — create, update and delete', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'dailyBoards', '2026-08-10'), { date: '2026-08-10' }));
    await assertFails(updateDoc(doc(db, 'dailyBoards', DATE), { generatorVersion: 999 }));
    await assertFails(deleteDoc(doc(db, 'dailyBoards', DATE)));
  });

  it('denies writes to an unauthenticated client too', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'dailyBoards', '2026-08-11'), { date: '2026-08-11' }));
  });
});

describe('§4.4 users/{uid}', () => {
  it('allows a player to read their own document', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(db, 'users', 'alice')));
  });

  it("denies reading another player's document", async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(db, 'users', 'bob')));
  });

  it('denies an unauthenticated read', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users', 'alice')));
  });

  it('denies a player writing their own document (§8.6 streak is server-authoritative)', async () => {
    // The §8.8 acceptance criterion in rule form: a skewed device clock cannot
    // buy a streak, because the client cannot write the streak at all.
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { streak: 1000 }));
    await assertFails(deleteDoc(doc(db, 'users', 'alice')));
  });

  it('extends both rules to subcollections', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(alice, 'users', 'alice', 'submissions', DATE)));
    await assertFails(setDoc(doc(alice, 'users', 'alice', 'submissions', DATE), { score: 99999 }));

    const bob = env.authenticatedContext('bob').firestore();
    await assertFails(getDoc(doc(bob, 'users', 'alice', 'submissions', DATE)));
  });
});

describe('deny-all catch-all', () => {
  it('closes every unlisted collection, signed in or not', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    const anon = env.unauthenticatedContext().firestore();
    // A collection a future stage will add before its rules are written.
    for (const db of [alice, anon]) {
      await assertFails(getDoc(doc(db, 'leaderboards', DATE)));
      await assertFails(setDoc(doc(db, 'leaderboards', DATE), { p50: 0 }));
      await assertFails(getDoc(doc(db, 'wallet', 'alice')));
      await assertFails(setDoc(doc(db, 'wallet', 'alice'), { coins: 1_000_000 }));
      // §8.2 v1.12 ops alerts: written by Functions, never read by a client.
      await assertFails(getDoc(doc(db, 'opsAlerts', `${DATE}_daily_solvability_exhausted`)));
      await assertFails(setDoc(doc(db, 'opsAlerts', 'forged'), { kind: 'nope' }));
    }
  });
});
