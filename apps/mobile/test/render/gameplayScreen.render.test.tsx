/**
 * `GameplayScreen` render-tree tests — PRD §7.2 / §7.3 prereq #3. This is the
 * component that actually assembles BoardCanvas + TrayCanvas + DragLayer
 * into one screen, so it's the one place a layout/wiring mistake between
 * them (exactly the shape of bug the §7.2 tray-overflow QA finding was)
 * would show up structurally.
 */
import { createGame, getLegalPlacements, type EngineTuning } from '@blockmanor/engine';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
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
});
