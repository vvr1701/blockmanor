/**
 * `LevelSession` §9.3 wiring: the showcase grant (L12 hammer, real content —
 * not mocked, unlike `levelSession.render.test.tsx`'s synthetic fixtures,
 * which deliberately mark every showcase pre-granted to avoid colliding with
 * their own id-12/18/26 fixtures) and the pre-level slot's sheet. Win-streak
 * grants and `boosters_used`/`booster_used` are proven at the pure-function
 * level in `test/boosters.test.ts`; this file proves the SCREEN wiring:
 * reaching L12 actually grants + shows the sheet, and confirming it actually
 * arms `GameplayScreen`.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));
vi.mock('../../src/services/wallet', () => ({ grantCoins: vi.fn() }));

import { DragLayer } from '../../src/game/DragLayer';
import { BoosterPreLevelSheet } from '../../src/game/BoosterPreLevelSheet';
import { LevelSession } from '../../src/game/LevelSession';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { track } from '../../src/services/analytics';
import { useBoosterStore } from '../../src/state/useBoosterStore';
import { useMetaStore } from '../../src/state/useMetaStore';

const trackMock = vi.mocked(track);
const activeRenderers: ReactTestRenderer[] = [];

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  activeRenderers.push(renderer);
  return renderer;
}

beforeEach(() => {
  trackMock.mockClear();
  useMetaStore.setState({ currentLevel: 12, attempts: {}, winStreak: 0 });
  useBoosterStore.setState({
    counts: { hammer: 0, broom: 0, hourglass: 0 },
    showcaseGranted: { hammer: false, broom: false, hourglass: false },
    tooltip: null,
    preSelected: null,
  });
});

afterEach(() => {
  while (activeRenderers.length > 0) {
    const renderer = activeRenderers.pop()!;
    act(() => renderer.unmount());
  }
});

describe('LevelSession §9.3 showcase grant (real L12 content)', () => {
  it('reaching L12 the first time grants exactly one hammer and queues its tooltip', () => {
    render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(useBoosterStore.getState().counts.hammer).toBe(1);
    expect(useBoosterStore.getState().showcaseGranted.hammer).toBe(true);
    expect(useBoosterStore.getState().tooltip).toBe('hammer');
  });

  it('is idempotent — a retry of L12 grants no second hammer', () => {
    render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    useBoosterStore.getState().dismissTooltip();
    // Simulate a second mount of the same level (a retry / relaunch).
    render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(useBoosterStore.getState().counts.hammer).toBe(1);
  });

  it('a level with no showcase and no owned boosters skips the sheet, mounting GameplayScreen directly', () => {
    useMetaStore.setState({ currentLevel: 13 });
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(renderer.root.findAllByType(BoosterPreLevelSheet).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
  });
});

describe('LevelSession §9.3 pre-level slot', () => {
  it('shows the sheet once a booster is owned, and confirming it arms GameplayScreen', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    // The L12 showcase grant above put a hammer in inventory — the sheet
    // must block `GameplayScreen` until answered.
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(0);
    const sheet = renderer.root.findByType(BoosterPreLevelSheet);
    expect((sheet.props as { counts: { hammer: number } }).counts.hammer).toBe(1);

    act(() => {
      (sheet.props as { onConfirm: (t: string | null) => void }).onConfirm('hammer');
    });

    expect(renderer.root.findAllByType(BoosterPreLevelSheet).length).toBe(0);
    const gameplay = renderer.root.findByType(GameplayScreen);
    expect((gameplay.props as { boosters: { preArmed: string | null } }).boosters.preArmed).toBe(
      'hammer',
    );
    // `hammer` has no target at mount, so `DragLayer` should be armed, not
    // the booster already spent (inventory still 1 until `onUsed` fires).
    expect(useBoosterStore.getState().counts.hammer).toBe(1);
    const dragLayer = renderer.root.findByType(DragLayer);
    expect(
      (dragLayer.props as { boosterTargeting: { kind: string } | null }).boosterTargeting?.kind,
    ).toBe('hammer');
  });

  it('skipping the sheet arms nothing and still mounts GameplayScreen', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    const sheet = renderer.root.findByType(BoosterPreLevelSheet);
    act(() => {
      (sheet.props as { onConfirm: (t: string | null) => void }).onConfirm(null);
    });
    const gameplay = renderer.root.findByType(GameplayScreen);
    expect((gameplay.props as { boosters: { preArmed: string | null } }).boosters.preArmed).toBe(
      null,
    );
  });

  it('using the armed hammer mid-level fires booster_used{type,level} and consumes inventory', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} onOpenSettings={vi.fn()} />);
    act(() => {
      (
        renderer.root.findByType(BoosterPreLevelSheet).props as {
          onConfirm: (t: string | null) => void;
        }
      ).onConfirm('hammer');
    });
    const targeting = (
      renderer.root.findByType(DragLayer).props as {
        boosterTargeting: { onTarget: (r: number, c: number) => void } | null;
      }
    ).boosterTargeting;
    act(() => {
      // L12's real prefill has a `filled` cell at (0,4) — a guaranteed hit.
      targeting!.onTarget(0, 4);
    });
    expect(useBoosterStore.getState().counts.hammer).toBe(0);
    expect(trackMock).toHaveBeenCalledWith('booster_used', { type: 'hammer', level: 12 });
  });
});
