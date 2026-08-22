/**
 * `EndlessScreen` — PRD §7.6. Covers the engine-config contract ("identical
 * engine config `mode:\"endless\"`", no goals, mercy RNG on), the
 * `endless_end{score,best}` analytics wiring (§14), and the personal-best
 * update. Drives `GameplayScreen.onEvent` directly with a synthetic terminal
 * `GameState` — the same "call the prop function this screen itself passed
 * down" technique `ftueScreen.render.test.tsx` uses for `DragLayer.onPlace` —
 * rather than exhausting a real board (game-over timing under mercy RNG is
 * not something a unit test should depend on).
 */
import type { GameEvent, GameState } from '@blockmanor/engine';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

import { track } from '../../src/services/analytics';
import { EndlessScreen } from '../../src/screens/EndlessScreen';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { useMetaStore } from '../../src/state/useMetaStore';

const trackMock = vi.mocked(track);

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

/** Synthesizes a terminal (`status: 'lost'`) `GameState` off a real mounted
 * one, only touching the fields `EndlessScreen.handleEvent` reads. */
function endedState(base: GameState, score: number): GameState {
  return { ...base, status: 'lost', score };
}

beforeEach(() => {
  trackMock.mockClear();
  useMetaStore.setState({ endlessBest: 0 });
});

describe('EndlessScreen (PRD §7.6)', () => {
  it('builds an engine config with mode "endless", no `level` (=> no goals), and mercy left on', () => {
    const renderer = render(<EndlessScreen onExit={vi.fn()} />);
    const gameplay = renderer.root.findByType(GameplayScreen);
    const state = gameplay.props.initialState as GameState;
    expect(state.config.mode).toBe('endless');
    expect(state.config.level).toBeUndefined();
    expect(state.config.pieceSequence).toBeUndefined();
    // §7.2: the goal bar is driven off `state.goals`, empty exactly when
    // `config.level` is absent (§6's `createGame`) — "no goals" end to end.
    expect(state.goals).toEqual([]);
  });

  it('fires `endless_end{score,best}` exactly once when the run ends, and raises `endlessBest`', () => {
    const renderer = render(<EndlessScreen onExit={vi.fn()} />);
    const gameplay = renderer.root.findByType(GameplayScreen);
    const base = gameplay.props.initialState as GameState;

    act(() => {
      (gameplay.props as { onEvent: (e: readonly GameEvent[], s: GameState) => void }).onEvent(
        [],
        endedState(base, 1500),
      );
    });

    expect(trackMock).toHaveBeenCalledWith('endless_end', { score: 1500, best: 1500 });
    expect(useMetaStore.getState().endlessBest).toBe(1500);
    expect(trackMock.mock.calls.filter(([name]) => name === 'endless_end').length).toBe(1);
  });

  it('a run that scores below the existing best fires `endless_end` with the OLD best, and does not lower it', () => {
    useMetaStore.setState({ endlessBest: 5000 });
    const renderer = render(<EndlessScreen onExit={vi.fn()} />);
    const gameplay = renderer.root.findByType(GameplayScreen);
    const base = gameplay.props.initialState as GameState;

    act(() => {
      (gameplay.props as { onEvent: (e: readonly GameEvent[], s: GameState) => void }).onEvent(
        [],
        endedState(base, 900),
      );
    });

    expect(trackMock).toHaveBeenCalledWith('endless_end', { score: 900, best: 5000 });
    expect(useMetaStore.getState().endlessBest).toBe(5000);
  });

  it('"Play again" starts a fresh run (new GameplayScreen instance) and clears the result overlay', () => {
    const renderer = render(<EndlessScreen onExit={vi.fn()} />);
    const firstGameplay = renderer.root.findByType(GameplayScreen);
    const base = firstGameplay.props.initialState as GameState;

    act(() => {
      (firstGameplay.props as { onEvent: (e: readonly GameEvent[], s: GameState) => void }).onEvent(
        [],
        endedState(base, 300),
      );
    });

    const playAgain = renderer.root.findAll(
      (node) => node.props.accessibilityLabel === 'Play again',
    )[0];
    expect(playAgain).toBeDefined();
    act(() => {
      (playAgain!.props as { onPress: () => void }).onPress();
    });

    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(
      renderer.root.findAll((node) => node.props.accessibilityLabel === 'Play again').length,
    ).toBe(0);
  });

  it('"Home" fires `onExit`', () => {
    const onExit = vi.fn();
    const renderer = render(<EndlessScreen onExit={onExit} />);
    const gameplay = renderer.root.findByType(GameplayScreen);
    const base = gameplay.props.initialState as GameState;
    act(() => {
      (gameplay.props as { onEvent: (e: readonly GameEvent[], s: GameState) => void }).onEvent(
        [],
        endedState(base, 300),
      );
    });

    const home = renderer.root.findAll((node) => node.props.accessibilityLabel === 'Home')[0];
    act(() => {
      (home!.props as { onPress: () => void }).onPress();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
