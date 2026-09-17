import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { View, type ViewStyle } from 'react-native';

// design-tokens.md §Material signatures — glassFlush gradient.
const GLASS_COLORS = ['#FFFFFF', '#EAE7DF'] as const;

/**
 * GlassFlush — the shared flush-glass fill (secondary button, chat "mine" bubble,
 * chart bars): gradient + 1pt top highlight, NO outer lift. It is an absolute
 * background layer; the owner supplies the radius, `overflow-hidden` and the
 * `rgba(28,27,24,0.07)` hairline so both the border and the highlight read.
 */
export function GlassFlush({ direction = 'diagonal' }: { direction?: 'diagonal' | 'vertical' }) {
  return (
    <View pointerEvents="none" style={Fill}>
      <LinearGradient
        colors={GLASS_COLORS}
        // diagonal ≈ 165° (buttons, bubbles); vertical = 180° (chart bars).
        start={{ x: 0, y: 0 }}
        end={direction === 'vertical' ? { x: 0, y: 1 } : { x: 0.35, y: 1 }}
        style={Fill}
      />
      {/* Inset by 1pt so it sits inside the owner's hairline instead of over it. */}
      <View style={TopHighlight} />
    </View>
  );
}

const Fill: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

const TopHighlight: ViewStyle = {
  position: 'absolute',
  top: 1,
  left: 1,
  right: 1,
  height: 1,
  backgroundColor: 'rgba(255,255,255,0.9)',
};
