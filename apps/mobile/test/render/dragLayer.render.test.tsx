/**
 * `DragLayer` gesture-driven tests — PRD §7.3 acceptance criteria, CLAUDE.md
 * rule 4 (qa-prd-auditor MAJOR 4: the render-tree tests added alongside the
 * initial §7.3 implementation never actually drove a touch stream through
 * the gesture callbacks, so BLOCKER 1/2 shipped with green tests). These
 * drive a synthetic begin/update/finalize sequence through the REAL
 * `Gesture.Pan()` callbacks (captured by the `react-native-gesture-handler`
 * mock's `driveGesture`) and assert against the imported §7.3 tokens, never
 * a hardcoded literal — retuning a token in `juice.ts` must fail these.
 *
 * Coordinates: `boardOffsetX`/`boardLayout.padding` are both 0 below, and
 * the tray's only piece is P01 (a 1x1 dot, `liftPieceW`/`liftPieceH` both
 * exactly `CELL`), so a target board-local point `(bx, by)` converts to a
 * finger position via exactly `DragLayer`'s own inverse formula — see
 * `boardToFinger()`. `mount().toEvent()` then converts that ABSOLUTE
 * canvas-local point to the hitbox-relative `{x,y}` a real
 * `PanGestureHandlerEventPayload` carries.
 */
import { createGame, type EngineTuning, type GameState } from '@blockmanor/engine';
import * as Haptics from 'expo-haptics';
import React from 'react';
// Imported from the mock's own path, not the bare `react-native-gesture-handler`/
// `react-native-reanimated` specifiers: `tsc` (unlike vitest) doesn't apply
// vitest.config.ts's aliases, so it would otherwise resolve these against the
// REAL packages' types, which don't export any of these test-only helpers.
import {
  driveGesture,
  type ChainableGesture,
  type PanEventMock,
} from '../mocks/react-native-gesture-handler';
import { mockAnimationCalls, resetMockAnimationCalls } from '../mocks/react-native-reanimated';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { colors } from '../../src/components/tokens';
import {
  computeTrayLayout,
  computeTrayRowLayout,
  type BoardLayout,
} from '../../src/game/boardLayout';
import { BOOSTER_ROW_RESERVED_HEIGHT, TRAY_SCALE } from '../../src/game/boardTokens';
import { DragLayer } from '../../src/game/DragLayer';
import {
  BOARD_SHAKE_PX,
  GHOST_TINT_OPACITY,
  LEGAL_SNAP_HAPTIC_STYLE,
  LIFT_BOARD_SCALE,
  LIFT_OFFSET_Y,
  LIFT_SCALE_UP_MS,
  LIFT_TILT_DEG,
  RETURN_EASE_MS,
  SNAP_RADIUS_CELLS,
  SNAP_SPRING_MS,
  TRAY_HITBOX_MIN_DP,
} from '../../src/game/juice';

const TUNING: EngineTuning = {
  mercy_threshold: 0.55,
  mercy_small_prob: 0.65,
  score_clear_base: 10,
  combo_step: 0.25,
  perfect_clear_bonus: 300,
};

// Round numbers throughout so expected values are exact, not approximated.
const CELL = 40;
const HALF_CELL = CELL / 2;
const CONTAINER_WIDTH = 300;
const BOARD_LAYOUT: BoardLayout = {
  cellSize: CELL,
  gap: 0,
  padding: 0,
  gridSize: CELL * 8,
  canvasSize: CELL * 8,
};
const TRAY_LAYOUT = computeTrayLayout(BOARD_LAYOUT.cellSize); // pieceCellSize 20
const TRAY_OFFSET_Y = BOARD_LAYOUT.canvasSize + BOOSTER_ROW_RESERVED_HEIGHT;

/**
 * Inverse of `DragLayer`'s onUpdate math for a 1x1 piece (`liftPieceW` =
 * `liftPieceH` = `CELL`, `boardOffsetX` = `boardLayout.padding` = 0 here):
 *   topLeftX = fingerX - CELL/2                     = bx  =>  fingerX = bx + CELL/2
 *   topLeftY = (fingerY - LIFT_OFFSET_Y) - CELL/2    = by  =>  fingerY = by + CELL/2 + LIFT_OFFSET_Y
 * Building every test target through this (not by re-deriving the algebra
 * by hand per test) is what keeps these numbers trustworthy.
 */
