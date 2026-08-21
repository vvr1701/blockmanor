/**
 * `LevelSession` — PRD §7.5's progression loop: "Play -> L1 -> win -> advance
 * to L2 -> play", plus the §7.5 FAIL path (goal progress on the terminal
 * board, free/unlimited Retry resetting the board). Drives real placements
 * through `DragLayer.onPlace` (same technique `gameplayScreen.render.test.tsx`
 * / `ftueScreen.render.test.tsx` already use) against two small,
 * hand-crafted, deterministic levels — a one-placement WIN and a
 * one-placement FAIL — so this proves the WIRING (advance-on-win,
 * reset-on-retry, the §14 events, `useMetaStore.currentLevel`), never
 * re-proving the engine's own clear/win/lose rules.
 *
 * `@blockmanor/content`'s `getLevel` is mocked to serve these two fixtures
 * instead of the real 60 shipped levels — solving a REAL generated level
 * deterministically from a test would need a bot/solver, which is exactly
 * what this test must not re-implement (that's `packages/content`'s own
 * balance-harness scope, §7.9).
 */
import type * as ContentModule from '@blockmanor/content';
import type { LevelJson } from '@blockmanor/content';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DragLayer } from '../../src/game/DragLayer';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { WinScreen } from '../../src/screens/WinScreen';
import { FailScreen } from '../../src/screens/FailScreen';
import { useMetaStore } from '../../src/state/useMetaStore';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

// `vi.mock` factories are hoisted above every other top-level statement in
// this file (including `const` declarations) — `vi.hoisted` is the
// documented escape hatch so the fixtures below can still be built with a
// normal helper function instead of one giant inline literal.
const { WIN_LEVEL, FAIL_LEVEL } = vi.hoisted(() => {
  // `findFullLines` (packages/engine `clearing.ts`) full-scans the WHOLE
  // board on every placement, not just the lines the new piece touched — so
  // these fixtures must never let an UNRELATED row/column sit fully occupied
  // at rest, or that line clears/wins the instant ANY piece lands anywhere.
  // Every row and column below always keeps at least one empty cell except
  // the exact one(s) this test's single placement is meant to complete.

  /**
   * WIN fixture: row 0 (cols 1-7, one a `crate`) and column 0 (rows 1-7) are
   * pre-filled; the 7x7 interior (rows/cols 1-7) is left EMPTY so no other
   * line is anywhere near complete. Dropping the sequence's single `P01`
   * (1x1) dot at (0,0) completes row 0 AND column 0 simultaneously (15
   * cells, 2 lines) -> destroys the crate -> the `{type:'crate',count:1}`
   * goal hits 0 -> `LEVEL_WON`.
   * Score: placement (1) + clear(base 10 x 15 cells x 2 lines x 1.0) = 301,
   * plus a `PERFECT_CLEAR` +300 flat bonus (the 15 cleared cells ARE this
   * fixture's entire filled content, so the board is empty after) = 601 —
   * crosses `s2:200` but not `s3:700`, exercising §7.5's "star 2/3 = score
   * thresholds" around a real boundary.
   */
  const WIN_LEVEL = {
    id: 900,
    chapter: 1,
    seedSalt: 'test-win',
    prefill: [
      { r: 0, c: 1, type: 'filled' },
      { r: 0, c: 2, type: 'filled' },
      { r: 0, c: 3, type: 'crate' },
      { r: 0, c: 4, type: 'filled' },
      { r: 0, c: 5, type: 'filled' },
      { r: 0, c: 6, type: 'filled' },
      { r: 0, c: 7, type: 'filled' },
      { r: 1, c: 0, type: 'filled' },
      { r: 2, c: 0, type: 'filled' },
      { r: 3, c: 0, type: 'filled' },
      { r: 4, c: 0, type: 'filled' },
      { r: 5, c: 0, type: 'filled' },
      { r: 6, c: 0, type: 'filled' },
      { r: 7, c: 0, type: 'filled' },
    ],
    goals: [{ type: 'crate', count: 1 }],
    pieceWeightOverrides: {},
    mercy: true,
    stars: { s2: 200, s3: 700 },
    ivySpreadInterval: 3,
    ivyMaxTiles: 16,
    pieceSequence: ['P01'],
  };

  /**
   * FAIL fixture: every cell filled EXCEPT a diagonal-ish scatter that keeps
   * every row and column with exactly its own spare, none orthogonally
   * adjacent to another: (0,0)+(0,1) (row 0's 2 spares), (1,0) (col 0's 2nd
   * spare), then one isolated spare per remaining row/col at (2,2) (3,3)
   * (4,4) (5,5) (6,6) (7,7). `P01` dropped at (0,0) leaves (0,1) empty in
   * row 0 and (1,0) empty in column 0 — so THAT placement clears nothing.
   * Every remaining empty cell is isolated (no empty neighbour anywhere on
   * the board), so the tray's other two pieces (`P02`/`P03`, both 2-cell)
   * fit nowhere -> `GAME_OVER` on this one placement, goal untouched (no
   * clear ever happened to credit either crate).
   */
  const FAIL_EMPTY = new Set(['0,0', '0,1', '1,0', '2,2', '3,3', '4,4', '5,5', '6,6', '7,7']);
  const FAIL_CRATES = new Set(['7,0', '7,1']);
  const failPrefill: { r: number; c: number; type: string }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const key = `${r},${c}`;
      if (FAIL_EMPTY.has(key)) continue;
      failPrefill.push({ r, c, type: FAIL_CRATES.has(key) ? 'crate' : 'filled' });
    }
  }

  const FAIL_LEVEL = {
    id: 901,
    chapter: 1,
    seedSalt: 'test-fail',
    prefill: failPrefill,
    goals: [{ type: 'crate', count: 2 }],
    pieceWeightOverrides: {},
    mercy: true,
    stars: { s2: 200, s3: 500 },
    ivySpreadInterval: 3,
    ivyMaxTiles: 16,
    pieceSequence: ['P01', 'P02', 'P03'],
  };

  return { WIN_LEVEL, FAIL_LEVEL };
});

