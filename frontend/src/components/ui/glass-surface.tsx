import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React from 'react';
import { View, type ViewProps, type ViewStyle } from 'react-native';

import { GlassFlush } from '@/components/ui/glass-flush';

/**
 * GlassSurface — Inflo's glass material (docs/design-tokens.md §Material signatures).
 * The gradient is the SHARED language; the outer lift is the RESERVED signature.
 *
 *  - variant="flush"  → glassFlush: gradient + `.07` hairline + inset top highlight,
 *    NO outer lift.
 *  - variant="pillow" → pillowGlass: `.05` hairline, plus the two-layer outer lift
 *    (contact `0 1 2 /.05` + far `0 5 12 /.09`). Reserved for nav-active only.
 *
 * `liquid` swaps in the native iOS 26 `GlassView` when the OS offers it (decision 4);
 * everywhere else the gradient recipe renders. Shadows sit on separate nested Views
 * with the clip on the innermost one, so neither iOS shadows nor Android elevation
 * get cut off by `overflow: hidden`.
 */

export type GlassVariant = 'flush' | 'pillow';

type GlassSurfaceProps = ViewProps & {
  variant?: GlassVariant;
  /** Corner radius of the glass layers (absolute layers can't read it from className). */
  radius?: number;
  /** Use native Liquid Glass when available (nav + active pill only). */
  liquid?: boolean;
  /** Tailwind classes for the outer surface — sizing, padding, layout. */
  className?: string;
  children?: React.ReactNode;
};

const LIQUID = isLiquidGlassAvailable();

export function GlassSurface({
  variant = 'flush',
  radius = 12,
  liquid = false,
  className,
  children,
  style,
  ...props
}: GlassSurfaceProps) {
  const isPillow = variant === 'pillow';

  if (liquid && LIQUID) {
    return (
      <View className={className} style={style} {...props}>
        <GlassView
          glassEffectStyle="regular"
          colorScheme="light"
          pointerEvents="none"
          style={[Fill, { borderRadius: radius }]}
        />
        {children}
      </View>
    );
  }

  return (
    <View className={className} style={[isPillow ? FarShadow : null, style]} {...props}>
      {isPillow ? (
        // Opaque so the contact shadow (and Android elevation) takes the pill's shape.
        <View pointerEvents="none" style={[Fill, ContactShadow, { borderRadius: radius }]} />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          Fill,
          {
            borderRadius: radius,
            borderWidth: 1,
            borderColor: isPillow ? 'rgba(28,27,24,0.05)' : 'rgba(28,27,24,0.07)',
            overflow: 'hidden',
          },
        ]}
      >
        <GlassFlush />
      </View>
      {children}
    </View>
  );
}

const Fill: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

const FarShadow: ViewStyle = {
  shadowColor: '#1C1B18',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.09,
  shadowRadius: 6,
};

const ContactShadow: ViewStyle = {
  backgroundColor: '#FFFFFF',
  shadowColor: '#1C1B18',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 1,
  elevation: 3,
};