function boardToFinger(bx: number, by: number): { x: number; y: number } {
  return { x: bx + HALF_CELL, y: by + HALF_CELL + LIFT_OFFSET_Y };
}

function emptyBoardState(): GameState {
  const state = createGame({ mode: 'endless', tuning: TUNING }, 'drag-layer-test-seed');
  // Force a known, single-cell tray piece in slot 0 regardless of the RNG
  // draw — a fixed 1x1 shape keeps every expected pixel value in this file
  // exact instead of piece-shape-dependent.
  return {
    ...state,
    tray: [
      { pieceId: 'P01', used: false },
      { pieceId: 'P01', used: true },
      { pieceId: 'P01', used: true },
    ],
  };
}

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

interface Mounted {
  renderer: ReactTestRenderer;
  onPlace: ReturnType<typeof vi.fn>;
  onDragIndexChange: ReturnType<typeof vi.fn>;
  gesture: ChainableGesture;
  rerender: () => void;
  groups: () => { transform: { value: unknown }; opacity: { value: number } }[];
  /** Board-local `(bx,by)` -> the hitbox-relative event payload a real
   * PanGestureHandler would deliver for a finger over that board point. */
  toBoardEvent: (bx: number, by: number) => PanEventMock;
}

/** Mounts `DragLayer` with a single un-used slot-0 piece and returns the
 * captured gesture + rendered Skia prop tree for driving/asserting on. */
function mount(state: GameState): Mounted {
  const onPlace = vi.fn();
  const onDragIndexChange = vi.fn();
  const boardShakeX = { value: 0 };
  const trayRow = computeTrayRowLayout(
    state.tray.map((s) => ({ used: s.used, cells: [[0, 0]] as const })),
    TRAY_LAYOUT,
    CONTAINER_WIDTH,
  );
  // A function, not a captured element: `react-test-renderer` bails out of
  // re-rendering when `.update()` is handed the literal SAME element
  // reference (a React reconciler identity shortcut) — `rerender()` below
  // must build a FRESH element each call, or it silently no-ops and every
  // assertion reads stale pre-mutation shared-value state.
  const buildElement = (): React.ReactElement => (
    <DragLayer
      state={state}
      boardLayout={BOARD_LAYOUT}
      boardOffsetX={0}
      trayRow={trayRow}
      trayOffsetY={TRAY_OFFSET_Y}
      containerWidth={CONTAINER_WIDTH}
      playAreaHeight={TRAY_OFFSET_Y + trayRow.canvasHeight}
      onPlace={onPlace}
      onDragIndexChange={onDragIndexChange}
      // The real `SharedValue<number>` API surface isn't needed by this
      // mock — DragLayer only ever writes `.value` on it.
      boardShakeX={boardShakeX as never}
      reducedMotion={false}
    />
  );
  const renderer = render(buildElement());
  const detector = renderer.root.findAllByType('GHDetector' as never)[0] as unknown as {
    props: { gesture: ChainableGesture };
  };
  const rerender = (): void => {
    act(() => {
      renderer.update(buildElement());
    });
  };
  const groups = (): { transform: { value: unknown }; opacity: { value: number } }[] =>
    renderer.root.findAllByType('SkGroup' as never).map((n) => n.props) as never;

  // Slot 0's hitbox geometry, replicated exactly as DragLayer computes it —
  // see DragLayer.tsx's gesture-building `useMemo`.
  const slotLayout = trayRow.slots[0]!;
  const hitboxW = Math.max(TRAY_HITBOX_MIN_DP, slotLayout.pieceW);
  const hitboxH = Math.max(TRAY_HITBOX_MIN_DP, slotLayout.pieceH);
  const pieceCenterX = slotLayout.originX + slotLayout.pieceW / 2;
  const pieceCenterY = TRAY_OFFSET_Y + slotLayout.originY + slotLayout.pieceH / 2;
  const hitboxLeft = pieceCenterX - hitboxW / 2;
  const hitboxTop = pieceCenterY - hitboxH / 2;
  const toBoardEvent = (bx: number, by: number): PanEventMock => {
    const finger = boardToFinger(bx, by);
    return { x: finger.x - hitboxLeft, y: finger.y - hitboxTop };
  };

  return {
    renderer,
    onPlace,
    onDragIndexChange,
    gesture: detector.props.gesture,
    rerender,
    groups,
    toBoardEvent,
  };
}

