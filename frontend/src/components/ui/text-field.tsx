import React, { useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import EyeIcon from '@/assets/icons/eye.svg';
import EyeOffIcon from '@/assets/icons/eye-off.svg';
import { EASE_OUT, useMotion } from '@/components/motion/use-motion';

// design-tokens.md §Icons — tertiary wayfinding colour for the show/hide glyph.
const ICON_TERTIARY = '#847F78';
// text.tertiary — placeholder colour (mockup `.finput input::placeholder`).
const PLACEHOLDER = '#847F78';

type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  /** Right-aligned hint next to the label (mockup `.flabel .opt`). */
  labelHint?: string;
  /** Friendly inline error shown under the field (mockup validation copy). */
  error?: string | null;
  /** When true, renders the value masked with an eye show/hide toggle. */
  password?: boolean;
};

/**
 * TextField — Inflo's recessed input, rebuilt in RN from the onboarding mockup's
 * `.finput` (bg-surface-recess + inset shadow + radius 16). One controlled input,
 * an optional password toggle, and an inline error line. Used by every auth
 * screen so they stay visually identical.
 */
export function TextField({
  label,
  labelHint,
  error,
  password = false,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  accessibilityLabel: accessibilityLabelProp,
  maxFontSizeMultiplier: maxFontSizeMultiplierProp,
  ...inputProps
}: TextFieldProps) {
  const [hidden, setHidden] = useState(true);
  const [focused, setFocused] = useState(false);
  const { t } = useMotion();
  const focusProgress = useSharedValue(0);

  const handleFocus: NonNullable<TextInputProps['onFocus']> = (event) => {
    setFocused(true);
    focusProgress.value = withTiming(1, { duration: t(150), easing: EASE_OUT });
    onFocusProp?.(event);
  };

  const handleBlur: NonNullable<TextInputProps['onBlur']> = (event) => {
    setFocused(false);
    focusProgress.value = withTiming(0, { duration: t(150), easing: EASE_OUT });
    onBlurProp?.(event);
  };

  const borderStyle = useAnimatedStyle(() => ({
    borderColor: error
      ? '#1C1B18'
      : interpolateColor(focusProgress.value, [0, 1], ['transparent', 'rgba(28,27,24,0.35)']),
  }));

  return (
    <View className="mb-4">
      <View className="mb-[7px] flex-row items-center justify-between">
        <Text className={`font-geist-semibold text-secondary ${focused ? 'text-ink' : 'text-ink-2'}`}>
          {label}
        </Text>
        {labelHint ? (
          <Text className="font-geist text-secondary text-ink-3">{labelHint}</Text>
        ) : null}
      </View>

      <Animated.View
        className="flex-row items-center gap-[10px] rounded-input border bg-surface-recess px-4 shadow-recessInset"
        style={[{ minHeight: 52 }, borderStyle]}
      >
        <TextInput
          className="flex-1 font-geist text-body text-ink"
          placeholderTextColor={PLACEHOLDER}
          secureTextEntry={password ? hidden : false}
          accessibilityLabel={accessibilityLabelProp ?? label}
          maxFontSizeMultiplier={maxFontSizeMultiplierProp ?? 1.25}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...inputProps}
        />
        {password ? (
          <Pressable
            onPress={() => setHidden((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
          >
            {hidden ? (
              <EyeIcon width={20} height={20} color={ICON_TERTIARY} />
            ) : (
              <EyeOffIcon width={20} height={20} color={ICON_TERTIARY} />
            )}
          </Pressable>
        ) : null}
      </Animated.View>

      {error ? (
        <View className="mt-1 flex-row items-start gap-2">
          <View className="mt-1.5 h-2 w-2 rounded-full bg-status-critical" />
          <Text className="flex-1 font-geist text-secondary text-status-critical">{error}</Text>
        </View>
      ) : null}
    </View>
  );
}
