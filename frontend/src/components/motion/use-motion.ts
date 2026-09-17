import { Easing, useReducedMotion } from 'react-native-reanimated';

// Motion budget (design-direction §8): ease-out for entrances, ease-out-strong for
// transitions that travel. Every primitive in components/motion shares these.
export const EASE_OUT = Easing.out(Easing.quad);
export const EASE_OUT_STRONG = Easing.out(Easing.cubic);

/**
 * useMotion — the one gate for the OS "Reduce Motion" setting. `t(ms)` returns 0
 * under reduce-motion so any `withTiming` built on it becomes instant.
 */
export function useMotion() {
  const reduce = useReducedMotion();
  return {
    reduce,
    t: (ms: number) => (reduce ? 0 : ms),
  };
}
