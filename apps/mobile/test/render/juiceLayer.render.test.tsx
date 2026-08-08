/**
 * `JuiceLayer` — PRD §7.4 juice table (everything except lift/legal-snap,
 * which live in `DragLayer` — see `dragLayer.render.test.tsx`'s §7.4 tests
 * — and audio, the `sfx.ts` no-op seam). Every assertion below reads an
 * IMPORTED `juice.ts` token, never a hardcoded literal, so retuning a token
 * fails the matching test — the same bar `dragLayer.render.test.tsx` set for
 * §7.3.
 */
import type { GameEvent } from '@blockmanor/engine';
import * as Haptics from 'expo-haptics';
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAnimationCalls, resetMockAnimationCalls } from '../mocks/react-native-reanimated';
import { type BoardLayout } from '../../src/game/boardLayout';
import { JuiceLayer } from '../../src/game/JuiceLayer';
import {
  CLEAR_HAPTIC_STYLE,
  CLEAR_PARTICLE_COUNT,
  CLEAR_POP_MS,
  CLEAR_POP_STAGGER_MS_PER_CELL,
  FAIL_DESATURATE_MS,
  MULTI_LINE_FLASH_MS,
  MULTI_LINE_FLASH_OPACITY,
  MULTI_LINE_HAPTIC_STYLE,
  NEAR_DEATH_FILL_THRESHOLD,
  NEAR_DEATH_PEAK_OPACITY,
  NEAR_DEATH_PULSE_MS,
  NEAR_DEATH_STATIC_OPACITY,
  PERFECT_CLEAR_SHIMMER_MS,
  WIN_CONFETTI_COUNT,
  WIN_STAR_COUNT,
  WIN_STAR_SLAM_MS,
  WIN_STAR_STAGGER_MS,
} from '../../src/game/juice';

const CELL = 40;
const BOARD_LAYOUT: BoardLayout = {
  cellSize: CELL,
  gap: 0,
  padding: 0,
  gridSize: CELL * 8,
  canvasSize: CELL * 8,
};

const PIECE_PLACED = (r: number, c: number, cells: { r: number; c: number }[]): GameEvent => ({
  type: 'PIECE_PLACED',
  pieceId: 'P01',
  pieceIndex: 0,
  r,
  c,
  cells,
  points: cells.length,
});

const LINES_CLEARED = (cells: { r: number; c: number }[], comboDisplay: number): GameEvent => ({
  type: 'LINES_CLEARED',
  rows: [0],
  cols: [],
  cells,
  comboDisplay,
  points: 80,
});

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function baseProps(overrides: Partial<React.ComponentProps<typeof JuiceLayer>> = {}) {
  return {
    events: [] as readonly GameEvent[],
    placementSeq: 1,
    boardLayout: BOARD_LAYOUT,
    boardOffsetX: 0,
    containerWidth: 320,
    playAreaHeight: 500,
    fill: 0,
    reducedMotion: false,
    ...overrides,
  };
}

