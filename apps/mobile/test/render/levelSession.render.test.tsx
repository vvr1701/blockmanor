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
import type { GameState } from '@blockmanor/engine';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DragLayer } from '../../src/game/DragLayer';
import { FAIL_HOLD_MS, WIN_HOLD_MS } from '../../src/game/juice';
import { GameplayScreen } from '../../src/screens/GameplayScreen';
import { WinScreen } from '../../src/screens/WinScreen';
import { FailScreen } from '../../src/screens/FailScreen';
import { mmkvStorage } from '../../src/state/persist';
import { useMetaStore } from '../../src/state/useMetaStore';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

// `vi.mock` factories are hoisted above every other top-level statement in
// this file (including `const` declarations) — `vi.hoisted` is the
// documented escape hatch so the fixtures below can still be built with a
// normal helper function instead of one giant inline literal.
const { WIN_LEVEL, FAIL_LEVEL, COMPLETED_LEVEL, CEILING_LEVEL_BASE, RESEED } = vi.hoisted(() => {
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

  /**
   * §0 v1.17 (ii)'s fixture: the ONLY one here with no `pieceSequence`, so
   * the tray is actually drawn from the seeded PRNG (§6.2) and therefore
   * actually observes the run seed. Every other fixture pins its draw, which
   * is exactly why they cannot guard this rule. Empty board, no goals — it is
   * never played, only mounted and read.
   */
  const RESEED = {
    id: 13,
    chapter: 1,
    seedSalt: 'test-reseed',
    prefill: [],
    goals: [],
    pieceWeightOverrides: {},
    mercy: true,
    stars: { s2: 200, s3: 700 },
    ivySpreadInterval: 3,
    ivyMaxTiles: 16,
  };

  return { WIN_LEVEL, FAIL_LEVEL, COMPLETED_LEVEL, CEILING_LEVEL_BASE, RESEED };
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
    13: RESEED as LevelJson,
    [actual.MAX_LEVEL_ID]: ceilingLevel as LevelJson,
  };
  return { ...actual, getLevel: (id: number) => byId[id] };
});

