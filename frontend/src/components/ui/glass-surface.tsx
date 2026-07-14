import React from 'react';
import { View, type ViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * GlassSurface — Inflo's "pillow-glass" material (task 6.7, docs/design-tokens.md
 * §Material signatures). The gradient is the SHARED language; the outer lift is the
 * RESERVED signature.
 *
 *  - variant="flush"  → glassFlush: gradient + hairline + inset top highlight, NO outer
 *    lift. Shared material for secondary buttons, chat bubbles, chart bars.
 *  - variant="pillow" → pillowGlass: the same, PLUS the outer lift. Reserved for
 *    nav-active only (used later in 6.5).
 *
 * The gradient (#FFFFFF → #EAE7DF, ~165°) is drawn with expo-linear-gradient so it
 * renders on BOTH web and native (a CSS gradient className would be web-only). The 1px
 * top highlight is drawn as an explicit overlay so the convex read survives on native,
 * where inset box-shadows aren't supported.
 */

const GLASS_COLORS = ['#FFFFFF', '#EAE7DF'] as const;

export type GlassVariant = 'flush' | 'pillow';

type GlassSurfaceProps = ViewProps & {
  variant?: GlassVariant;
  /** Tailwind classes for the outer surface — radius, padding, sizing, etc. */
  className?: string;
  children?: React.ReactNode;
};

export function GlassSurface({
  variant = 'flush',
  className,
  children,
  style,
  ...props
}: GlassSurfaceProps) {
  // Shadow via inline style, not a shadow-* className. GlassSurface with
  // variant="pillow" mounts/unmounts on every bottom-nav tab switch (see
  // BottomNav), and a conditionally-present shadow-* class is a documented
  // NativeWind native-only bug (nativewind/nativewind#1536/#1557/#1711):
  // it can race React Navigation's context init and throw "Couldn't find a
  // navigation context." glassInset (flush) is inset-only — no native RN
  // equivalent — so it contributes nothing on native anyway; the TopHighlight
  // overlay below already carries that read on native.
  const shadowStyle =
    variant === 'pillow'
      ? {
          shadowColor: '#1C1B18',
          shadowOffset: { width: 0, height: 5 },
          shadowOpacity: 0.09,
          shadowRadius: 6,
          elevation: 3,
        }
      : undefined;

  return (
    <View
      className={`overflow-hidden border border-[rgba(28,27,24,0.07)] ${className ?? ''}`}
      style={[shadowStyle, style]}
      {...props}
    >
      <LinearGradient
        colors={GLASS_COLORS}
        // ~165°: mostly top→bottom with a slight lean, matching the style tile.
        start={{ x: 0, y: 0 }}
        end={{ x: 0.35, y: 1 }}
        style={StyleFill}
      />
      {/* 1px top highlight — makes the glass read convex on native too. */}
      <View style={TopHighlight} pointerEvents="none" />
      {children}
    </View>
  );
}

const StyleFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

const TopHighlight = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  height: 1,
  backgroundColor: 'rgba(255,255,255,0.9)',
};