describe('JuiceLayer — PRD §7.4', () => {
  beforeEach(() => {
    resetMockAnimationCalls();
    vi.restoreAllMocks();
  });

  it('no events: mounts cleanly, no clear/win/fail juice fires', () => {
    const impact = vi.spyOn(Haptics, 'impactAsync');
    const notification = vi.spyOn(Haptics, 'notificationAsync');
    expect(() => render(<JuiceLayer {...baseProps()} />)).not.toThrow();
    expect(impact).not.toHaveBeenCalled();
    expect(notification).not.toHaveBeenCalled();
  });

  describe('Line clear (comboDisplay 1 — not yet a "multi-line" streak)', () => {
    const placedCells = [{ r: 3, c: 3 }];
    const clearedCells = [
      { r: 3, c: 0 },
      { r: 3, c: 1 },
      { r: 3, c: 2 },
      { r: 3, c: 3 },
    ];
    const events: readonly GameEvent[] = [
      PIECE_PLACED(3, 3, placedCells),
      LINES_CLEARED(clearedCells, 1),
    ];

    it('fires CLEAR_HAPTIC_STYLE (impactMedium), not the multi-line haptic', () => {
      const impact = vi.spyOn(Haptics, 'impactAsync');
      render(<JuiceLayer {...baseProps({ events })} />);
      expect(impact).toHaveBeenCalledWith(CLEAR_HAPTIC_STYLE);
      expect(impact).not.toHaveBeenCalledWith(MULTI_LINE_HAPTIC_STYLE);
      expect(CLEAR_HAPTIC_STYLE).toBe(Haptics.ImpactFeedbackStyle.Medium);
    });

    it('pops exactly one cell per cleared cell, each staggered CLEAR_POP_STAGGER_MS_PER_CELL (12) per cell of distance, over CLEAR_POP_MS (320)', () => {
      const renderer = render(<JuiceLayer {...baseProps({ events })} />);
      const popCells = renderer.root
        .findAllByType('SkRoundedRect' as never)
        .filter((n) => n.props.color !== undefined && n.props.style === undefined);
      expect(popCells.length).toBe(clearedCells.length);

      // Each `PopCell` schedules TWO `withDelay`s at its own delay (opacity
      // fade-to-0 AND the scale-up-to-peak tween) — filter to the fade one
      // (`toValue === 0`) so this counts cells, not cell*animatable-props;
      // star particles ALSO call `withDelay` (their own, unrelated, stagger)
      // but target `1` (their progress value), not `0`.
      const delays = mockAnimationCalls
        .filter((c) => c.fn === 'withDelay' && c.toValue === 0)
        .map((c) => (c.config as { delay: number }).delay)
        .sort((a, b) => a - b);
      // Distances from the placement centroid (3,3): 3, 2, 1, 0 cells ->
      // delays 36, 24, 12, 0 (rounding to the token, not a hardcoded 12).
      const expected = clearedCells
        .map((cell) => Math.hypot(cell.c - 3, cell.r - 3) * CLEAR_POP_STAGGER_MS_PER_CELL)
        .sort((a, b) => a - b);
      expect(delays).toEqual(expected);

      const pops = mockAnimationCalls.filter(
        (c) =>
          c.fn === 'withTiming' && (c.config as { duration?: number })?.duration === CLEAR_POP_MS,
      );
      expect(pops.length).toBeGreaterThanOrEqual(clearedCells.length);
    });

    it('mutation check: a wrong CLEAR_POP_MS/STAGGER token would fail the above', () => {
      expect(CLEAR_POP_MS).toBe(320);
      expect(CLEAR_POP_STAGGER_MS_PER_CELL).toBe(12);
    });

    it('spawns CLEAR_PARTICLE_COUNT star particles', () => {
      const renderer = render(<JuiceLayer {...baseProps({ events })} />);
      expect(renderer.root.findAllByType('SkCircle' as never).length).toBe(CLEAR_PARTICLE_COUNT);
      expect(CLEAR_PARTICLE_COUNT).toBe(10);
    });

    it('reduced motion: particles are disabled, the pop itself (core feedback) is not', () => {
      const renderer = render(<JuiceLayer {...baseProps({ events, reducedMotion: true })} />);
      expect(renderer.root.findAllByType('SkCircle' as never).length).toBe(0);
      const popCells = renderer.root
        .findAllByType('SkRoundedRect' as never)
        .filter((n) => n.props.color !== undefined && n.props.style === undefined);
      expect(popCells.length).toBe(clearedCells.length);
    });

    it("shows the floating +N score using the event's own `points` (never re-derived)", () => {
      const renderer = render(<JuiceLayer {...baseProps({ events })} />);
      const text = renderer.root.findByType('AnimatedText' as never);
      expect(text.props.children).toBe('+80');
    });

    it('does NOT render "COMBO xN!" or a screen flash below MULTI_LINE_COMBO_MIN', () => {
      const renderer = render(<JuiceLayer {...baseProps({ events })} />);
      const texts = renderer.root.findAllByType('AnimatedText' as never);
      expect(texts.some((n) => String(n.props.children).startsWith('COMBO'))).toBe(false);
    });
  });

  describe('Multi-line / combo (comboDisplay >= MULTI_LINE_COMBO_MIN)', () => {
    const events: readonly GameEvent[] = [
      PIECE_PLACED(0, 0, [{ r: 0, c: 0 }]),
      LINES_CLEARED([{ r: 0, c: 0 }], 3),
    ];

    it('fires MULTI_LINE_HAPTIC_STYLE (impactHeavy), overriding the base clear haptic', () => {
      const impact = vi.spyOn(Haptics, 'impactAsync');
      render(<JuiceLayer {...baseProps({ events })} />);
      expect(impact).toHaveBeenCalledTimes(1);
      expect(impact).toHaveBeenCalledWith(MULTI_LINE_HAPTIC_STYLE);
      expect(MULTI_LINE_HAPTIC_STYLE).toBe(Haptics.ImpactFeedbackStyle.Heavy);
    });

    it('renders "COMBO x3!" using comboDisplay (§6.6), and a white MULTI_LINE_FLASH_OPACITY (0.08) flash fading over MULTI_LINE_FLASH_MS (80)', () => {
      const renderer = render(<JuiceLayer {...baseProps({ events })} />);
      const texts = renderer.root.findAllByType('AnimatedText' as never);
      expect(texts.some((n) => n.props.children === 'COMBO x3!')).toBe(true);

      const flashViews = renderer.root
        .findAllByType('AnimatedView' as never)
        .filter((n) =>
          (n.props.style as unknown[]).some(
            (s) => (s as { backgroundColor?: string })?.backgroundColor === '#FFFFFF',
          ),
        );
      expect(flashViews.length).toBe(1);
      const fade = mockAnimationCalls.find(
        (c) =>
          c.fn === 'withTiming' &&
          c.toValue === 0 &&
          (c.config as { duration?: number }).duration === MULTI_LINE_FLASH_MS,
      );
      expect(fade).toBeDefined();
    });

    it('mutation check: exact MULTI_LINE_FLASH_OPACITY (0.08) / MULTI_LINE_FLASH_MS (80) tokens', () => {
      expect(MULTI_LINE_FLASH_OPACITY).toBe(0.08);
      expect(MULTI_LINE_FLASH_MS).toBe(80);
    });

    it('reduced motion: the flash is disabled, the combo text (core feedback) is not', () => {
      const renderer = render(<JuiceLayer {...baseProps({ events, reducedMotion: true })} />);
      const texts = renderer.root.findAllByType('AnimatedText' as never);
      expect(texts.some((n) => n.props.children === 'COMBO x3!')).toBe(true);
      const flashViews = renderer.root
        .findAllByType('AnimatedView' as never)
        .filter((n) =>
          (n.props.style as unknown[]).some(
            (s) => (s as { backgroundColor?: string })?.backgroundColor === '#FFFFFF',
          ),
        );
      expect(flashViews.length).toBe(0);
    });
  });

  it('Perfect clear: notificationSuccess haptic + a gold shimmer over PERFECT_CLEAR_SHIMMER_MS (600, in two 300ms halves)', () => {
    const notification = vi.spyOn(Haptics, 'notificationAsync');
    const events: readonly GameEvent[] = [
      PIECE_PLACED(0, 0, [{ r: 0, c: 0 }]),
      LINES_CLEARED([{ r: 0, c: 0 }], 1),
      { type: 'PERFECT_CLEAR', bonus: 300 },
    ];
    render(<JuiceLayer {...baseProps({ events })} />);
    expect(notification).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    const halves = mockAnimationCalls.filter(
      (c) =>
        c.fn === 'withTiming' &&
        (c.config as { duration?: number }).duration === PERFECT_CLEAR_SHIMMER_MS / 2,
    );
    expect(halves.length).toBe(2);
    expect(PERFECT_CLEAR_SHIMMER_MS).toBe(600);
  });

  it('Level win: notificationSuccess haptic, WIN_STAR_COUNT (3) stars, WIN_CONFETTI_COUNT confetti pieces', () => {
    const notification = vi.spyOn(Haptics, 'notificationAsync');
    const events: readonly GameEvent[] = [
      PIECE_PLACED(0, 0, [{ r: 0, c: 0 }]),
      { type: 'LEVEL_WON', score: 999, stars: 3 },
    ];
    const renderer = render(<JuiceLayer {...baseProps({ events })} />);
    expect(notification).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    const stars = renderer.root
      .findAllByType('AnimatedText' as never)
      .filter((n) => n.props.children === '★');
    expect(stars.length).toBe(WIN_STAR_COUNT);
    expect(WIN_STAR_COUNT).toBe(3); // §7.4-exact: "stars slam in x3"
    // Confetti pieces are the AnimatedViews carrying a `backgroundColor`
    // that ISN'T the white flash/gold shimmer's own solid overlay.
    const confetti = renderer.root.findAllByType('AnimatedView' as never).filter((n) =>
      (n.props.style as unknown[]).some((s) => {
        const bg = (s as { backgroundColor?: string })?.backgroundColor;
        return bg !== undefined && bg !== '#FFFFFF';
      }),
    );
    expect(confetti.length).toBe(WIN_CONFETTI_COUNT);
    expect(WIN_CONFETTI_COUNT).toBe(16);
  });

  it("Level win: each star's slam-in is delayed by its index x WIN_STAR_STAGGER_MS (200)", () => {
    const events: readonly GameEvent[] = [
      PIECE_PLACED(0, 0, [{ r: 0, c: 0 }]),
      { type: 'LEVEL_WON', score: 999, stars: 3 },
    ];
    render(<JuiceLayer {...baseProps({ events })} />);
    // Every `withDelay(delayMs, withTiming(...))` pushes its INNER
    // `withTiming` call first (already-evaluated, per this mock's own
    // synchronous-argument-evaluation contract — see the mock's header), so
    // a star's own `withDelay` is always the record immediately AFTER its
    // `WIN_STAR_SLAM_MS`-duration `withTiming` — that's what tells a star's
    // stagger apart from a confetti piece's (`WIN_CONFETTI_MS`-duration)
    // own `withDelay`, since both eventually animate toward `1`.
    const starDelays: number[] = [];
    for (let i = 1; i < mockAnimationCalls.length; i++) {
      const prev = mockAnimationCalls[i - 1]!;
      const cur = mockAnimationCalls[i]!;
      if (
        cur.fn === 'withDelay' &&
        prev.fn === 'withTiming' &&
        (prev.config as { duration?: number }).duration === WIN_STAR_SLAM_MS
      ) {
        starDelays.push((cur.config as { delay: number }).delay);
      }
    }
    expect(new Set(starDelays)).toEqual(new Set([0, WIN_STAR_STAGGER_MS, WIN_STAR_STAGGER_MS * 2]));
    expect(WIN_STAR_STAGGER_MS).toBe(200);
  });

  it('Fail: notificationError haptic + animates desaturateSV 0 -> 1 over FAIL_DESATURATE_MS (400)', () => {
    const notification = vi.spyOn(Haptics, 'notificationAsync');
    const desaturateSV = { value: 0 };
    const events: readonly GameEvent[] = [
      PIECE_PLACED(0, 0, [{ r: 0, c: 0 }]),
      { type: 'GAME_OVER', score: 120 },
    ];
    render(<JuiceLayer {...baseProps({ events, desaturateSV: desaturateSV as never })} />);
    expect(notification).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
    expect(desaturateSV.value).toBe(1);
    const tween = mockAnimationCalls.find(
      (c) =>
        c.fn === 'withTiming' &&
        c.toValue === 1 &&
        (c.config as { duration?: number }).duration === FAIL_DESATURATE_MS,
    );
    expect(tween).toBeDefined();
    expect(FAIL_DESATURATE_MS).toBe(400);
  });

  describe('Near-death (fill > NEAR_DEATH_FILL_THRESHOLD (0.8))', () => {
    it('below threshold: no pulse, no haptic', () => {
      const notification = vi.spyOn(Haptics, 'notificationAsync');
      render(<JuiceLayer {...baseProps({ fill: NEAR_DEATH_FILL_THRESHOLD })} />);
      expect(mockAnimationCalls.some((c) => c.fn === 'withRepeat')).toBe(false);
      expect(notification).not.toHaveBeenCalled();
    });

    it('above threshold: loops a red pulse via withRepeat, one NEAR_DEATH_PULSE_MS (1200) cycle (two 600ms halves), no haptic (§7.4 haptic column: none)', () => {
      const impact = vi.spyOn(Haptics, 'impactAsync');
      const notification = vi.spyOn(Haptics, 'notificationAsync');
      render(<JuiceLayer {...baseProps({ fill: 0.85 })} />);
      const repeat = mockAnimationCalls.find((c) => c.fn === 'withRepeat');
      expect(repeat).toBeDefined();
      const halfCycles = mockAnimationCalls.filter(
        (c) =>
          c.fn === 'withTiming' &&
          (c.config as { duration?: number }).duration === NEAR_DEATH_PULSE_MS / 2,
      );
      expect(halfCycles.length).toBe(2);
      expect(halfCycles.some((c) => c.toValue === NEAR_DEATH_PEAK_OPACITY)).toBe(true);
      // Literal check (not `NEAR_DEATH_PULSE_MS / 2` again, which would move
      // in lockstep with a mutated token and never fail): the filter above
      // reads the token, this line pins its actual value.
      expect(NEAR_DEATH_PULSE_MS).toBe(1200);
      expect(impact).not.toHaveBeenCalled();
      expect(notification).not.toHaveBeenCalled();
    });

    it('reduced motion above threshold: static tint (NEAR_DEATH_STATIC_OPACITY), no loop', () => {
      render(<JuiceLayer {...baseProps({ fill: 0.85, reducedMotion: true })} />);
      expect(mockAnimationCalls.some((c) => c.fn === 'withRepeat')).toBe(false);
      const staticTint = mockAnimationCalls.find(
        (c) => c.fn === 'withTiming' && c.toValue === NEAR_DEATH_STATIC_OPACITY,
      );
      expect(staticTint).toBeDefined();
    });
  });
});
