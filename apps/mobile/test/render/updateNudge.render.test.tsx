/**
 * §12.11 acceptance, clause by clause (§0 rule 6a — each with its own
 * assertions):
 *   - the banner appears only when latest_version > installed AND installed
 *     is at or above min_supported_version
 *   - dismissal persists for a week
 *   - a below-minimum build gets §12.5's blocking screen and never this banner
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from '../../src/screens/HomeScreen';
import {
  isNudgeSuppressed,
  NUDGE_SUPPRESSION_MS,
  UpdateBanner,
} from '../../src/screens/HomeScreen/UpdateBanner';
import { isSoftUpdateAvailable } from '../../src/services/appInfo';
import { useConfigStore } from '../../src/state/useConfigStore';
import { useMetaStore } from '../../src/state/useMetaStore';

function render(el: React.ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(el);
  });
  return r;
}

/** `expoConfig.version` is '0.1.0' in the test mock — the installed build. */
const INSTALLED = '0.1.0';

function setVersions(latest: string, minSupported = '0.0.1'): void {
  useConfigStore.setState((s) => ({
    snapshot: {
      ...s.snapshot,
      latest_version: latest,
      min_supported_version: minSupported,
    } as typeof s.snapshot,
  }));
}

function banners(r: ReactTestRenderer): unknown[] {
  return r.root.findAllByType(UpdateBanner);
}

const home = (now = 1_000_000_000_000): React.ReactElement => (
  <HomeScreen onPlay={() => {}} onOpenMap={() => {}} now={now} />
);

beforeEach(() => {
  useMetaStore.setState({ currentLevel: 3, updateNudgeDismissedAt: 0 });
  setVersions(INSTALLED);
});

describe('§12.11 soft update nudge', () => {
  it('no banner when the installed build IS the latest', () => {
    expect(banners(render(home()))).toHaveLength(0);
  });

  it('banner when latest_version exceeds the installed build', () => {
    setVersions('0.2.0');
    expect(banners(render(home()))).toHaveLength(1);
  });

  it('"1.10" is newer than "1.9" — the string-compare trap §12.5 names', () => {
    // Guarded at the predicate, because a lexicographic compare passes every
    // other case in this file and fails only here.
    expect(isSoftUpdateAvailable('1.9.0', '1.10.0', '0.0.1')).toBe(true);
    expect(isSoftUpdateAvailable('1.10.0', '1.9.0', '0.0.1')).toBe(false);
  });

  it('NEVER banners a below-minimum build — that build gets §12.5 instead', () => {
    // Newer build available AND below minimum: the soft nudge must lose.
    setVersions('9.9.9', '9.0.0');
    expect(isSoftUpdateAvailable(INSTALLED, '9.9.9', '9.0.0')).toBe(false);
    expect(banners(render(home()))).toHaveLength(0);
  });

  it('dismissal hides it, and persists for exactly a week', () => {
    setVersions('0.2.0');
    const t0 = 1_000_000_000_000;
    const r = render(home(t0));
    const dismiss = r.root
      .findByType(UpdateBanner)
      .findAllByType('RNPressable' as never)
      .at(-1)!;
    act(() => {
      (dismiss.props as { onPress: () => void }).onPress();
    });
    expect(useMetaStore.getState().updateNudgeDismissedAt).toBe(t0);

    // Still inside the week: suppressed. One ms past it: back.
    expect(banners(render(home(t0 + NUDGE_SUPPRESSION_MS - 1)))).toHaveLength(0);
    expect(banners(render(home(t0 + NUDGE_SUPPRESSION_MS)))).toHaveLength(1);
  });

  // Every other case here reads NUDGE_SUPPRESSION_MS symbolically, so they all
  // follow the constant wherever it moves — a mutation shortening the window
  // to a day passed all of them. §12.11 says "max 1/WEEK", so the duration
  // itself needs pinning, not just the behaviour around it.
  it('the window is one week, not merely "some window"', () => {
    expect(NUDGE_SUPPRESSION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('a never-dismissed save is not suppressed', () => {
    expect(isNudgeSuppressed(0, 1_000_000_000_000)).toBe(false);
  });

  it('the banner offers an update action AND a dismiss — never a dead end', () => {
    const onDismiss = vi.fn();
    const r = render(<UpdateBanner onDismiss={onDismiss} />);
    const pressables = r.root.findAllByType('RNPressable' as never);
    expect(pressables).toHaveLength(2);
    act(() => {
      (pressables[1]!.props as { onPress: () => void }).onPress();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
