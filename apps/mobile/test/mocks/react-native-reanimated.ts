/**
 * Minimal `react-native-reanimated` stand-in for render-tree tests — see
 * vitest.config.ts. No worklet/UI-thread semantics: `withTiming`/`withSpring`
 * resolve synchronously (calling any completion callback with `true`) and
 * shared values are a plain mutable `{ value }` ref. That's intentionally
 * NOT how the real drag animates — `dragAnchors.test.ts` covers the actual
 * snap/radius math standalone; this mock's job is to let component render
 * functions run to completion AND to record every `withTiming`/`withSpring`
 * call (`mockAnimationCalls`) so a test can assert the exact duration/toValue
 * DragLayer actually used — e.g. that `SNAP_SPRING_MS` (not some hardcoded
 * 90) is the value that reached `withSpring`.
 */
import { useRef } from 'react';

export interface SharedValueMock<T> {
  value: T;
}

export function useSharedValue<T>(initial: T): SharedValueMock<T> {
  const ref = useRef<SharedValueMock<T>>({ value: initial });
  return ref.current;
}

export function useDerivedValue<T>(fn: () => T): SharedValueMock<T> {
  return { value: fn() };
}

export function useAnimatedStyle<T>(fn: () => T): T {
  return fn();
}

export function useReducedMotion(): boolean {
  return false;
}

type AnimCallback = (finished?: boolean) => void;

export interface MockAnimationCall {
  fn: 'withTiming' | 'withSpring' | 'withDelay' | 'withRepeat';
  toValue: unknown;
  config: unknown;
}

export const mockAnimationCalls: MockAnimationCall[] = [];

export function resetMockAnimationCalls(): void {
  mockAnimationCalls.length = 0;
}

export function withTiming<T>(toValue: T, config?: unknown, callback?: AnimCallback): T {
  mockAnimationCalls.push({ fn: 'withTiming', toValue, config });
  callback?.(true);
  return toValue;
}

export function withSpring<T>(toValue: T, config?: unknown, callback?: AnimCallback): T {
  mockAnimationCalls.push({ fn: 'withSpring', toValue, config });
  callback?.(true);
  return toValue;
}

export function withSequence<T>(...values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

/**
 * Real Reanimated defers `animation` by `delayMs` on the UI thread. This mock
 * (like every other animator here) resolves synchronously: `animation` was
 * already fully evaluated (its own `withTiming`/`withSpring` already fired
 * and pushed its own `mockAnimationCalls` entry) by the time it's passed in
 * as an argument — `withDelay` just records the delay alongside it so a test
 * can still assert the requested delay value.
 */
export function withDelay<T>(delayMs: number, animation: T): T {
  mockAnimationCalls.push({ fn: 'withDelay', toValue: animation, config: { delay: delayMs } });
  return animation;
}

export function withRepeat<T>(animation: T, numberOfReps?: number, reverse?: boolean): T {
  mockAnimationCalls.push({
    fn: 'withRepeat',
    toValue: animation,
    config: { numberOfReps, reverse },
  });
  return animation;
}

export function cancelAnimation<T>(_sharedValue: SharedValueMock<T>): void {
  // No-op: nothing async is pending in this synchronous mock.
}

export function runOnJS<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
  return fn;
}

export const Easing = {
  out: (fn: (t: number) => number) => fn,
  in: (fn: (t: number) => number) => fn,
  ease: (t: number): number => t,
  back:
    () =>
    (t: number): number =>
      t,
};

const Animated = { View: 'AnimatedView', Text: 'AnimatedText' };
export default Animated;
