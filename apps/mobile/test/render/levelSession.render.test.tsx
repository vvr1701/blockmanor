/**
 * `LevelSession` — PRD §7.5's progression loop: "Play -> L1 -> win -> advance
 * to L2 -> play", plus the §7.5 FAIL path (goal progress on the terminal
 * board, free/unlimited Retry resetting the board). Drives real placements
 * through `DragLayer.onPlace` (same technique `gameplayScreen.render.test.tsx`
 * / `ftueScreen.render.test.tsx` already use) against small, hand-crafted,
 * deterministic levels — a one-placement WIN, a one-placement FAIL, a
 * one-placement `'completed'` (goal-less scripted level exhausting its
 * `pieceSequence`, §8.2/§4.3), and a WIN sitting at `MAX_LEVEL_ID` — so this
 * proves the WIRING (advance-on-win, reset-on-retry, the §14 events,
 * `useMetaStore.currentLevel`), never re-proving the engine's own
 * clear/win/lose/exhaustion rules.
 *
 * `@blockmanor/content`'s `getLevel` is mocked to serve these fixtures
 * instead of the real 60 shipped levels — solving a REAL generated level
 * deterministically from a test would need a bot/solver, which is exactly
 * what this test must not re-implement (that's `packages/content`'s own
 * balance-harness scope, §7.9).
 *
 * Fake timers throughout: §7.5 audit M-2 holds `GameplayScreen` mounted for
 * `WIN_HOLD_MS`/`FAIL_HOLD_MS` after a terminal placement (so the board-side
 * win/fail juice actually plays) before swapping in `WinScreen`/`FailScreen`
 * — every place-then-assert-the-result-screen test below has to advance past
 * that hold, and the very first win/fail test asserts the hold itself (the
 * screen has NOT swapped yet immediately after the placement).
 */
import type * as ContentModule from '@blockmanor/content';
import type { LevelJson } from '@blockmanor/content';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DragLayer } from '../../src/game/DragLayer';
import { FAIL_HOLD_MS, WIN_HOLD_MS } from '../../src/game/juice';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { WinScreen } from '../../src/screens/WinScreen';
import { FailScreen } from '../../src/screens/FailScreen';
import { useMetaStore } from '../../src/state/useMetaStore';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

