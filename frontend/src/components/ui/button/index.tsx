'use client';
import React from 'react';
import { createButton } from '@gluestack-ui/core/button/creator';
import { UIIcon } from '@gluestack-ui/core/icon/creator';
import { withStyleContext, useStyleContext } from '@gluestack-ui/utils/nativewind-utils';
import { ActivityIndicator, Text, View } from 'react-native';

import { PressableScale } from '@/components/motion/pressable-scale';
import { GlassFlush } from '@/components/ui/glass-flush';

const SCOPE = 'BUTTON';

// PressableScale gives every button the shared scale/opacity press + haptic (roadmap §2.1).
const Root = withStyleContext(PressableScale, SCOPE);

const UIButton = createButton({
  Root,
  Text,
  Group: View,
  Spinner: ActivityIndicator,
  Icon: UIIcon,
});

/**
 * Inflo button tiers (design-tokens.md §Buttons). Red and green are never button
 * fills, so there is no positive/negative tier; destructive routine actions use
 * `ghost` + a confirm step.
 *  - primary   ink fill, white label, no shadow
 *  - secondary glassFlush, ink label, flush (no outer shadow)
 *  - tertiary  soft neutral fill, ink label (rare)
 *  - ghost     transparent, ink-2 label
 */
export type ButtonAction = 'primary' | 'secondary' | 'tertiary' | 'ghost';
/** md = 44pt (the floor), lg = 48pt. */
export type ButtonSize = 'md' | 'lg';

type ButtonContext = { action: ButtonAction; size: ButtonSize; isDisabled: boolean };

// Plain class maps rather than tva: tailwind-merge treats the custom type-role
// sizes (text-body) as colours and would drop one of the pair.
const ROOT_BASE =
  'flex-row items-center justify-center gap-2 rounded-button ' +
  'data-[focus-visible=true]:web:outline-none data-[focus-visible=true]:web:ring-2 ' +
  'data-[focus-visible=true]:web:ring-ink/40 data-[focus-visible=true]:web:ring-offset-2 ' +
  'data-[focus-visible=true]:web:ring-offset-app';

const ROOT_ACTION: Record<ButtonAction, string> = {
  primary: 'bg-ink',
  secondary: 'overflow-hidden border border-[rgba(28,27,24,0.07)] bg-surface-card',
  tertiary: 'bg-[#EDEAE3]',
  ghost: 'bg-transparent',
};

// Disabled spec: #ECEAE3 fill, #B6B0A6 label — a solid fill, not a faded one.
const ROOT_DISABLED: Record<ButtonAction, string> = {
  primary: 'bg-[#ECEAE3]',
  secondary: 'overflow-hidden border border-transparent bg-[#ECEAE3]',
  tertiary: 'bg-[#ECEAE3]',
  ghost: 'bg-transparent',
};

const ROOT_SIZE: Record<ButtonSize, string> = {
  md: 'h-11 px-5',
  lg: 'h-12 px-6',
};

const TEXT_ACTION: Record<ButtonAction, string> = {
  primary: 'text-white',
  secondary: 'text-ink',
  tertiary: 'text-ink',
  ghost: 'text-ink-2',
};

const TEXT_SIZE: Record<ButtonSize, string> = {
  md: 'text-body',
  lg: 'text-subtitle',
};

const DISABLED_LABEL = '#B6B0A6';

type IButtonProps = Omit<React.ComponentPropsWithoutRef<typeof UIButton>, 'context'> & {
  action?: ButtonAction;
  size?: ButtonSize;
  className?: string;
};

const Button = React.forwardRef<React.ElementRef<typeof UIButton>, IButtonProps>(
  ({ className, size = 'md', action = 'primary', isDisabled = false, children, ...props }, ref) => {
    const context: ButtonContext = { action, size, isDisabled: !!isDisabled };
    const tone = isDisabled ? ROOT_DISABLED[action] : ROOT_ACTION[action];
    return (
      <UIButton
        ref={ref}
        {...props}
        isDisabled={isDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!isDisabled }}
        className={`${ROOT_BASE} ${ROOT_SIZE[size]} ${tone} ${className ?? ''}`}
        context={context}
      >
        {action === 'secondary' && !isDisabled ? <GlassFlush /> : null}
        {children as React.ReactNode}
      </UIButton>
    );
  }
);

type IButtonTextProps = React.ComponentPropsWithoutRef<typeof UIButton.Text> & {
  className?: string;
};

const ButtonText = React.forwardRef<React.ElementRef<typeof UIButton.Text>, IButtonTextProps>(
  ({ className, style, ...props }, ref) => {
    const { action, size, isDisabled } = useStyleContext(SCOPE) as ButtonContext;
    return (
      <UIButton.Text
        ref={ref}
        numberOfLines={1}
        // Subtitle-role cap (125%) so labels scale without breaking the 44/48pt row.
        maxFontSizeMultiplier={1.25}
        {...props}
        className={`font-geist-semibold web:select-none ${TEXT_SIZE[size]} ${TEXT_ACTION[action]} ${className ?? ''}`}
        style={[isDisabled ? { color: DISABLED_LABEL } : null, style]}
      />
    );
  }
);

type IButtonSpinnerProps = React.ComponentPropsWithoutRef<typeof ActivityIndicator>;

/** Spinner tinted to the tier's label colour unless a colour is passed. */
const ButtonSpinner = (props: IButtonSpinnerProps) => {
  const { action, isDisabled } = useStyleContext(SCOPE) as ButtonContext;
  const color = isDisabled ? DISABLED_LABEL : action === 'primary' ? '#FFFFFF' : '#1C1B18';
  return <ActivityIndicator color={color} {...props} />;
};

Button.displayName = 'Button';
ButtonText.displayName = 'ButtonText';
ButtonSpinner.displayName = 'ButtonSpinner';

export { Button, ButtonText, ButtonSpinner };
