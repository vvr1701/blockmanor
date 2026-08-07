/**
 * Minimal `react-native-gesture-handler` stand-in for render-tree tests — see
 * vitest.config.ts. `GestureDetector` renders a thin host wrapper around its
 * child AND forwards the `gesture` prop onto that host node — real RNGH
 * attaches a native gesture responder instead, but exposing the gesture
 * object this way is what lets a test actually DRIVE a synthetic touch
 * stream through it (`renderer.root.findAllByType('GHDetector')[i].props.gesture`),
 * rather than only proving the tree mounts. `Gesture.Pan()` is a chainable
 * builder that records every `.onBegin`/`.onUpdate`/`.onFinalize` callback
 * (not just the last one — DragLayer only ever registers one of each, but a
 * mock that silently dropped a re-registration would be a worse trap than
 * one that keeps all of them) so `driveGesture()` below can call them.
 */
import { createElement, type ReactElement } from 'react';

export const GestureHandlerRootView = 'GHRootView';

export interface ChainableGesture {
  minDistance: (value: number) => ChainableGesture;
  shouldCancelWhenOutside: (value: boolean) => ChainableGesture;
  onBegin: (cb: (e: PanEventMock) => void) => ChainableGesture;
  onUpdate: (cb: (e: PanEventMock) => void) => ChainableGesture;
  onEnd: (cb: (e: PanEventMock, success: boolean) => void) => ChainableGesture;
  onFinalize: (cb: (e: PanEventMock, success: boolean) => void) => ChainableGesture;
  /** Test-only: every callback registered via the chain above, in call order. */
  __handlers: {
    onBegin: ((e: PanEventMock) => void)[];
    onUpdate: ((e: PanEventMock) => void)[];
    onEnd: ((e: PanEventMock, success: boolean) => void)[];
    onFinalize: ((e: PanEventMock, success: boolean) => void)[];
  };
}

export interface PanEventMock {
  x: number;
  y: number;
}

export function GestureDetector({
  children,
  gesture,
}: {
  children: ReactElement;
  gesture: ChainableGesture;
}): ReactElement {
  return createElement('GHDetector', { gesture }, children);
}

function chainable(): ChainableGesture {
  const handlers: ChainableGesture['__handlers'] = {
    onBegin: [],
    onUpdate: [],
    onEnd: [],
    onFinalize: [],
  };
  const gesture: ChainableGesture = {
    minDistance: () => gesture,
    shouldCancelWhenOutside: () => gesture,
    onBegin: (cb) => {
      handlers.onBegin.push(cb);
      return gesture;
    },
    onUpdate: (cb) => {
      handlers.onUpdate.push(cb);
      return gesture;
    },
    onEnd: (cb) => {
      handlers.onEnd.push(cb);
      return gesture;
    },
    onFinalize: (cb) => {
      handlers.onFinalize.push(cb);
      return gesture;
    },
    __handlers: handlers,
  };
  return gesture;
}

export const Gesture = {
  Pan: chainable,
  Tap: chainable,
};

/**
 * Test helper: replay a begin -> updates -> finalize touch stream through a
 * captured `ChainableGesture`. `moves[0]` is the begin position; every
 * SUBSEQUENT entry fires `onUpdate`. A single-element `moves` therefore
 * means "begin, then release with no movement at all" — a real tap, which
 * on both platforms never reaches `onUpdate` (RNGH BLOCKER 1: DOWN->UP with
 * no MOVE goes BEGAN->FAILED directly). Getting this wrong here would mean
 * this mock could never have caught that regression in the first place.
 */
export function driveGesture(
  gesture: ChainableGesture,
  moves: readonly PanEventMock[],
  options: { success: boolean } = { success: true },
): void {
  const [first, ...updates] = moves;
  if (first) {
    for (const cb of gesture.__handlers.onBegin) cb(first);
  }
  for (const move of updates) {
    for (const cb of gesture.__handlers.onUpdate) cb(move);
  }
  const last = moves[moves.length - 1] ?? { x: 0, y: 0 };
  for (const cb of gesture.__handlers.onFinalize) cb(last, options.success);
}