// `vi.mock` factories are hoisted above every other top-level statement in
// this file (including `const` declarations) — `vi.hoisted` is the
// documented escape hatch so the fixtures below can still be built with a
// normal helper function instead of one giant inline literal.
const { WIN_LEVEL, FAIL_LEVEL, COMPLETED_LEVEL, CEILING_LEVEL_BASE } = vi.hoisted(() => {
  // `findFullLines` (packages/engine `clearing.ts`) full-scans the WHOLE
  // board on every placement, not just the lines the new piece touched — so
  // these fixtures must never let an UNRELATED row/column sit fully occupied
  // at rest, or that line clears/wins the instant ANY piece lands anywhere.
  // Every row and column below always keeps at least one empty cell except
  // the exact one(s) this test's single placement is meant to complete.

  /**
   * A row-0 + column-0 board (one prefill cell a `crate`, one goal
   * `{type:'crate',count:1}`): dropping the sequence's single `P01` (1x1)
   * dot at (0,0) completes row 0 AND column 0 simultaneously (15 cells, 2
   * lines) -> destroys the crate -> the goal hits 0 -> `LEVEL_WON`. Shared by
   * `WIN_LEVEL` (id 10) and `CEILING_LEVEL_BASE` (§7.5 audit M-1's
   * MAX_LEVEL_ID fixture) so the win-shaped board isn't duplicated twice.
   * Score: placement (1) + clear(base 10 x 15 cells x 2 lines x 1.0) = 301,
   * plus a `PERFECT_CLEAR` +300 flat bonus (the 15 cleared cells ARE this
   * fixture's entire filled content, so the board is empty after) = 601 —
   * crosses `s2:200` but not `s3:700`, exercising §7.5's "star 2/3 = score
   * thresholds" around a real boundary.
   */
  function makeWinLevel(id: number, seedSalt: string): Record<string, unknown> {
    return {
      id,
      chapter: 1,
      seedSalt,
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
  }

  const WIN_LEVEL = makeWinLevel(10, 'test-win');
  // `id` gets overwritten to the REAL `MAX_LEVEL_ID` inside the
  // `@blockmanor/content` mock factory below, once `importOriginal` can
  // resolve it — placeholder here.
  const CEILING_LEVEL_BASE = makeWinLevel(0, 'test-ceiling');

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
    id: 11,
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

  /**
   * §7.5 audit B-1: a goal-less scripted level (`goals: []`, like FTUE's
   * L1-L3) with a single-piece `pieceSequence`. Placing that one `P01`
   * (empty board, no line clear) leaves the tray fully `used` -> the next
   * refill finds nothing left in the sequence -> `status: 'completed'`,
   * `SEQUENCE_EXHAUSTED` — neither `'won'` nor `'lost'`, the exact case
   * `LevelSession` didn't handle before this fix.
   */
  const COMPLETED_LEVEL = {
    id: 12,
    chapter: 1,
    seedSalt: 'test-completed',
    prefill: [],
    goals: [],
    pieceWeightOverrides: {},
    mercy: true,
    stars: { s2: 5, s3: 10 },
    ivySpreadInterval: 3,
    ivyMaxTiles: 16,
    pieceSequence: ['P01'],
  };

  return { WIN_LEVEL, FAIL_LEVEL, COMPLETED_LEVEL, CEILING_LEVEL_BASE };
});

vi.mock('@blockmanor/content', async (importOriginal) => {
  const actual = await importOriginal<typeof ContentModule>();
  // §7.5 audit M-1: served at the REAL `MAX_LEVEL_ID` so "win while already
  // at the content ceiling" is exercised against the actual ceiling value,
  // not a number this test file guesses independently.
  const ceilingLevel = { ...CEILING_LEVEL_BASE, id: actual.MAX_LEVEL_ID };
  const byId: Record<number, LevelJson> = {
    10: WIN_LEVEL as LevelJson,
    11: FAIL_LEVEL as LevelJson,
    12: COMPLETED_LEVEL as LevelJson,
    [actual.MAX_LEVEL_ID]: ceilingLevel as LevelJson,
  };
  return { ...actual, getLevel: (id: number) => byId[id] };
});

import { MAX_LEVEL_ID } from '@blockmanor/content';
import { LevelSession } from '../../src/game/LevelSession';
import { track } from '../../src/services/analytics';

const trackMock = vi.mocked(track);

// §7.5 re-audit item 6: every `render()` below stayed mounted past its own
// test, still subscribed to `useMetaStore` — the next test's `setState` then
// re-rendered those zombies outside `act`, the source of the "An update to
// LevelSession inside a test was not wrapped in act(...)" spam. Track every
// renderer this file creates and unmount them all in `afterEach`, so no test
// has to remember to do it individually.
const activeRenderers: ReactTestRenderer[] = [];

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  activeRenderers.push(renderer);
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

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  trackMock.mockClear();
  useMetaStore.setState({ currentLevel: 10 });
});

afterEach(() => {
  while (activeRenderers.length > 0) {
    const renderer = activeRenderers.pop()!;
    act(() => {
      renderer.unmount();
    });
  }
  vi.useRealTimers();
});

