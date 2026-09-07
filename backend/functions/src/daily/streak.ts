/**
 * §8.6 streak — the counter, and the one Remote Config key the daily path is
 * allowed to read.
 *
 * Split out of `submit.ts` deliberately, and the split is load-bearing.
 * `generate.test.ts` asserts that no module in the daily path imports Remote
 * Config, because §8.2 (PRD v1.7) says "an RC push mid-day must not be able to
 * change how a submitted run scores". `submit.ts` is the file where that would
 * do the most damage, so it stays literally unable to reach Remote Config, and
 * the one key that legitimately IS live — §8.6's `daily_streak_min_moves
 * [RC, 3]` — is read here instead.
 *
 * Why that key is not frozen into `dailyBoards/{date}`: it is not an engine
 * value. It never reaches `simulate()`, never reaches `dailyGameConfig()`, and
 * cannot move a score, a `boardHash` or a `daily_cheat_rejected` verdict — it
 * only decides whether a short abandoned run earns the day. §8.2 enumerates
 * what the snapshot holds (scoring constants, mercy values, piece sequence,
 * prefill) and this is not among them; §13 lists it as a live Daily-board key.
 * Same reasoning that keeps `daily_reroll_cap` out of the snapshot.
 */

import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { logger } from 'firebase-functions/v2';

/**
 * §8.6 `daily_streak_min_moves [RC, 3]`. CLAUDE.md rule 3: an `[RC]` value is
 * never hardcoded at the call site, so this reads the key and falls back to the
 * §13 registry default in `packages/shared` — never to a literal here.
 *
 * Never throws: a Remote Config outage must not cost an honest player a streak.
 */
export async function streakMinMoves(): Promise<number> {
  const fallback = REMOTE_CONFIG_DEFAULTS.daily_streak_min_moves;
  try {
    const template = await getRemoteConfig().getServerTemplate({
      defaultConfig: { daily_streak_min_moves: fallback },
    });
    // `getValue`, not `getNumber`, for the same reason `publish.ts` does it: the
    // wrapper is the only thing that says whether the template really defined
    // the key, and `asNumber()` renders an unparseable value as 0 — which here
    // would silently grant a streak for opening the board and quitting.
    const value = template.evaluate().getValue('daily_streak_min_moves');
    const n = value.asNumber();
    if (value.getSource() !== 'remote') return fallback;
    // Bounds, not balance — the same typo guard `publish.ts` puts on the frozen
    // numbers, and for its stated reason: `asNumber()` renders an unparseable
    // value as 0, and 0 here makes `moves.length >= 0` always true, so opening
    // the board and quitting would earn the day. That is the one outcome §8.6's
    // threshold exists to refuse, so 0 is out of band. An operator who really
    // wants "any submission counts" sets 1, which is legible as a choice.
    if (!Number.isInteger(n) || n < 1 || n > 1_000) {
      logger.error('daily_submit: daily_streak_min_moves out of bounds, using §13 default', {
        rejected: n,
        fallback,
      });
      return fallback;
    }
    return n;
  } catch (error) {
    logger.warn('daily_submit: Remote Config unreadable, using §13 default', { error });
    return fallback;
  }
}

/** The UTC day before `date`, as YYYY-MM-DD. */
export const previousUtcDate = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);

export interface StreakState {
  streak: number;
  lastStreakDate?: string;
}

/**
 * §8.6, as a pure function so every branch is testable without a database.
 *
 * "Streak +1 requires a submitted attempt for that UTC day — playing, not
 * winning; score is irrelevant. A missed UTC day resets to 0."
 *
 * Credit goes to the BOARD's UTC day, not the wall-clock day the submission
 * arrives on. That is what makes §8.5's 36h window work: a run played at 23:59
 * on D and submitted at 00:01 on D+1 credits D, which is the day it was played.
 * (§8.3's play-start refuses a board whose UTC day has closed, so a player
 * cannot open a missed day's board later to backfill it.)
 *
 * A submission for a day OLDER than the last credited one leaves the counter
 * alone: it is a late arrival, not a rewrite of history, and recomputing the
 * chain backwards would need every day's record.
 *
 * "Resets to 0" and then this same submission credits its own day, so the
 * counter reads 1 — the day the player did show up is still a day played.
 */
export function nextStreak(current: StreakState, date: string): StreakState {
  const last = current.lastStreakDate;
  if (last === undefined) return { streak: 1, lastStreakDate: date };
  if (last >= date) return current;
  if (last === previousUtcDate(date)) return { streak: current.streak + 1, lastStreakDate: date };
  return { streak: 1, lastStreakDate: date };
}
