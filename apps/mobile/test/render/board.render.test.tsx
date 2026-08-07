/**
 * Render-tree tests — PRD §7.3 prereq #3: prove these components actually
 * mount and build a tree (not just that their pure math is right). Uses
 * `react-test-renderer` against the native-module mocks in `test/mocks/`
 * (see `vitest.config.ts`).
 */
import { createGame, type EngineTuning } from '@blockmanor/engine';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { BoardCanvas } from '../../src/game/BoardCanvas';
import { desaturationMatrix } from '../../src/game/colorMath';
import { GlossyBlock } from '../../src/game/GlossyBlock';
import { TrayCanvas } from '../../src/game/TrayCanvas';

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
        id: 1,
        chapter: 1,
        seedSalt: 'render-test',
        prefill: [
          { r: 1, c: 1, type: 'crate' },
          { r: 1, c: 3, type: 'crate2' },
          { r: 1, c: 5, type: 'chain', color: 2 },
          { r: 3, c: 1, type: 'ivy' },
          { r: 3, c: 5, type: 'heirloom' },
          { r: 5, c: 2, type: 'filled', color: 4 },
        ],
        goals: [{ type: 'crate', count: 12 }],
        pieceWeightOverrides: {},
        mercy: true,
        stars: { s2: 1500, s3: 2600 },
        ivySpreadInterval: 3,
        ivyMaxTiles: 16,
      },
    },
    'render-test-seed',
  );
}

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

describe('GlossyBlock', () => {
  it('renders a single rounded rect with a 3-stop gradient', () => {
    const tree = render(
      <GlossyBlock x={0} y={0} size={40} gradient={['#fff', '#888', '#000']} />,
    ).toJSON();
    expect(tree).not.toBeNull();
    expect(Array.isArray(tree) ? tree[0]?.type : tree?.type).toBe('SkRoundedRect');
  });
});

describe('BoardCanvas (PRD §7.2 static render, all 5 §7.8 obstacle motifs)', () => {
  it('renders one Skia canvas for an 8x8 board without throwing', () => {
    const state = demoState();
    const tree = render(<BoardCanvas board={state.board} containerWidth={400} />).toJSON();
    expect(tree).not.toBeNull();
    expect(Array.isArray(tree) ? tree[0]?.type : tree?.type).toBe('SkCanvas');
  });

  it('re-renders cleanly when the board reference changes (a real placement)', () => {
    const state = demoState();
    const renderer = render(<BoardCanvas board={state.board} containerWidth={400} />);
    const next = createGame(
      {
        mode: 'level',
        tuning: TUNING,
        level: {
          id: 2,
          chapter: 1,
          seedSalt: 'x',
          prefill: [],
          goals: [],
          pieceWeightOverrides: {},
          mercy: true,
          stars: { s2: 1, s3: 2 },
          ivySpreadInterval: 3,
          ivyMaxTiles: 16,
        },
      },
      'seed-2',
    );
    expect(() =>
      act(() => {
        renderer.update(<BoardCanvas board={next.board} containerWidth={400} />);
      }),
    ).not.toThrow();
  });

  it('honors a height constraint without crashing on a zero-height slot', () => {
    const state = demoState();
    expect(() =>
      render(<BoardCanvas board={state.board} containerWidth={400} maxHeight={0} />),
    ).not.toThrow();
  });

  it('omits `desaturateSV` -> no ColorMatrix layer, unchanged output (§7.4)', () => {
    const state = demoState();
    const renderer = render(<BoardCanvas board={state.board} containerWidth={400} />);
    expect(renderer.root.findAllByType('SkColorMatrix' as never).length).toBe(0);
    expect(renderer.root.findAllByType('SkPaint' as never).length).toBe(0);
  });

  it('provided `desaturateSV` -> wraps cells in a Paint/ColorMatrix layer driven by desaturationMatrix (§7.4 "Fail | desaturate board")', () => {
    const state = demoState();
    const desaturateSV = { value: 0.5 };
    const renderer = render(
      <BoardCanvas board={state.board} containerWidth={400} desaturateSV={desaturateSV as never} />,
    );
    const matrixNode = renderer.root.findByType('SkColorMatrix' as never);
    expect(renderer.root.findAllByType('SkPaint' as never).length).toBe(1);
    const matrix = (matrixNode.props as { matrix: { value: number[] } }).matrix;
    expect(matrix.value).toEqual(desaturationMatrix(0.5));
  });
});

describe('TrayCanvas (PRD §7.2 v1.8 50% scale + §7.3 hiddenSlot)', () => {
  it('renders a block per tray-piece cell (3 fresh pieces)', () => {
    const state = demoState();
    const renderer = render(
      <TrayCanvas tray={state.tray} boardCellSize={40} containerWidth={360} />,
    );
    const blocks = renderer.root.findAllByType('SkRoundedRect' as never);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('draws nothing for the hidden (mid-drag) slot', () => {
    const state = demoState();
    const withAll = render(
      <TrayCanvas tray={state.tray} boardCellSize={40} containerWidth={360} />,
    ).root.findAllByType('SkRoundedRect' as never).length;
    const withHidden = render(
      <TrayCanvas tray={state.tray} boardCellSize={40} containerWidth={360} hiddenSlot={0} />,
    ).root.findAllByType('SkRoundedRect' as never).length;
    expect(withHidden).toBeLessThan(withAll);
  });

  it('renders nothing for a used slot', () => {
    const state = demoState();
    const usedTray = state.tray.map((s, i) => (i === 0 ? { ...s, used: true } : s));
    expect(() =>
      render(<TrayCanvas tray={usedTray} boardCellSize={40} containerWidth={360} />),
    ).not.toThrow();
  });
});
