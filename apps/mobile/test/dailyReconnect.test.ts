import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/analytics', () => ({ track: vi.fn() }));

import { DAILY_BOARDS_COLLECTION, REMOTE_CONFIG_DEFAULTS, engineVersion } from '@blockmanor/shared';
import {
  applyAcceptedDaily,
  resetAppliedDaily,
  watchDailyReconnectFlush,
} from '../src/game/dailyResult';
import { track } from '../src/services/analytics';
import { isOnline, reportNetworkResult, resetConnectivity } from '../src/services/connectivity';
import {
  clearPendingRun,
  readPendingRun,
  savePendingRun,
  submitPendingRun,
} from '../src/services/dailyClient';
import { useMetaStore } from '../src/state/useMetaStore';
import { firebaseMock, resetFirebaseMock } from './mocks/react-native-firebase';

const DATE = '2026-08-09';
const flush = () => new Promise((r) => setTimeout(r, 0));
const engineConfig = {
  tuning: {
    mercy_threshold: REMOTE_CONFIG_DEFAULTS.mercy_threshold,
    mercy_small_prob: REMOTE_CONFIG_DEFAULTS.mercy_small_prob,
    score_clear_base: REMOTE_CONFIG_DEFAULTS.score_clear_base,
    combo_step: REMOTE_CONFIG_DEFAULTS.combo_step,
    perfect_clear_bonus: REMOTE_CONFIG_DEFAULTS.perfect_clear_bonus,
  },
  prefill: [],
};
const result = (streak: number) => ({
  date: DATE,
  score: 50,
  status: 'lost' as const,
  moves: 0,
  streak,
  streakGranted: true,
  countsForPercentile: true,
  percentile: 9,
});

beforeEach(() => {
  vi.mocked(track).mockClear();
  resetFirebaseMock();
  resetConnectivity();
  resetAppliedDaily();
  firebaseMock.configured = true;
  clearPendingRun();
  void engineVersion;
  void DAILY_BOARDS_COLLECTION;
  act(() => {
    useMetaStore.setState({ streak: 6, bestDailyPercentile: 0, badges: { dailyUnplayed: true } });
  });
});

describe('§12.4 queued daily submission flushes on reconnect', () => {
  it('submits the stored run when the network comes back, and folds the result in', async () => {
    let submits = 0;
    firebaseMock.callables['dailySubmit'] = () => {
      submits += 1;
      return result(7);
    };
    savePendingRun({ date: DATE, engineConfig, sequence: ['P01'], moves: [] });
    const stop = watchDailyReconnectFlush();
    reportNetworkResult(false);
    await flush();
    expect(submits).toBe(0);
    reportNetworkResult(true);
    await flush();
    expect(submits).toBe(1);
    expect(readPendingRun()).toBeNull();
    expect(useMetaStore.getState()).toMatchObject({ streak: 7, bestDailyPercentile: 9 });
    expect(track).toHaveBeenCalledWith('streak_milestone', { n: 7 });
    stop();
  });

  it('the daily client reports its own network outcomes', async () => {
    firebaseMock.callables['dailySubmit'] = () => {
      throw Object.assign(new Error('unavailable'), { code: 'functions/unavailable' });
    };
    savePendingRun({ date: DATE, engineConfig, sequence: ['P01'], moves: [] });
    await submitPendingRun();
    expect(isOnline()).toBe(false);
    firebaseMock.callables['dailySubmit'] = () => result(7);
    await submitPendingRun();
    expect(isOnline()).toBe(true);
  });

  it('two callers share one round trip, and a result is applied once per board', async () => {
    let submits = 0;
    firebaseMock.callables['dailySubmit'] = () => {
      submits += 1;
      return result(7);
    };
    savePendingRun({ date: DATE, engineConfig, sequence: ['P01'], moves: [] });
    const [a, b] = await Promise.all([submitPendingRun(), submitPendingRun()]);
    expect(submits).toBe(1);
    expect(a).toBe(b);
    expect(applyAcceptedDaily(result(7))).toBe(7);
    expect(applyAcceptedDaily(result(7))).toBeNull();
    expect(vi.mocked(track).mock.calls.filter(([n]) => n === 'streak_milestone')).toHaveLength(1);
  });
});