vi.mock('@blockmanor/content', async (importOriginal) => {
  const actual = await importOriginal<typeof ContentModule>();
  const byId: Record<number, LevelJson> = {
    900: WIN_LEVEL as LevelJson,
    901: FAIL_LEVEL as LevelJson,
  };
  return { ...actual, getLevel: (id: number) => byId[id] };
});

import { LevelSession } from '../../src/game/LevelSession';
import { track } from '../../src/services/analytics';

const trackMock = vi.mocked(track);

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function place(renderer: ReactTestRenderer, pieceIndex: number, r: number, c: number): void {
  const dragLayer = renderer.root.findByType(DragLayer);
  act(() => {
    (dragLayer.props as { onPlace: (i: number, r: number, c: number) => void }).onPlace(
      pieceIndex,
      r,
      c,
    );
  });
}

beforeEach(() => {
  trackMock.mockClear();
  useMetaStore.setState({ currentLevel: 900 });
});

describe('LevelSession (PRD §7.5 progression loop)', () => {
  it('mounts GameplayScreen for `useMetaStore.currentLevel` and fires level_start{id,attempt:1}', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock).toHaveBeenCalledWith('level_start', { id: 900, attempt: 1 });
  });

  it('a win swaps in WinScreen with the right score/stars, fires level_complete, and "Next level" advances currentLevel', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 0, 0);

    expect(renderer.root.findAllByType(WinScreen).length).toBe(1);
    const win = renderer.root.findByType(WinScreen);
    expect(win.props.score).toBe(601);
    expect(win.props.stars).toBe(2); // crosses s2:200, not s3:700

    expect(trackMock).toHaveBeenCalledWith(
      'level_complete',
      expect.objectContaining({ id: 900, score: 601, stars: 2, continues: 0, boosters_used: 0 }),
    );

    act(() => {
      (win.props as { onNext: () => void }).onNext();
    });
    expect(useMetaStore.getState().currentLevel).toBe(901);
  });

  it('a fail swaps in FailScreen with goal progress and fires level_fail', () => {
    useMetaStore.setState({ currentLevel: 901 });
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 0, 0);

    expect(renderer.root.findAllByType(FailScreen).length).toBe(1);
    const fail = renderer.root.findByType(FailScreen);
    expect(fail.props.levelId).toBe(901);
    expect(fail.props.goals).toEqual([
      expect.objectContaining({ type: 'crate', remaining: 2, total: 2 }),
    ]);

    expect(trackMock).toHaveBeenCalledWith(
      'level_fail',
      expect.objectContaining({ id: 901, goal_progress_pct: 0 }),
    );
    const [, failParams] = trackMock.mock.calls.find(([name]) => name === 'level_fail')!;
    expect((failParams as { fill_ratio: number }).fill_ratio).toBeCloseTo(56 / 64, 5);
  });

  it('Retry re-mounts a fresh GameplayScreen and fires level_start with attempt:2', () => {
    useMetaStore.setState({ currentLevel: 901 });
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 0, 0);

    const fail = renderer.root.findByType(FailScreen);
    act(() => {
      (fail.props as { onRetry: () => void }).onRetry();
    });

    expect(renderer.root.findAllByType(FailScreen).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock).toHaveBeenCalledWith('level_start', { id: 901, attempt: 2 });
  });

  it('"Level map" (fail) calls onExit — the ghost has somewhere honest to go, not a dead end', () => {
    useMetaStore.setState({ currentLevel: 901 });
    const onExit = vi.fn();
    const renderer = render(<LevelSession onExit={onExit} />);
    place(renderer, 0, 0, 0);

    const fail = renderer.root.findByType(FailScreen);
    act(() => {
      (fail.props as { onLevelMap: () => void }).onLevelMap();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('a level past the shipped range calls onExit instead of rendering a dead end (§12.9)', () => {
    useMetaStore.setState({ currentLevel: 999999 });
    const onExit = vi.fn();
    render(<LevelSession onExit={onExit} />);
    expect(onExit).toHaveBeenCalled();
  });
});