describe('LevelSession (PRD §7.5 progression loop)', () => {
  it('mounts GameplayScreen for `useMetaStore.currentLevel` and fires level_start{id,attempt:1}', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock).toHaveBeenCalledWith('level_start', { id: 10, attempt: 1 });
  });

  it('a win HOLDS the board (§7.5 audit M-2) before swapping in WinScreen, fires level_complete, and "Next level" advances currentLevel', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 0, 0);

    // The win beat (stars slam, confetti) plays on the still-mounted board —
    // `WinScreen` must not have replaced it yet.
    expect(renderer.root.findAllByType(WinScreen).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock).toHaveBeenCalledWith(
      'level_complete',
      expect.objectContaining({ id: 10, score: 601, stars: 2, continues: 0, boosters_used: 0 }),
    );

    advance(WIN_HOLD_MS);

    expect(renderer.root.findAllByType(WinScreen).length).toBe(1);
    const win = renderer.root.findByType(WinScreen);
    expect(win.props.score).toBe(601);
    expect(win.props.stars).toBe(2); // crosses s2:200, not s3:700

    act(() => {
      (win.props as { onNext: () => void }).onNext();
    });
    expect(useMetaStore.getState().currentLevel).toBe(11);
  });

  it('a fail HOLDS the board (§7.5 audit M-2) before swapping in FailScreen with goal progress, and fires level_fail', () => {
    useMetaStore.setState({ currentLevel: 11 });
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 0, 0);

    expect(renderer.root.findAllByType(FailScreen).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock).toHaveBeenCalledWith(
      'level_fail',
      expect.objectContaining({ id: 11, goal_progress_pct: 0 }),
    );

    advance(FAIL_HOLD_MS);

    expect(renderer.root.findAllByType(FailScreen).length).toBe(1);
    const fail = renderer.root.findByType(FailScreen);
    expect(fail.props.levelId).toBe(11);
    expect(fail.props.goals).toEqual([
      expect.objectContaining({ type: 'crate', remaining: 2, total: 2 }),
    ]);

    const [, failParams] = trackMock.mock.calls.find(([name]) => name === 'level_fail')!;
    expect((failParams as { fill_ratio: number }).fill_ratio).toBeCloseTo(56 / 64, 5);
  });

  it('a goal-less scripted level EXHAUSTING its pieceSequence (status "completed", §8.2/§4.3) swaps in WinScreen — §7.5 audit B-1', () => {
    useMetaStore.setState({ currentLevel: 12 });
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 3, 3); // empty board, no line clear — pure exhaustion

    expect(renderer.root.findAllByType(WinScreen).length).toBe(0);
    advance(WIN_HOLD_MS);

    expect(renderer.root.findAllByType(WinScreen).length).toBe(1);
    const win = renderer.root.findByType(WinScreen);
    expect(win.props.score).toBe(1); // 1-cell placement, no clear
    expect(win.props.stars).toBe(1); // below s2:5

    expect(trackMock).toHaveBeenCalledWith(
      'level_complete',
      expect.objectContaining({ id: 12, score: 1, stars: 1, continues: 0, boosters_used: 0 }),
    );
  });

  it('Retry re-mounts a fresh GameplayScreen and fires level_start with attempt:2', () => {
    useMetaStore.setState({ currentLevel: 11 });
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 0, 0);
    advance(FAIL_HOLD_MS);

    const fail = renderer.root.findByType(FailScreen);
    act(() => {
      (fail.props as { onRetry: () => void }).onRetry();
    });

    expect(renderer.root.findAllByType(FailScreen).length).toBe(0);
    expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
    expect(trackMock).toHaveBeenCalledWith('level_start', { id: 11, attempt: 2 });
  });

  it('"Level map" (fail) calls onExit — the ghost has somewhere honest to go, not a dead end', () => {
    useMetaStore.setState({ currentLevel: 11 });
    const onExit = vi.fn();
    const renderer = render(<LevelSession onExit={onExit} />);
    place(renderer, 0, 0, 0);
    advance(FAIL_HOLD_MS);

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

  it('unmounting mid-hold clears the deferred phase-swap timer — no throw, no late setState (§7.5 re-audit item 6)', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 0, 0); // WIN_LEVEL: arms the WIN_HOLD_MS phase-swap timer

    // Unmount BEFORE the hold elapses — `LevelSession`'s own
    // `useEffect(() => clearPhaseTimer, [clearPhaseTimer])` cleanup must
    // clear the pending `setTimeout` so it never fires `setPhase` on an
    // unmounted component.
    act(() => {
      renderer.unmount();
    });
    // Already unmounted — don't let `afterEach`'s cleanup double-unmount it.
    activeRenderers.pop();

    expect(() => advance(WIN_HOLD_MS)).not.toThrow();
  });

  it('winning AT MAX_LEVEL_ID exits instead of persisting an unreachable currentLevel — §7.5 audit M-1', () => {
    useMetaStore.setState({ currentLevel: MAX_LEVEL_ID });
    const onExit = vi.fn();
    const renderer = render(<LevelSession onExit={onExit} />);
    place(renderer, 0, 0, 0);
    advance(WIN_HOLD_MS);

    const win = renderer.root.findByType(WinScreen);
    act(() => {
      (win.props as { onNext: () => void }).onNext();
    });

    // Real action (Home), not a silent no-op, and `currentLevel` never
    // advances past what `getLevel` can resolve.
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(useMetaStore.getState().currentLevel).toBe(MAX_LEVEL_ID);
  });
});
