import React, { useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';

import EyeIcon from '@/assets/icons/eye.svg';
import EyeOffIcon from '@/assets/icons/eye-off.svg';

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
  ...inputProps
}: TextFieldProps) {
  const [hidden, setHidden] = useState(true);

  return (
    <View className="mb-4">
      <View className="mb-[7px] flex-row items-center justify-between">
        <Text className="font-geist-semibold text-secondary text-ink-2">{label}</Text>
        {labelHint ? (
          <Text className="font-geist text-secondary text-ink-3">{labelHint}</Text>
        ) : null}
      </View>

      <View
        className={`flex-row items-center gap-[10px] rounded-input bg-surface-recess px-4 shadow-recessInset ${
          error ? 'border border-status-critical' : ''
        }`}
        style={{ minHeight: 52 }}
      >
        <TextInput
          className="flex-1 font-geist text-body text-ink"
          placeholderTextColor={PLACEHOLDER}
          secureTextEntry={password ? hidden : false}
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
      </View>

      {error ? (
        <Text className="mt-[6px] font-geist text-secondary text-status-critical">{error}</Text>
      ) : null}
    </View>
  );
}
