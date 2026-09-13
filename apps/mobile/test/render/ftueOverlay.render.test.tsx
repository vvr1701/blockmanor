/**
 * `FtueHandCursor` — PRD §7.1.1 "Hand cursor demonstrates drag" (L1 only).
 * Follow-up: `FtueOverlay.tsx`'s `withRepeat(..., -1)` had no test asserting
 * it at all — `ftueScreen.render.test.tsx` mounts the component but never
 * greps `withRepeat` (the same shape `levelMapScreen.render.test.tsx`'s
 * current-medallion pulse was once missing, closed there with the
 * `mockAnimationCalls`-driven `pulseCalls()` helper this file borrows).
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mockAnimationCalls,
  resetMockAnimationCalls,
  setMockReducedMotion,
  type MockAnimationCall,
} from '../mocks/react-native-reanimated';
import { FtueHandCursor } from '../../src/screens/FtueScreen/FtueOverlay';
import { FTUE_HAND_CURSOR_LOOP_MS } from '../../src/screens/FtueScreen/ftueTokens';
import { flattenStyle } from '../contrast';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

/** The one `withRepeat` the loop starts, if any, with the two `withTiming`
 * tweens it wraps. `withSequence(a, b)`'s ARGUMENTS evaluate left to right —
 * `withTiming(1, …)` (the "to board" leg) is called and recorded FIRST,
 * `withTiming(0, …)` (the "to tray" leg) second — and the mock resolves
 * `withSequence` to its LAST argument's already-resolved value, so the entry
 * recorded immediately before `withRepeat` is the "to tray" leg, and the one
 * before that is the "to board" leg. Asserted, not assumed, the same way
 * `levelMapScreen.render.test.tsx`'s `pulseCalls()` pairs a pulse's
 * `withRepeat` with its own `withTiming`. */
function handCursorLoop():
  { toBoard: MockAnimationCall; toTray: MockAnimationCall; repeat: MockAnimationCall } | undefined {
  const i = mockAnimationCalls.findIndex((c) => c.fn === 'withRepeat');
  if (i < 0) return undefined;
  const repeat = mockAnimationCalls[i]!;
  const toTray = mockAnimationCalls[i - 1];
  const toBoard = mockAnimationCalls[i - 2];
  expect(toTray, 'a withRepeat with no tween recorded before it').toBeDefined();
  expect(toBoard, 'a withRepeat with fewer than two tweens recorded before it').toBeDefined();
  expect(toTray!.fn).toBe('withTiming');
  expect(toBoard!.fn).toBe('withTiming');
  // The mock resolves `withSequence` to its last argument's resolved value,
  // so the withRepeat wraps exactly the "to tray" leg's value.
  expect(repeat.toValue).toBe(toTray!.toValue);
  return { toBoard: toBoard!, toTray: toTray!, repeat };
}

beforeEach(() => {
  resetMockAnimationCalls();
  setMockReducedMotion(false);
});

describe('FtueHandCursor (PRD §7.1.1)', () => {
  it('starts an infinite, non-reversing loop between the tray leg (0) and the board leg (1)', () => {
    render(<FtueHandCursor />);

    const loop = handCursorLoop();
    expect(loop).toBeDefined();
    expect(loop!.repeat.config).toEqual({ numberOfReps: -1, reverse: undefined });
    expect(loop!.toTray.toValue).toBe(0);
    expect(loop!.toTray.config).toMatchObject({ duration: FTUE_HAND_CURSOR_LOOP_MS / 2 });
    expect(loop!.toBoard.toValue).toBe(1);
    expect(loop!.toBoard.config).toMatchObject({ duration: FTUE_HAND_CURSOR_LOOP_MS / 2 });
  });

  it('starts NO loop when the OS reduce-motion setting is on (§15 a11y)', () => {
    setMockReducedMotion(true);
    const renderer = render(<FtueHandCursor />);

    expect(handCursorLoop()).toBeUndefined();
    // Still rendered — motion is dropped, not the affordance itself — and
    // resting at a fixed, non-animating position/opacity.
    const dot = renderer.root.findAll((n) => String(n.type) === 'AnimatedView')[0]!;
    expect(flattenStyle(dot.props.style)).toMatchObject({
      transform: [{ translateY: -140 }, { scale: 1 }],
      opacity: 0.9,
    });
  });
});