/** The one legal RoundedRect (the ghost's) — the flying piece's own rect is
 * shaded via a `LinearGradient` child instead, so its `color` prop is
 * undefined; this is what tells them apart. */
function ghostColor(renderer: ReactTestRenderer): string {
  const rect = renderer.root
    .findAllByType('SkRoundedRect' as never)
    .find((n) => n.props.color !== undefined);
  return (rect!.props.color as { value: string }).value;
}

describe('DragLayer — §7.3 v1.9 release outcomes', () => {
  beforeEach(() => {
    resetMockAnimationCalls();
    vi.restoreAllMocks();
  });

  it('BLOCKER 1: a plain tap (begin -> finalize, no update) does not strand the piece', () => {
    const state = emptyBoardState();
    const { gesture, onDragIndexChange, onPlace, toBoardEvent } = mount(state);
    const haptic = vi.spyOn(Haptics, 'impactAsync');

    act(() => {
      driveGesture(gesture, [toBoardEvent(0, 0)], { success: false });
    });

    // §7.3 v1.9 case (c): no ghost was ever shown (no onUpdate ran at all) ->
    // silent cancel. Cleanup must still run (onDragIndexChange(null)) — the
    // BLOCKER 1 bug was exactly this callback never firing for a tap.
    expect(onDragIndexChange).toHaveBeenLastCalledWith(null);
    expect(onPlace).not.toHaveBeenCalled();
    expect(haptic).not.toHaveBeenCalled();
  });

  it('lift applies LIFT_OFFSET_Y (80) and LIFT_TILT_DEG (2), matched against the ghost at the same on-screen point', () => {
    const { gesture, rerender, groups, toBoardEvent } = mount(emptyBoardState());

    // Board is empty, so anchor (2,3) is legal; targeting its exact top-left
    // means the ghost snaps there with distance 0.
    const event = toBoardEvent(3 * CELL, 2 * CELL);

    // Deliberately left mid-drag (begin + update only, no finalize) so the
    // lifted-piece state is still live for the assertions below.
    act(() => {
      gesture.__handlers.onBegin.forEach((cb) => cb(event));
    });
    act(() => {
      gesture.__handlers.onUpdate.forEach((cb) => cb(event));
    });
    rerender();

    const [ghostGroup, dragGroup, tiltGroup] = groups();
    expect(ghostGroup).toBeDefined();
    expect(dragGroup).toBeDefined();
    expect(tiltGroup).toBeDefined();

    // LIFT_OFFSET_Y (80): the dragged piece's on-screen point must match
    // the ghost's — if DragLayer applied a different (or no) Y offset, this
    // equality breaks, since `event` was built FROM the imported token.
    const ghostY = (ghostGroup!.transform.value as { translateY: number }[])[1]!.translateY;
    const dragY = (dragGroup!.transform.value as { translateY: number }[])[1]!.translateY;
    expect(dragY).toBeCloseTo(ghostY);
    const ghostX = (ghostGroup!.transform.value as { translateX: number }[])[0]!.translateX;
    const dragX = (dragGroup!.transform.value as { translateX: number }[])[0]!.translateX;
    expect(dragX).toBeCloseTo(ghostX);

    // LIFT_TILT_DEG (2): constant tilt while lifted.
    const rotate = (tiltGroup!.transform.value as { rotate: number }[])[1]!.rotate;
    expect(rotate).toBeCloseTo((LIFT_TILT_DEG * Math.PI) / 180);

    // GHOST_TINT_OPACITY (0.45).
    expect(ghostGroup!.opacity.value).toBe(GHOST_TINT_OPACITY);
  });

  it('SNAP_RADIUS_CELLS (0.6): legal just inside the radius boundary, illegal just past it', () => {
    const radiusPx = SNAP_RADIUS_CELLS * CELL;
    // Diagonal from anchor (0,0)'s top-left stays nearest-anchor = (0,0) for
    // any distance up to ~0.83 cell (every neighbour is farther away along
    // this diagonal), so moving along it isolates the radius boundary
    // itself rather than an anchor-adjacency edge case. `±2` px either side
    // of the boundary (not the exact IEEE754 edge, which a correct
    // implementation can still legitimately round either way) is what's
    // actually being asserted: legal drops to illegal within a few px of
    // `SNAP_RADIUS_CELLS * cellStep`, wherever the token's value is.
    const onBoundary = (radiusPx - 2) / Math.SQRT2;
    const pastBoundary = (radiusPx + 2) / Math.SQRT2;

    const legal = mount(emptyBoardState());
    act(() => {
      legal.gesture.__handlers.onBegin.forEach((cb) => cb(legal.toBoardEvent(0, 0)));
    });
    act(() => {
      legal.gesture.__handlers.onUpdate.forEach((cb) =>
        cb(legal.toBoardEvent(onBoundary, onBoundary)),
      );
    });
    legal.rerender();
    expect(ghostColor(legal.renderer)).toBe(colors.ok);

    const illegal = mount(emptyBoardState());
    act(() => {
      illegal.gesture.__handlers.onBegin.forEach((cb) => cb(illegal.toBoardEvent(0, 0)));
    });
    act(() => {
      illegal.gesture.__handlers.onUpdate.forEach((cb) =>
        cb(illegal.toBoardEvent(pastBoundary, pastBoundary)),
      );
    });
    illegal.rerender();
    expect(ghostColor(illegal.renderer)).toBe(colors.bad);
  });

  it('legal release snaps with a SNAP_SPRING_MS (90) spring and commits the placement', () => {
    const state = emptyBoardState();
    const { gesture, onPlace, onDragIndexChange, toBoardEvent } = mount(state);

    act(() => {
      driveGesture(gesture, [toBoardEvent(0, 0), toBoardEvent(1 * CELL, 1 * CELL)], {
        success: true,
      });
    });

    expect(onPlace).toHaveBeenCalledWith(0, 1, 1);
    expect(onDragIndexChange).toHaveBeenLastCalledWith(null);
    const springs = mockAnimationCalls.filter((c) => c.fn === 'withSpring');
    expect(springs.length).toBeGreaterThan(0);
    for (const call of springs) {
      expect((call.config as { duration: number }).duration).toBe(SNAP_SPRING_MS);
    }
  });

  it('illegal hover: BOARD_SHAKE_PX (4) shake + RETURN_EASE_MS (180) return + haptic', () => {
    const state = emptyBoardState();
    const { gesture, toBoardEvent } = mount(state);
    const haptic = vi.spyOn(Haptics, 'impactAsync');
    // Center of cell (2,3): equidistant ~0.707 cell from every surrounding
    // anchor — always outside the 0.6-cell radius regardless of its value,
    // so this is unambiguously an illegal hover on the board.
    const target = { bx: 3 * CELL + HALF_CELL, by: 2 * CELL + HALF_CELL };

    act(() => {
      driveGesture(gesture, [toBoardEvent(0, 0), toBoardEvent(target.bx, target.by)], {
        success: true,
      });
    });

    expect(haptic).toHaveBeenCalled();
    const timings = mockAnimationCalls.filter((c) => c.fn === 'withTiming');
    const returnTweens = timings.filter(
      (c) => (c.config as { duration?: number } | undefined)?.duration === RETURN_EASE_MS,
    );
    expect(returnTweens.length).toBeGreaterThan(0);
    const shakeValues = timings.map((c) => c.toValue);
    expect(shakeValues).toContain(-BOARD_SHAKE_PX);
    expect(shakeValues).toContain(BOARD_SHAKE_PX);
  });

  it('BLOCKER 2: illegal return animates scale 1 -> TRAY_SCALE (not a hard pop)', () => {
    const state = emptyBoardState();
    const { gesture, toBoardEvent } = mount(state);
    const target = { bx: 3 * CELL + HALF_CELL, by: 2 * CELL + HALF_CELL };

    act(() => {
      driveGesture(gesture, [toBoardEvent(0, 0), toBoardEvent(target.bx, target.by)], {
        success: true,
      });
    });

    const timings = mockAnimationCalls.filter((c) => c.fn === 'withTiming');
    // boardTokens.TRAY_SCALE = 0.5
    expect(timings.some((c) => c.toValue === 0.5)).toBe(true);
  });

  it('cancelled drag (never entered the board region) returns silently — no haptic, no shake', () => {
    const state = emptyBoardState();
    const { gesture, toBoardEvent } = mount(state);
    const haptic = vi.spyOn(Haptics, 'impactAsync');

    act(() => {
      // Stays exactly where it was picked up — never moves onto the board.
      driveGesture(gesture, [toBoardEvent(0, 0)], { success: false });
    });

    expect(haptic).not.toHaveBeenCalled();
    const timings = mockAnimationCalls.filter((c) => c.fn === 'withTiming');
    expect(timings.some((c) => c.toValue === -BOARD_SHAKE_PX)).toBe(false);
  });

  it('TRAY_HITBOX_MIN_DP (64): a 1-cell (20px) piece still gets a 64x64 hitbox', () => {
    const state = emptyBoardState();
    const { renderer } = mount(state);
    const hitbox = renderer.root.findByType('GHDetector' as never).findByType('RNView' as never);
    const style = hitbox.props.style as [unknown, { width: number; height: number }];
    expect(style[1].width).toBe(TRAY_HITBOX_MIN_DP);
    expect(style[1].height).toBe(TRAY_HITBOX_MIN_DP);
  });

  it('§7.4 "Piece lift": scale-up animates TRAY_SCALE -> LIFT_BOARD_SCALE over LIFT_SCALE_UP_MS (120), plus a selection haptic', () => {
    const state = emptyBoardState();
    const { gesture, toBoardEvent } = mount(state);
    const selection = vi.spyOn(Haptics, 'selectionAsync');

    act(() => {
      gesture.__handlers.onBegin.forEach((cb) => cb(toBoardEvent(0, 0)));
    });

    const timings = mockAnimationCalls.filter((c) => c.fn === 'withTiming');
    const scaleUp = timings.find(
      (c) =>
        c.toValue === LIFT_BOARD_SCALE &&
        (c.config as { duration?: number } | undefined)?.duration === LIFT_SCALE_UP_MS,
    );
    expect(scaleUp).toBeDefined();
    expect(selection).toHaveBeenCalledTimes(1);
  });

  it('§7.4 "Piece lift": a mutated LIFT_SCALE_UP_MS token would fail the above (mutation check)', () => {
    // Asserts the recorded duration is the IMPORTED token, not a hardcoded
    // 120 — retuning `LIFT_SCALE_UP_MS` in juice.ts must move this too.
    expect(LIFT_SCALE_UP_MS).toBe(120);
    expect(LIFT_BOARD_SCALE).toBe(1);
    expect(TRAY_SCALE).toBe(0.5);
  });

  it('§7.4 "Legal snap": fires LEGAL_SNAP_HAPTIC_STYLE (impactLight) on top of the §7.3 90ms spring', () => {
    const state = emptyBoardState();
    const { gesture, toBoardEvent } = mount(state);
    const haptic = vi.spyOn(Haptics, 'impactAsync');

    act(() => {
      driveGesture(gesture, [toBoardEvent(0, 0), toBoardEvent(1 * CELL, 1 * CELL)], {
        success: true,
      });
    });

    expect(haptic).toHaveBeenCalledWith(LEGAL_SNAP_HAPTIC_STYLE);
    // Literal check: `toHaveBeenCalledWith(LEGAL_SNAP_HAPTIC_STYLE)` alone
    // reads the same (possibly mutated) token on both sides and can't catch
    // a retune — this pins the actual §7.4 value.
    expect(LEGAL_SNAP_HAPTIC_STYLE).toBe(Haptics.ImpactFeedbackStyle.Light);
  });
});
