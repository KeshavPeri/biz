import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { EASE_OUT, useMotion } from '@/components/motion/use-motion';

/**
 * ListItemFade — roadmap §2.3: wraps one row/card in a short list (inbox,
 * private-deal labels, discover results, submission history) so it fades in
 * on add, fades out on remove, and slides its neighbours via `LinearTransition`
 * when the list reshuffles. Dense lists (e.g. chat messages) don't use this —
 * they stay still per §8.
 *
 * Pair with reanimated's `<LayoutAnimationConfig skipEntering>` around the
 * list container so the FIRST render of the list doesn't stagger in (only
 * genuine adds/removes after that animate) — that component's `skipEntering`
 * ref flips to false right after mount, which is the same intent as the
 * roadmap's `initial={false}`.
 */
export function ListItemFade({ children, style, className }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  const { reduce, t } = useMotion();

  if (reduce) {
    return <View style={style} className={className}>{children}</View>;
  }

  return (
    <Animated.View
      style={style}
      className={className}
      entering={FadeIn.duration(t(180)).easing(EASE_OUT)}
      exiting={FadeOut.duration(t(120))}
      layout={LinearTransition.duration(t(200))}
    >
      {children}
    </Animated.View>
  );
}
