'use client';
import React from 'react';
import { createButton } from '@gluestack-ui/core/button/creator';
import {
  tva,
  withStyleContext,
  useStyleContext,
  type VariantProps,
} from '@gluestack-ui/utils/nativewind-utils';
import { cssInterop } from 'nativewind';
import { ActivityIndicator, Text, View } from 'react-native';
import { PrimitiveIcon, UIIcon } from '@gluestack-ui/core/icon/creator';

import { PressableScale } from '@/components/motion/pressable-scale';

const SCOPE = 'BUTTON';

// PressableScale gives every button the shared scale/opacity press + haptic (roadmap §2.1).
const Root = withStyleContext(PressableScale, SCOPE);

const UIButton = createButton({
  Root: Root,
  Text,
  Group: View,
  Spinner: ActivityIndicator,
  Icon: UIIcon,
});

cssInterop(PrimitiveIcon, {
  className: {
    target: 'style',
    nativeStyleToProp: {
      height: true,
      width: true,
      fill: true,
      color: 'classNameColor',
      stroke: true,
    },
  },
});

const buttonStyle = tva({
  // Inflo 6.7: button radius = 16 (rounded-button token), not gluestack's default `rounded` (4px).
  base: 'group/button rounded-button bg-primary-500 flex-row items-center justify-center data-[focus-visible=true]:web:outline-none data-[focus-visible=true]:web:ring-2 data-[disabled=true]:opacity-40 gap-2',
  variants: {
    action: {
      primary:
        'bg-primary-500 data-[hover=true]:bg-primary-600 data-[active=true]:bg-primary-700 border-primary-300 data-[hover=true]:border-primary-400 data-[active=true]:border-primary-500 data-[focus-visible=true]:web:ring-indicator-info',
      secondary:
        'bg-secondary-500 border-secondary-300 data-[hover=true]:bg-secondary-600 data-[hover=true]:border-secondary-400 data-[active=true]:bg-secondary-700 data-[active=true]:border-secondary-700 data-[focus-visible=true]:web:ring-indicator-info',
      default:
        'bg-transparent data-[hover=true]:bg-background-50 data-[active=true]:bg-transparent',
    },
    variant: {
      outline:
        'bg-transparent border data-[hover=true]:bg-background-50 data-[active=true]:bg-transparent',
      solid: '',
    },

    size: {
      xs: 'px-3.5 h-8',
      sm: 'px-4 h-9',
      md: 'px-5 h-10',
      lg: 'px-6 h-11',
      xl: 'px-7 h-12',
    },
  },
  compoundVariants: [
    {
      action: 'primary',
      variant: 'outline',
      class:
        'bg-transparent data-[hover=true]:bg-background-50 data-[active=true]:bg-transparent',
    },
    {
      action: 'secondary',
      variant: 'outline',
      class:
        'bg-transparent data-[hover=true]:bg-background-50 data-[active=true]:bg-transparent',
    },
  ],
});

const buttonTextStyle = tva({
  // Inflo 6.7: button labels use Geist (font-geist-semibold = Geist_600SemiBold).
  base: 'text-typography-0 font-geist-semibold web:select-none',
  parentVariants: {
    action: {
      primary:
        'text-primary-600 data-[hover=true]:text-primary-600 data-[active=true]:text-primary-700',
      secondary:
        'text-typography-500 data-[hover=true]:text-typography-600 data-[active=true]:text-typography-700',
    },
    variant: {
      outline: '',
      solid:
        'text-typography-0 data-[hover=true]:text-typography-0 data-[active=true]:text-typography-0',
    },
    size: {
      xs: 'text-xs',
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl',
    },
  },
  parentCompoundVariants: [
    {
      variant: 'solid',
      action: 'primary',
      class:
        'text-typography-0 data-[hover=true]:text-typography-0 data-[active=true]:text-typography-0',
    },
    {
      variant: 'solid',
      action: 'secondary',
      class:
        'text-typography-800 data-[hover=true]:text-typography-800 data-[active=true]:text-typography-800',
    },
    {
      variant: 'outline',
      action: 'primary',
      class:
        'text-primary-500 data-[hover=true]:text-primary-500 data-[active=true]:text-primary-500',
    },
    {
      variant: 'outline',
      action: 'secondary',
      class:
        'text-typography-500 data-[hover=true]:text-primary-600 data-[active=true]:text-typography-700',
    },
  ],
});

