/**
 * The 00:00 UTC scheduled publisher — PRD §8.2.
 *
 * Everything impure lives here: the secret, the clock, Remote Config, Firestore.
 * `generate.ts` holds the rules and is pure.
 *
 * Remote Config is read EXACTLY ONCE, here, to build the frozen snapshot
 * (§8.2 / PRD v1.7). No other file in the daily path may import Remote Config —
 * that is the whole point of the snapshot.
 */

import { REMOTE_CONFIG_DEFAULTS, type RemoteConfigKey } from '@blockmanor/shared';
import { type EngineTuning } from '@blockmanor/engine';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { generateDailyBoard, type DailyBoardDoc } from './generate';
import { dailySeed } from './seal';

/**
 * §16: "Daily-board salt only in Functions config." Provisioned with
 * `firebase functions:secrets:set DAILY_BOARD_SALT` (Secret Manager). It is
 * never in the repo, never in `.env`, and never in a client bundle — nothing
 * under `apps/mobile` can reach it.
 */
export const DAILY_BOARD_SALT = defineSecret('DAILY_BOARD_SALT');

export const DAILY_BOARDS_COLLECTION = 'dailyBoards';

/** The five §13 engine keys, plus `daily_piece_count`, frozen into the snapshot. */
const TUNING_KEYS = [
  'mercy_threshold',
  'mercy_small_prob',
  'score_clear_base',
  'combo_step',
  'perfect_clear_bonus',
] as const satisfies readonly RemoteConfigKey[];

export interface FrozenRemoteConfig {
  tuning: EngineTuning;
  pieceCount: number;
  /** False when the live template could not be read and defaults were frozen instead. */
  live: boolean;
}

/**
 * Read Remote Config once. Defaults come from the §13 registry in
 * `packages/shared` — never a literal at this call site (CLAUDE.md rule 3).
 *
 * A fetch failure freezes the registry defaults rather than aborting: the
 * resulting board is internally consistent, which is all §8.5 needs, and no
 * board at all would break the ritual for 24h (§8.1).
 */
export async function readFrozenRemoteConfig(): Promise<FrozenRemoteConfig> {
  const fallback = (): FrozenRemoteConfig => ({
    tuning: {
      mercy_threshold: REMOTE_CONFIG_DEFAULTS.mercy_threshold,
      mercy_small_prob: REMOTE_CONFIG_DEFAULTS.mercy_small_prob,
      score_clear_base: REMOTE_CONFIG_DEFAULTS.score_clear_base,
      combo_step: REMOTE_CONFIG_DEFAULTS.combo_step,
      perfect_clear_bonus: REMOTE_CONFIG_DEFAULTS.perfect_clear_bonus,
    },
    pieceCount: REMOTE_CONFIG_DEFAULTS.daily_piece_count,
    live: false,
  });

  try {
    const template = await getRemoteConfig().getServerTemplate({
      defaultConfig: { ...REMOTE_CONFIG_DEFAULTS },
    });
    const config = template.evaluate();
    const tuning = Object.fromEntries(
      TUNING_KEYS.map((key) => [key, config.getNumber(key)]),
    ) as unknown as EngineTuning;
    return { tuning, pieceCount: config.getNumber('daily_piece_count'), live: true };
  } catch (error) {
    logger.warn('daily_generation: Remote Config unreadable, freezing §13 defaults', { error });
    return fallback();
  }
}

/** The UTC calendar day of an ISO instant — §8.2 keys boards by UTC date. */
export const utcDate = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

type AlreadyExists = { code?: number | string };
const isAlreadyExists = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  // Firestore/gRPC ALREADY_EXISTS.
  ((error as AlreadyExists).code === 6 || (error as AlreadyExists).code === 'already-exists');

export interface PublishResult {
  status: 'created' | 'exists';
  doc?: DailyBoardDoc;
}

/**
 * Generate and publish one day's board. Idempotent by construction: `create()`
 * refuses to overwrite, so a scheduler retry (or a manual re-run) can never
 * swap the board out from under a player mid-day. Determinism alone is not
 * enough for that guarantee — a Remote Config push between the two runs would
 * otherwise produce a different frozen snapshot for the same date.
 */
export async function publishDailyBoard(
  date: string,
  secretSalt: string,
  generatedAt: string,
): Promise<PublishResult> {
  const { tuning, pieceCount, live } = await readFrozenRemoteConfig();
  const { doc, attempts } = generateDailyBoard({
    date,
    seed: dailySeed(secretSalt, date),
    tuning,
    pieceCount,
    generatedAt,
  });

  if (!doc.solvability.passed) {
    // §8.2 specifies one re-roll and is silent on what follows. Publishing the
    // hard board beats publishing nothing; this line is the operator's cue.
    logger.error('daily_generation: solvability gate failed after re-roll', {
      date,
      attempts,
    });
  }

  try {
    await getFirestore().collection(DAILY_BOARDS_COLLECTION).doc(date).create(doc);
  } catch (error) {
    if (isAlreadyExists(error)) {
      logger.info('daily_generation: board already published, leaving it alone', { date });
      return { status: 'exists' };
    }
    throw error;
  }

  logger.info('daily_generation: published', {
    date,
    revision: doc.revision,
    pieceCount,
    prefillCells: doc.engineConfig.prefill.length,
    medianMoves: doc.solvability.medianMoves,
    remoteConfigLive: live,
  });
  return { status: 'created', doc };
}

/**
 * §8.2: "Cloud Function scheduled 00:00 UTC".
 *
 * No §14 analytics event fires here. §14's taxonomy is client Firebase Analytics
 * and marks exactly one server event (`daily_missed`, which belongs to §8.6);
 * there is no generation event in it. Inventing one would be a new permanent
 * API name and needs a PRD amendment first (§14, §0.1) — so generation reports
 * through structured logs instead.
 */
export const generateDailyBoardScheduled = onSchedule(
  {
    schedule: '0 0 * * *',
    timeZone: 'UTC',
    secrets: [DAILY_BOARD_SALT],
    // 200 greedy-bot playouts of a 60-piece sequence — seconds, not the 60s default.
    timeoutSeconds: 300,
    memory: '512MiB',
    retryCount: 3,
  },
  async (event) => {
    if (getApps().length === 0) initializeApp();
    const generatedAt = event.scheduleTime ?? new Date().toISOString();
    await publishDailyBoard(utcDate(generatedAt), DAILY_BOARD_SALT.value(), generatedAt);
  },
);
