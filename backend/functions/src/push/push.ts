/**
 * §8.7 push (PRD §0 v1.32): opt-in registration, and the 15-minute scan that
 * delivers (a) the daily drop at `daily_push_hour` local and (b) the 20:00-local
 * streak-risk nudge, which also emits `daily_missed` (§0 v1.22(d)).
 *
 * "Nothing else in Stage 1": these two messages are the whole surface.
 */

import {
  DAILY_ATTEMPTS_SUBCOLLECTION,
  REMOTE_CONFIG_DEFAULTS,
  USERS_COLLECTION,
  isWithinBounds,
} from '@blockmanor/shared';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { previousUtcDate } from '../daily/streak';

const DAY_MINUTES = 24 * 60;
/** Real UTC offsets run from −12:00 to +14:00, all whole quarter hours. */
const MIN_OFFSET = -12 * 60;
const MAX_OFFSET = 14 * 60;
export const SCAN_STEP_MINUTES = 15;
/** §8.7(b): "streak-risk at 20:00 local". */
export const STREAK_RISK_LOCAL_MINUTE = 20 * 60;

export interface PushRegistration {
  token: string;
  utcOffsetMinutes: number;
  dailyDrop: boolean;
  streakRisk: boolean;
}

/** Trust boundary: the callable's payload is whatever a client sent. */
export function parseRegistration(input: unknown): PushRegistration | null {
  if (typeof input !== 'object' || input === null) return null;
  const { token, utcOffsetMinutes, dailyDrop, streakRisk } = input as Record<string, unknown>;
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
  if (
    typeof utcOffsetMinutes !== 'number' ||
    !Number.isInteger(utcOffsetMinutes) ||
    utcOffsetMinutes < MIN_OFFSET ||
    utcOffsetMinutes > MAX_OFFSET ||
    utcOffsetMinutes % SCAN_STEP_MINUTES !== 0
  ) {
    return null;
  }
  if (typeof dailyDrop !== 'boolean' || typeof streakRisk !== 'boolean') return null;
  return { token, utcOffsetMinutes, dailyDrop, streakRisk };
}

/** §0 v1.32(a): stored under `users/{uid}.push`, server-written only. */
export async function registerPushForUser(uid: string, input: unknown, now: number): Promise<void> {
  const parsed = parseRegistration(input);
  if (!parsed) throw new HttpsError('invalid-argument', 'Malformed push registration');
  await getFirestore()
    .collection(USERS_COLLECTION)
    .doc(uid)
    .set({ push: { ...parsed, updatedAt: new Date(now).toISOString() } }, { merge: true });
}

export const registerPush = onCall<unknown>(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign-in required');
  if (getApps().length === 0) initializeApp();
  await registerPushForUser(request.auth.uid, request.data, Date.now());
  return { ok: true };
});

/**
 * §0 v1.32(b): every real UTC offset whose local clock reads `localMinute` at
 * this scan's quarter hour. Usually one; two when both ends of the range apply
 * (+14:00 and −10:00 share a clock a day apart), so neither is skipped.
 */
