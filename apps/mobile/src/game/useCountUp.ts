import { useEffect, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

/** ~60fps; the count is a number on screen, not an animation worth a worklet. */
const FRAME_MS = 16;

/**
 * §8.3 "score count-up 900ms": 0 → `target`, ease-out, over `durationMs`.
 * Reduced motion shows the final value at once (§15 a11y).
 */
export function useCountUp(target: number, durationMs: number): number {
  const reducedMotion = useReducedMotion();
  const [value, setValue] = useState(reducedMotion ? target : 0);
  useEffect(() => {
    if (reducedMotion || durationMs <= 0) {
      setValue(target);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t >= 1) clearInterval(id);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [target, durationMs, reducedMotion]);
  return value;
}
