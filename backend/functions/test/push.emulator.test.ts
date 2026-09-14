/**
 * §8.7 push against the Firestore emulator (PRD §0 v1.32): registration is
 * validated and stored server-side, and one scan targets exactly the right
 * players, respects their preferences, emits `daily_missed`, and forgets dead
 * tokens. FCM itself is injected — nothing leaves the machine.
 */
import { DAILY_ATTEMPTS_SUBCOLLECTION, USERS_COLLECTION } from '@blockmanor/shared';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPushForUser, runPushScan, type PushMessage } from '../src/push/push';

const db = () => getFirestore();
const users = () => db().collection(USERS_COLLECTION);
const IST = 330;
/** 02:30 UTC = 08:00 IST (daily drop); 14:30 UTC = 20:00 IST (streak risk). */
const DROP_AT = Date.parse('2026-08-09T02:30:00Z');
const RISK_AT = Date.parse('2026-08-09T14:30:00Z');
const TODAY = '2026-08-09';
const YESTERDAY = '2026-08-08';
const HOUR = 8;

const reg = (over: Record<string, unknown> = {}) => ({
  token: 'tok-alice',
  utcOffsetMinutes: IST,
  dailyDrop: true,
  streakRisk: true,
  ...over,
});

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is unset');
  if (getApps().length === 0) initializeApp({ projectId: 'demo-blockmanor' });
});

beforeEach(async () => {
  await db().recursiveDelete(users());
});

describe('§0 v1.32(a) registerPushForUser', () => {
  it('stores a valid registration under users/{uid}.push', async () => {
    await registerPushForUser('alice', reg(), DROP_AT);
    expect((await users().doc('alice').get()).get('push')).toMatchObject(reg());
  });

  it.each([
    ['a non-quarter-hour offset', { utcOffsetMinutes: 331 }],
    ['an offset past +14:00', { utcOffsetMinutes: 855 }],
    ['an empty token', { token: '' }],
    ['a missing preference', { dailyDrop: undefined }],
  ])('refuses %s and writes nothing', async (_name, over) => {
    await expect(registerPushForUser('alice', reg(over), DROP_AT)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect((await users().doc('alice').get()).exists).toBe(false);
  });
});

describe('§0 v1.32(b,c) runPushScan', () => {
  const sender = (invalid: string[] = []) => {
    const sent: PushMessage[] = [];
    const send = vi.fn(async (messages: PushMessage[]) => {
      sent.push(...messages);
      return invalid;
    });
    return { sent, send };
  };

  it('sends the daily drop only to opted-in players whose clock reads daily_push_hour', async () => {
    await users().doc('alice').set({ streak: 4, push: reg() });
    await users()
      .doc('bob')
      .set({ push: reg({ token: 'tok-bob', dailyDrop: false }) });
    await users()
      .doc('utc')
      .set({ push: reg({ token: 'tok-utc', utcOffsetMinutes: 0 }) });
    const { sent, send } = sender();
    await expect(runPushScan(DROP_AT, HOUR, send)).resolves.toMatchObject({ sent: 1 });
    expect(sent).toStrictEqual([
      {
        token: 'tok-alice',
        kind: 'daily_drop',
        title: "Today's board is live",
        body: '🔥 Keep your 4-day streak',
      },
    ]);
  });

  it('streak-risk: alive streak + today unplayed → push and daily_missed; played or broken → nothing', async () => {
    const { logger } = await import('firebase-functions/v2');
    const info = vi.spyOn(logger, 'info');
    try {
      await users()
        .doc('atrisk')
        .set({ streak: 6, lastStreakDate: YESTERDAY, push: reg({ token: 'tok-risk' }) });
      await users()
        .doc('played')
        .set({ streak: 7, lastStreakDate: TODAY, push: reg({ token: 'tok-played' }) });
      await users()
        .doc('played')
        .collection(DAILY_ATTEMPTS_SUBCOLLECTION)
        .doc(TODAY)
        .set({ status: 'submitted' });
      await users()
        .doc('broken')
        .set({ streak: 9, lastStreakDate: '2026-08-01', push: reg({ token: 'tok-broken' }) });
      await users()
        .doc('noprefs')
        .set({
          streak: 3,
          lastStreakDate: YESTERDAY,
          push: reg({ token: 'tok-quiet', streakRisk: false }),
        });

      const { sent, send } = sender();
      await expect(runPushScan(RISK_AT, HOUR, send)).resolves.toMatchObject({ sent: 1, missed: 2 });
      expect(sent.map((m) => [m.token, m.kind])).toStrictEqual([['tok-risk', 'streak_risk']]);
      const missed = info.mock.calls.filter(([msg]) => msg === 'daily_missed').map(([, p]) => p);
      expect(missed).toStrictEqual([
        { uid: 'atrisk', date: TODAY, streak: 6 },
        { uid: 'noprefs', date: TODAY, streak: 3 },
      ]);
    } finally {
      info.mockRestore();
    }
  });

  it('forgets a token FCM reports as unregistered (§0 v1.32(f))', async () => {
    await users().doc('alice').set({ streak: 1, push: reg() });
    const { send } = sender(['tok-alice']);
    await expect(runPushScan(DROP_AT, HOUR, send)).resolves.toMatchObject({ sent: 0, removed: 1 });
    const alice = await users().doc('alice').get();
    expect(alice.get('push')).toBeUndefined();
    expect(alice.get('streak')).toBe(1);
  });

  it('sends nothing (and never calls FCM) when nobody is due', async () => {
    await users().doc('alice').set({ push: reg() });
    const { send } = sender();
    await runPushScan(Date.parse('2026-08-09T09:00:00Z'), HOUR, send);
    expect(send).not.toHaveBeenCalled();
  });
});
