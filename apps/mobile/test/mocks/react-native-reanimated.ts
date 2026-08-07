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
  fn: 'withTiming' | 'withSpring';
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

const Animated = { View: 'AnimatedView' };
export default Animated;