import { MAX_LEVEL_ID } from '@blockmanor/content';
import { LevelSession, levelRunSeed } from '../../src/game/LevelSession';
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
  // `attempts` is persisted per level id (§0 v1.17) — reset it too, or one
  // test's retries become the next test's starting attempt number.
  useMetaStore.setState({ currentLevel: 10, attempts: {}, stars: {} });
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

  /**
   * §0 v1.17 ruling A. `attempt` used to be `useState(1)` inside
   * `LevelSession` — session-local, so every app relaunch re-emitted
   * `level_start{attempt:1}` for a level the player had already failed
   * repeatedly. §7.9 states L15's target as "win rate 35-45% FIRST attempt"
   * and §3 gates on per-level quit rate; both use that param as their
   * denominator, so the counter has to outlive the process.
   *
   * This test kills the process the only way a unit test can: unmount, wipe
   * the in-memory store back to its defaults, and rehydrate `useMetaStore`
   * from MMKV through zustand's own `persist.rehydrate()` — the same path a
   * cold start takes. Mutation-checked: reverting `LevelSession` to
   * `useState(1)` makes the post-rehydrate assertion fail (it emits
   * `attempt: 1` again).
   */
  it('the attempt counter SURVIVES a store rehydrate — attempt is persisted per level, not session-local (§0 v1.17)', async () => {
    useMetaStore.setState({ currentLevel: 11, attempts: {} });

    // Session 1: run 1 (mount) -> fail -> Retry -> run 2.
    const first = render(<LevelSession onExit={vi.fn()} />);
    expect(trackMock).toHaveBeenCalledWith('level_start', { id: 11, attempt: 1 });
    place(first, 0, 0, 0);
    advance(FAIL_HOLD_MS);
    act(() => {
      (first.root.findByType(FailScreen).props as { onRetry: () => void }).onRetry();
    });
    expect(trackMock).toHaveBeenCalledWith('level_start', { id: 11, attempt: 2 });

    // The counter reached MMKV, not just React state.
    const onDisk = mmkvStorage.getItem('meta') as string;
    expect(JSON.parse(onDisk)).toMatchObject({ state: { attempts: { '11': 2 } } });

    // --- app killed: in-memory state is gone, MMKV is not ---
    act(() => {
      first.unmount();
    });
    activeRenderers.pop();
    useMetaStore.setState({ attempts: {} });
    // `setState` above also wrote the wiped state through to storage; put the
    // disk image back, because a killed process does not erase MMKV.
    mmkvStorage.setItem('meta', onDisk);
    trackMock.mockClear();

    // --- cold start: zustand's real rehydrate, off the real storage adapter ---
    await useMetaStore.persist.rehydrate();
    expect(useMetaStore.getState().attempts).toEqual({ '11': 2 });

    render(<LevelSession onExit={vi.fn()} />);

    // Run 3 of L11 — NOT a second `attempt: 1`.
    expect(trackMock).toHaveBeenCalledWith('level_start', { id: 11, attempt: 3 });
    expect(trackMock).not.toHaveBeenCalledWith('level_start', { id: 11, attempt: 1 });
  });

  /**
   * §0 v1.17 ruling B: already the built behaviour, made normative. The rule
   * is that `attempt` stays IN the run seed — drop it and every Retry replays
   * the identical losing draw, the wall §1 P2 forbids.
   *
   * Asserting `levelRunSeed(11, 2) !== levelRunSeed(11, 1)` would only prove
   * that template interpolation works; the seed has to be observed where the
   * player feels it, on the TRAY the engine actually deals. So this mounts
   * `RESEED` (the one fixture with no `pieceSequence` — a pinned
   * sequence ignores the run seed entirely, §4.3) three times at persisted
   * attempts 1/2/3 and compares the dealt trays. Mutation-checked: pinning
   * the seed at the call site (`levelRunSeed(json.id, 1)`) reds this.
   */
  it('each attempt DEALS A DIFFERENT TRAY — Retry re-seeds the run, it does not replay the loss (§0 v1.17)', () => {
    function trayAtAttempt(attempt: number): string {
      // One prior run recorded => this mount is run `attempt` (§0 v1.17's
      // "advances at run start").
      useMetaStore.setState({ currentLevel: 13, attempts: { '13': attempt - 1 } });
      trackMock.mockClear();
      const renderer = render(<LevelSession onExit={vi.fn()} />);
      const { initialState } = renderer.root.findByType(GameplayScreen).props as {
        initialState: GameState;
      };
      const tray = initialState.tray.map((slot) => slot.pieceId).join(',');
      // The mount really was at this attempt number — otherwise a comparison
      // of three identical mounts could pass by accident.
      expect(trackMock).toHaveBeenCalledWith('level_start', { id: 13, attempt });
      act(() => {
        renderer.unmount();
      });
      activeRenderers.pop();
      return tray;
    }

    const trays = [1, 2, 3].map(trayAtAttempt);
    expect(trays.every((t) => t.length > 0)).toBe(true);
    expect(new Set(trays).size).toBe(3);
  });

  it('the run seed keeps the LEVEL pinned and only the attempt varying (§0 v1.17 — seedSalt is the level identity)', () => {
    expect(levelRunSeed(11, 2)).not.toBe(levelRunSeed(11, 1));
    expect(levelRunSeed(12, 1)).not.toBe(levelRunSeed(11, 1));
  });

  it('advancing to a level already attempted resumes ITS counter instead of faking a first attempt (§0 v1.17)', () => {
    useMetaStore.setState({ currentLevel: 10, attempts: { '11': 4 } });
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 0, 0);
    advance(WIN_HOLD_MS);
    act(() => {
      (renderer.root.findByType(WinScreen).props as { onNext: () => void }).onNext();
    });

    expect(trackMock).toHaveBeenCalledWith('level_start', { id: 11, attempt: 5 });
  });

  /**
   * `migrate` only ever runs for an OLDER version, so a corrupt v2 blob (a
   * truncated write, a hand-edited MMKV file) reaches `nextAttempt` exactly
   * as stored. `null` used to throw on mount — a §12.9 dead end with no way
   * back — and a string used to concatenate into `level_start.attempt`,
   * putting `'x1'` into a typed `number` §14 param.
   */
  it.each([
    ['null (truncated blob)', null],
    ['a non-numeric entry (hand-edited blob)', { '11': 'x' }],
  ])(
    'a corrupt persisted `attempts` — %s — still starts at attempt 1, no crash (§12.9)',
    (_l, attempts) => {
      useMetaStore.setState({
        currentLevel: 11,
        attempts: attempts as unknown as Record<string, number>,
      });

      const renderer = render(<LevelSession onExit={vi.fn()} />);

      expect(renderer.root.findAllByType(GameplayScreen).length).toBe(1);
      expect(trackMock).toHaveBeenCalledWith('level_start', { id: 11, attempt: 1 });
    },
  );

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

  /**
   * §7.10: the level map's medallions render "1-3 stars", and before this the
   * star count `WinScreen` displays died with the session — `useMetaStore`
   * persisted `currentLevel` and `attempts` but nothing per-level. These two
   * assert the WRITE, on both terminal-win paths (`LEVEL_WON`, and the
   * goal-less `'completed'` exhaustion path that has no `LEVEL_WON` event).
   * Drop either `persistStars` call and exactly one of them reds.
   */
  it('§7.10: a win PERSISTS the star count the level map renders', () => {
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 0, 0);
    advance(WIN_HOLD_MS);

    expect(renderer.root.findByType(WinScreen).props.stars).toBe(2);
    // The same number the screen showed, now outliving the session.
    expect(useMetaStore.getState().stars['10']).toBe(2);
  });

  it('§7.10: the `pieceSequence`-exhaustion win path persists stars too', () => {
    useMetaStore.setState({ currentLevel: 12 });
    const renderer = render(<LevelSession onExit={vi.fn()} />);
    place(renderer, 0, 3, 3);
    advance(WIN_HOLD_MS);

    expect(renderer.root.findByType(WinScreen).props.stars).toBe(1);
    expect(useMetaStore.getState().stars['12']).toBe(1);
  });

  it('§7.10: §7.5s "Level map" ghost routes to `onLevelMap` when the mount point supplies one, and still falls back to `onExit`', () => {
    useMetaStore.setState({ currentLevel: 11 });
    const onExit = vi.fn();
    const onLevelMap = vi.fn();
    const renderer = render(<LevelSession onExit={onExit} onLevelMap={onLevelMap} />);
    place(renderer, 0, 0, 0);
    advance(FAIL_HOLD_MS);

    act(() => {
      (renderer.root.findByType(FailScreen).props as { onLevelMap: () => void }).onLevelMap();
    });
    expect(onLevelMap).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();

    const bare = render(<LevelSession onExit={onExit} />);
    place(bare, 0, 0, 0);
    advance(FAIL_HOLD_MS);
    act(() => {
      (bare.root.findByType(FailScreen).props as { onLevelMap: () => void }).onLevelMap();
    });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