const buttonIconStyle = tva({
  base: 'fill-none',
  parentVariants: {
    variant: {
      outline: '',
      solid:
        'text-typography-0 data-[hover=true]:text-typography-0 data-[active=true]:text-typography-0',
    },
    size: {
      xs: 'h-3.5 w-3.5',
      sm: 'h-4 w-4',
      md: 'h-[18px] w-[18px]',
      lg: 'h-[18px] w-[18px]',
      xl: 'h-5 w-5',
    },
    action: {
      primary:
        'text-primary-600 data-[hover=true]:text-primary-600 data-[active=true]:text-primary-700',
      secondary:
        'text-typography-500 data-[hover=true]:text-typography-600 data-[active=true]:text-typography-700',
    },
  },
  parentCompoundVariants: [
    {
      variant: 'solid',
      action: 'primary',
      class:
        'text-typography-0 data-[hover=true]:text-typography-0 data-[active=true]:text-typography-0',
    },
    {
      variant: 'solid',
      action: 'secondary',
      class:
        'text-typography-800 data-[hover=true]:text-typography-800 data-[active=true]:text-typography-800',
    },
  ],
});

type IButtonProps = Omit<
  React.ComponentPropsWithoutRef<typeof UIButton>,
  'context'
> &
  VariantProps<typeof buttonStyle> & { className?: string };

const Button = React.forwardRef<
  React.ElementRef<typeof UIButton>,
  IButtonProps
>(
  (
    { className, variant = 'solid', size = 'md', action = 'primary', ...props },
    ref
  ) => {
    return (
      <UIButton
        ref={ref}
        {...props}
        className={buttonStyle({ variant, size, action, class: className })}
        context={{ variant, size, action }}
      />
    );
  }
);

type IButtonTextProps = React.ComponentPropsWithoutRef<typeof UIButton.Text> &
  VariantProps<typeof buttonTextStyle> & { className?: string };

const ButtonText = React.forwardRef<
  React.ElementRef<typeof UIButton.Text>,
  IButtonTextProps
>(({ className, variant, size, action, ...props }, ref) => {
  const {
    variant: parentVariant,
    size: parentSize,
    action: parentAction,
  } = useStyleContext(SCOPE);

  return (
    <UIButton.Text
      ref={ref}
      {...props}
      className={buttonTextStyle({
        parentVariants: {
          variant: parentVariant,
          size: parentSize,
          action: parentAction,
        },
        variant,
        size,
        action,
        class: className,
      })}
    />
  );
});

const ButtonSpinner = UIButton.Spinner;

type IButtonIcon = React.ComponentPropsWithoutRef<typeof UIButton.Icon> &
  VariantProps<typeof buttonIconStyle> & {
    className?: string | undefined;
    as?: React.ElementType;
    height?: number;
    width?: number;
  };

const ButtonIcon = React.forwardRef<
  React.ElementRef<typeof UIButton.Icon>,
  IButtonIcon
>(({ className, size, ...props }, ref) => {
  const {
    variant: parentVariant,
    size: parentSize,
    action: parentAction,
  } = useStyleContext(SCOPE);

  if (typeof size === 'number') {
    return (
      <UIButton.Icon
        ref={ref}
        {...props}
        className={buttonIconStyle({ class: className })}
        size={size}
      />
    );
  } else if (
    (props.height !== undefined || props.width !== undefined) &&
    size === undefined
  ) {
    return (
      <UIButton.Icon
        ref={ref}
        {...props}
        className={buttonIconStyle({ class: className })}
      />
    );
  }
  return (
    <UIButton.Icon
      {...props}
      className={buttonIconStyle({
        parentVariants: {
          size: parentSize,
          variant: parentVariant,
          action: parentAction,
        },
        size,
        class: className,
      })}
      ref={ref}
    />
  );
});

Button.displayName = 'Button';
ButtonText.displayName = 'ButtonText';
ButtonSpinner.displayName = 'ButtonSpinner';
ButtonIcon.displayName = 'ButtonIcon';

export { Button, ButtonText, ButtonSpinner, ButtonIcon };
