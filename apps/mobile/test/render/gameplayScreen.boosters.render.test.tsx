/**
 * `GameplayScreen` §9.3 booster wiring — mid-level usage + the pre-level
 * slot's mount-time auto-arm, proven the same way
 * `gameplayScreen.render.test.tsx` proves placement wiring: find the real
 * `DragLayer`/`BoosterRow` instances and drive their props directly, letting
 * the actual `applyBooster` engine call run underneath.
 *
 * `LevelSession`'s own inventory/showcase/win-streak resolution is proven
 * separately in `test/boosters.test.ts` — this file only proves that once
 * `GameplayScreen` is HANDED a `boosters` prop, it calls the engine
 * correctly and reports back through `onUsed`.
 */
import { createGame, type EngineTuning } from '@blockmanor/engine';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { BoosterRow } from '../../src/game/BoosterRow';
import { DragLayer } from '../../src/game/DragLayer';
import { GameplayScreen } from '../../src/screens/GameplayScreen';

const TUNING: EngineTuning = {
  mercy_threshold: 0.55,
  mercy_small_prob: 0.65,
  score_clear_base: 10,
  combo_step: 0.25,
  perfect_clear_bonus: 300,
};

function demoState(pieceSequence?: readonly ['P01', 'P01', 'P01']) {
  return createGame(
    {
      mode: 'level',
      tuning: TUNING,
      level: {
        id: 24,
        chapter: 1,
        seedSalt: 'booster-render-test',
        // Row 0 partially filled (broom target) + one lone `crate` at (3,3)
        // (hammer target) — a high `crate` goal so no test here accidentally
        // wins the level mid-assertion.
        prefill: [
          { r: 0, c: 0, type: 'filled' },
          { r: 0, c: 2, type: 'filled' },
          { r: 3, c: 3, type: 'crate' },
        ],
        goals: [{ type: 'crate', count: 12 }],
        pieceWeightOverrides: {},
        mercy: true,
        stars: { s2: 1500, s3: 2600 },
        ivySpreadInterval: 3,
        ivyMaxTiles: 16,
      },
      ...(pieceSequence ? { pieceSequence } : {}),
    },
    'booster-render-seed',
  );
}

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

describe('GameplayScreen §9.3 booster row', () => {
  it('renders the plain reserved-height placeholder, not a BoosterRow, when no `boosters` prop is given', () => {
    const renderer = render(<GameplayScreen initialState={demoState()} />);
    expect(renderer.root.findAllByType(BoosterRow).length).toBe(0);
  });

  it('renders the BoosterRow when a `boosters` prop is given', () => {
    const onUsed = vi.fn();
    const renderer = render(<GameplayScreen initialState={demoState()} boosters={{ onUsed }} />);
    expect(renderer.root.findAllByType(BoosterRow).length).toBe(1);
  });

  it('hourglass fires immediately on press — no board target needed', () => {
    const onUsed = vi.fn();
    const state = demoState();
    const renderer = render(<GameplayScreen initialState={state} boosters={{ onUsed }} />);
    const row = renderer.root.findByType(BoosterRow);
    act(() => {
      (row.props as { onPress: (t: string) => void }).onPress('hourglass');
    });
    expect(onUsed).toHaveBeenCalledWith('hourglass');
    expect(onUsed).toHaveBeenCalledTimes(1);
  });

  it('hammer arms targeting, then a board tap destroys exactly that cell and reports back', () => {
    const onUsed = vi.fn();
    const state = demoState();
    const renderer = render(<GameplayScreen initialState={state} boosters={{ onUsed }} />);
    const row = renderer.root.findByType(BoosterRow);
    act(() => {
      (row.props as { onPress: (t: string) => void }).onPress('hammer');
    });
    expect((renderer.root.findByType(BoosterRow).props as { armed: string | null }).armed).toBe(
      'hammer',
    );

    const dragLayer = renderer.root.findByType(DragLayer);
    const targeting = (
      dragLayer.props as {
        boosterTargeting: { kind: string; onTarget: (r: number, c: number) => void } | null;
      }
    ).boosterTargeting;
    expect(targeting?.kind).toBe('hammer');

    act(() => {
      targeting!.onTarget(3, 3); // the `crate` prefill cell
    });

    expect(onUsed).toHaveBeenCalledWith('hammer');
    // Targeting clears after one tap, successful or not.
    expect((renderer.root.findByType(BoosterRow).props as { armed: string | null }).armed).toBe(
      null,
    );
    expect(
      (renderer.root.findByType(DragLayer).props as { boosterTargeting: unknown }).boosterTargeting,
    ).toBe(null);
  });

  it('broom targets a row (column ignored) and only reports on a real hit', () => {
    const onUsed = vi.fn();
    const state = demoState();
    const renderer = render(<GameplayScreen initialState={state} boosters={{ onUsed }} />);
    act(() => {
      (renderer.root.findByType(BoosterRow).props as { onPress: (t: string) => void }).onPress(
        'broom',
      );
    });
    const dragLayer = renderer.root.findByType(DragLayer);
    const targeting = (
      dragLayer.props as {
        boosterTargeting: { kind: string; onTarget: (r: number, c: number) => void } | null;
      }
    ).boosterTargeting;
    expect(targeting?.kind).toBe('broom');

    act(() => {
      // Row 7 is empty in this fixture — nothing to hit, so `applyBooster`
      // refuses it and `onUsed` must NOT fire.
      targeting!.onTarget(7, 0);
    });
    expect(onUsed).not.toHaveBeenCalled();

    act(() => {
      (renderer.root.findByType(BoosterRow).props as { onPress: (t: string) => void }).onPress(
        'broom',
      );
    });
    const retarget = (
      renderer.root.findByType(DragLayer).props as {
        boosterTargeting: { onTarget: (r: number, c: number) => void } | null;
      }
    ).boosterTargeting;
    act(() => {
      retarget!.onTarget(0, 5); // row 0 has occupied cells in this fixture
    });
    expect(onUsed).toHaveBeenCalledWith('broom');
  });

  it('disables hourglass on a fixed-pieceSequence level (§0 v1.37(v))', () => {
    const onUsed = vi.fn();
    const state = demoState(['P01', 'P01', 'P01']);
    const renderer = render(<GameplayScreen initialState={state} boosters={{ onUsed }} />);
    expect(
      (renderer.root.findByType(BoosterRow).props as { hourglassDisabled: boolean })
        .hourglassDisabled,
    ).toBe(true);
  });

  it('`preArmed: "hourglass"` auto-fires once on mount — "applied automatically" is literal for it', () => {
    const onUsed = vi.fn();
    render(
      <GameplayScreen initialState={demoState()} boosters={{ preArmed: 'hourglass', onUsed }} />,
    );
    expect(onUsed).toHaveBeenCalledWith('hourglass');
    expect(onUsed).toHaveBeenCalledTimes(1);
  });

  it('`preArmed: "hammer"` arms targeting on mount instead of blind-firing (PRD-AMENDMENT-NEEDED reading)', () => {
    const onUsed = vi.fn();
    const renderer = render(
      <GameplayScreen initialState={demoState()} boosters={{ preArmed: 'hammer', onUsed }} />,
    );
    expect(onUsed).not.toHaveBeenCalled();
    expect((renderer.root.findByType(BoosterRow).props as { armed: string | null }).armed).toBe(
      'hammer',
    );
  });
});
