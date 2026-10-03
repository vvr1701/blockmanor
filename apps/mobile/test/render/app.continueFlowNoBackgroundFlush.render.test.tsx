/**
 * §0 v1.46(a): a qa-prd-auditor re-audit found that `continueFlow.test.ts`'s
 * own regression test for the deleted background flush only proves
 * `continueFlow.ts` doesn't self-subscribe — it never mounts `App`, which is
 * where the original bug was actually wired (`App.tsx`'s
 * `useEffect(() => watchContinueFlowSync(), [])`). Reintroducing that one
 * line there would pass every other test in this PR and still reopen the
 * double-charge. This file closes that gap by mounting the real `App`.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

import { REMOTE_CONFIG_DEFAULTS } from '@blockmanor/shared';
import App from '../../src/App';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useContinueStore } from '../../src/state/useContinueStore';
import { useMetaStore } from '../../src/state/useMetaStore';
import { reportNetworkResult, resetConnectivity } from '../../src/services/connectivity';
import { firebaseMock, resetFirebaseMock } from '../mocks/react-native-firebase';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

const flush = () => act(async () => Promise.resolve());

beforeEach(() => {
  resetFirebaseMock();
  resetConnectivity();
  firebaseMock.configured = true;
  firebaseMock.currentUser = { uid: 'alice' };
  useMetaStore.setState({
    currentLevel: 12,
    ftueComplete: true,
    playerName: null,
    avatarId: null,
    attempts: {},
    stars: {},
    chestsClaimed: {},
    ownedFrames: [],
  });
  useConfigStore.setState({
    snapshot: { ...REMOTE_CONFIG_DEFAULTS, flag_economy: true },
    fetchedAt: null,
  });
  useContinueStore.setState({
    secondChance: { day: '', count: 0 },
    pendingContinue: { key: 'continue:stale-run-x', amount: 900, runKey: 'stale-run' },
  });
});

describe('§0 v1.46(a): mounting App never settles a leftover pendingContinue in the background', () => {
  it('a reconnect transition makes no spendCoins call', async () => {
    firebaseMock.callables['spendCoins'] = () => ({
      coins: 100,
      rev: 1,
      amount: 900,
      applied: true,
    });
    render(<App />);
    act(() => {
      reportNetworkResult(false);
      reportNetworkResult(true);
    });
    await flush();
    expect(firebaseMock.calls).toEqual([]);
    expect(useContinueStore.getState().pendingContinue).not.toBeNull();
  });

  it('a Remote Config fetch landing makes no spendCoins call', async () => {
    firebaseMock.callables['spendCoins'] = () => ({
      coins: 100,
      rev: 1,
      amount: 900,
      applied: true,
    });
    render(<App />);
    act(() => {
      useConfigStore.getState().applySnapshot({ flag_economy: true }, 1);
    });
    await flush();
    expect(firebaseMock.calls).toEqual([]);
    expect(useContinueStore.getState().pendingContinue).not.toBeNull();
  });
});
