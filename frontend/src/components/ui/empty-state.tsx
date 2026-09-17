import type { FC } from 'react';
import { Text, View } from 'react-native';
import type { SvgProps } from 'react-native-svg';

import { Button, ButtonText } from '@/components/ui/button';

type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  Icon?: FC<SvgProps>;
};

/** Shared quiet empty state for screens that still have a clear next action. */
export function EmptyState({ title, description, actionLabel, onAction, Icon }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-12">
      {Icon ? (
        <View className="mb-4 h-11 w-11 items-center justify-center rounded-panel bg-surface-recess">
          <Icon width={20} height={20} color="#1C1B18" />
        </View>
      ) : null}
      <Text className="text-center font-geist-semibold text-subtitle text-ink">{title}</Text>
      <Text className="mt-1 text-center font-geist text-secondary text-ink-2">{description}</Text>
      {actionLabel && onAction ? (
        <Button action="secondary" size="md" className="mt-5" onPress={onAction}>
          <ButtonText>{actionLabel}</ButtonText>
        </Button>
      ) : null}
    </View>
  );
}