export function offsetsForLocalMinute(utcMs: number, localMinute: number): number[] {
  const utcMinute = Math.floor(utcMs / 60_000) % DAY_MINUTES;
  const bucket = utcMinute - (utcMinute % SCAN_STEP_MINUTES);
  const base = (((localMinute - bucket) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return [base, base - DAY_MINUTES].filter((o) => o >= MIN_OFFSET && o <= MAX_OFFSET);
}

export interface PushMessage {
  token: string;
  kind: 'daily_drop' | 'streak_risk';
  title: string;
  body: string;
}

/** Sends, returning the tokens FCM reports as no longer registered. */
export type PushSender = (messages: PushMessage[]) => Promise<string[]>;

const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// ponytail: English only — Stage 1 ships `en` (§11.4 localization is S3).
const dailyDropMessage = (token: string, streak: number): PushMessage => ({
  token,
  kind: 'daily_drop',
  title: "Today's board is live",
  body: streak > 0 ? `🔥 Keep your ${streak}-day streak` : 'One board. Everyone. Play it now.',
});

const streakRiskMessage = (token: string, streak: number): PushMessage => ({
  token,
  kind: 'streak_risk',
  title: `Your ${streak}-day streak is at risk`,
  body: "Today's board is still unplayed.",
});

export interface PushScanResult {
  sent: number;
  missed: number;
  removed: number;
}

/**
 * One quarter-hour scan. `dailyPushHour` is read by the caller (live Remote
 * Config) so this stays testable with a plain number.
 */
export async function runPushScan(
  now: number,
  dailyPushHour: number,
  send: PushSender,
): Promise<PushScanResult> {
  const db = getFirestore();
  const users = db.collection(USERS_COLLECTION);
  const messages: PushMessage[] = [];
  const ownerOfToken = new Map<string, string>();
  let missed = 0;

  const dropOffsets = offsetsForLocalMinute(now, dailyPushHour * 60);
  if (dropOffsets.length > 0) {
    const snap = await users.where('push.utcOffsetMinutes', 'in', dropOffsets).get();
    for (const doc of snap.docs) {
      const push = doc.get('push') as PushRegistration | undefined;
      if (!push?.dailyDrop) continue;
      const streak = typeof doc.get('streak') === 'number' ? (doc.get('streak') as number) : 0;
      messages.push(dailyDropMessage(push.token, streak));
      ownerOfToken.set(push.token, doc.id);
    }
  }

  const riskOffsets = offsetsForLocalMinute(now, STREAK_RISK_LOCAL_MINUTE);
  if (riskOffsets.length > 0) {
    const today = utcDate(now);
    const snap = await users.where('push.utcOffsetMinutes', 'in', riskOffsets).get();
    for (const doc of snap.docs) {
      const push = doc.get('push') as PushRegistration | undefined;
      const streak = typeof doc.get('streak') === 'number' ? (doc.get('streak') as number) : 0;
      // At risk = alive (credited yesterday) and today not yet submitted. A
      // streak whose last credit is older is already broken, not at risk.
      if (streak <= 0 || doc.get('lastStreakDate') !== previousUtcDate(today)) continue;
      const attempt = await doc.ref.collection(DAILY_ATTEMPTS_SUBCOLLECTION).doc(today).get();
      if (attempt.get('status') === 'submitted') continue;
      logger.info('daily_missed', { uid: doc.id, date: today, streak });
      missed += 1;
      if (!push?.streakRisk) continue;
      messages.push(streakRiskMessage(push.token, streak));
      ownerOfToken.set(push.token, doc.id);
    }
  }

  const invalid = messages.length > 0 ? await send(messages) : [];
  await Promise.all(
    invalid.flatMap((token) => {
      const uid = ownerOfToken.get(token);
      return uid ? [users.doc(uid).update({ push: FieldValue.delete() })] : [];
    }),
  );
  return { sent: messages.length - invalid.length, missed, removed: invalid.length };
}

/** FCM batch send; `route: daily` deep-links every push to the Daily gate (§8.7). */
export const fcmSender: PushSender = async (messages) => {
  const response = await getMessaging().sendEach(
    messages.map((m) => ({
      token: m.token,
      notification: { title: m.title, body: m.body },
      data: { route: 'daily', kind: m.kind },
    })),
  );
  return response.responses.flatMap((r, i) =>
    r.error?.code === 'messaging/registration-token-not-registered' ? [messages[i]!.token] : [],
  );
};

/** §13 `daily_push_hour [RC, 8]`, live, bounds-checked; never throws. */
export async function dailyPushHour(): Promise<number> {
  const fallback = REMOTE_CONFIG_DEFAULTS.daily_push_hour;
  try {
    const template = await getRemoteConfig().getServerTemplate({
      defaultConfig: { daily_push_hour: fallback },
    });
    const value = template.evaluate().getValue('daily_push_hour');
    if (value.getSource() !== 'remote') return fallback;
    const n = value.asNumber();
    return isWithinBounds('daily_push_hour', n) ? n : fallback;
  } catch (error) {
    logger.warn('push_scan: Remote Config unreadable, using §13 default', { error });
    return fallback;
  }
}

export const sendPushScheduled = onSchedule(
  { schedule: '*/15 * * * *', timeZone: 'UTC', timeoutSeconds: 300, retryCount: 0 },
  async (event) => {
    if (getApps().length === 0) initializeApp();
    const now = event.scheduleTime ? Date.parse(event.scheduleTime) : Date.now();
    const result = await runPushScan(now, await dailyPushHour(), fcmSender);
    logger.info('push_scan: done', { ...result });
  },
);
