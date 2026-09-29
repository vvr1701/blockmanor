/**
 * `GameplayScreen` render-tree tests — PRD §7.2 / §7.3 prereq #3. This is the
 * component that actually assembles BoardCanvas + TrayCanvas + DragLayer
 * into one screen, so it's the one place a layout/wiring mistake between
 * them (exactly the shape of bug the §7.2 tray-overflow QA finding was)
 * would show up structurally.
 */
import { createGame, getLegalPlacements, type EngineTuning, type GameEvent } from '@blockmanor/engine';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { DragLayer } from '../../src/game/DragLayer';
import { GameplayScreen } from '../../src/screens/GameplayScreen';

const TUNING: EngineTuning = {
  mercy_threshold: 0.55,
  mercy_small_prob: 0.65,
  score_clear_base: 10,
  combo_step: 0.25,
  perfect_clear_bonus: 300,
};

function demoState() {
  return createGame(
    {
      mode: 'level',
      tuning: TUNING,
      level: {
        id: 24,
        chapter: 1,
        seedSalt: 'gameplay-render-test',
        prefill: [
          { r: 1, c: 1, type: 'crate' },
          { r: 3, c: 5, type: 'heirloom' },
        ],
        goals: [{ type: 'crate', count: 12 }],
        pieceWeightOverrides: {},
        mercy: true,
        stars: { s2: 1500, s3: 2600 },
        ivySpreadInterval: 3,
        ivyMaxTiles: 16,
      },
    },
    'gameplay-render-seed',
  );
}

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

describe('GameplayScreen', () => {
  it('mounts without throwing', () => {
    expect(() => render(<GameplayScreen initialState={demoState()} />)).not.toThrow();
  });

  it('renders exactly 4 Skia canvases: board, tray, the §7.3 drag overlay, and the §7.4 juice overlay', () => {
    const renderer = render(<GameplayScreen initialState={demoState()} />);
    const canvases = renderer.root.findAllByType('SkCanvas' as never);
    expect(canvases.length).toBe(4);
  });

  it('mounts one gesture zone per un-used tray slot (3 fresh pieces -> 3 zones)', () => {
    const renderer = render(<GameplayScreen initialState={demoState()} />);
    const zones = renderer.root.findAllByType('GHDetector' as never);
    expect(zones.length).toBe(3);
  });

  it('drops a gesture zone for a used tray slot (mid-turn state, §6.3)', () => {
    const state = demoState();
    const midTurn = {
      ...state,
      tray: state.tray.map((s, i) => (i === 0 ? { ...s, used: true } : s)),
    };
    const renderer = render(<GameplayScreen initialState={midTurn} />);
    const zones = renderer.root.findAllByType('GHDetector' as never);
    expect(zones.length).toBe(2);
  });

  it('renders the goal bar from the level config (§7.2 HUD)', () => {
    const renderer = render(<GameplayScreen initialState={demoState()} />);
    const texts = renderer.root.findAllByType('RNText' as never);
    expect(texts.length).toBeGreaterThan(0);
  });

  it('renders with no goals (endless/daily-shaped config) without throwing', () => {
    const state = createGame({ mode: 'endless', tuning: TUNING }, 'endless-seed');
    expect(() => render(<GameplayScreen initialState={state} />)).not.toThrow();
  });

  it('committing a placement via DragLayer.onPlace actually updates the board (§4.3 wiring)', () => {
    const state = demoState();
    const legal = getLegalPlacements(state, 0)[0];
    expect(legal).toBeDefined();

    const renderer = render(<GameplayScreen initialState={state} />);
    expect(renderer.root.findAllByType('GHDetector' as never).length).toBe(3);

    const dragLayer = renderer.root.findByType(DragLayer);
    act(() => {
      (dragLayer.props as { onPlace: (i: number, r: number, c: number) => void }).onPlace(
        0,
        legal!.r,
        legal!.c,
      );
    });

    // The placed slot's piece is now `used` — its gesture zone is gone, and
    // the 4 canvases (board/tray/drag-overlay/juice-overlay) are all still
    // exactly 4, not duplicated by the one re-render placement causes.
    expect(renderer.root.findAllByType('GHDetector' as never).length).toBe(2);
    expect(renderer.root.findAllByType('SkCanvas' as never).length).toBe(4);
  });

  it('two placements queued in the same tick keep `events` in sync with the resulting `state` (§4.3 atomicity regression)', () => {
    // Reproduces the exact race a real device hit: a second `onPlace` fired
    // before the first placement's update had committed (in production this
    // is `DragLayer` racing its own `runOnJS` bridge calls; here it's two
    // synchronous calls in the same `act()` batch — the same "another update
    // already pending" condition that defeats React's synchronous-updater
    // fast path). `act()` collapses both into ONE commit, so this isn't
    // about call COUNT — it's about whether the one `onEvent` call this
    // produces reports events that actually match the state that committed.
    //
    // Old (buggy) shape: the second call's `events` was a local variable
    // only ever written INSIDE the `setState` updater; when that updater was
    // deferred (not run synchronously), the variable stayed `[]` and
    // `setJuiceEvents([])` — called unconditionally right after — clobbered
    // whatever the first call had correctly queued. Result: `state` still
    // advanced correctly (functional updaters compose regardless of
    // timing), but the reported `events` silently went to `[]` — exactly the
    // "`status: 'won'` with no `LEVEL_WON` event" shape `LevelSession` caught.
    const state = demoState();
    const first = getLegalPlacements(state, 0)[0]!;
    const second = getLegalPlacements(state, 1)[0]!;
    const onEvent = vi.fn<(events: readonly GameEvent[], state: { placements: number }) => void>();

    const renderer = render(<GameplayScreen initialState={state} onEvent={onEvent} />);
    const dragLayer = renderer.root.findByType(DragLayer);
    const onPlace = (dragLayer.props as { onPlace: (i: number, r: number, c: number) => void })
      .onPlace;

    // Both calls queued in the SAME `act()` batch, before either flushes.
    act(() => {
      onPlace(0, first.r, first.c);
      onPlace(1, second.r, second.c);
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    const [events, finalState] = onEvent.mock.calls[0]!;

    // `state` itself was never the buggy half — both placements land either
    // way. The regression is specifically that `events` must match, i.e.
    // carry the SECOND (most recent) placement's own `PIECE_PLACED`, not a
    // stale empty array.
    expect(finalState.placements).toBe(2);
    const secondPlaced = events.find((e) => e.type === 'PIECE_PLACED');
    expect(secondPlaced).toMatchObject({ pieceIndex: 1, r: second.r, c: second.c });

    expect(renderer.root.findAllByType('GHDetector' as never).length).toBe(1);
  });
});
