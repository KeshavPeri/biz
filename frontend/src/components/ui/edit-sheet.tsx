import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

/**
 * EditSheet — the mockup's `.sheet` / `.scrim2` rebuilt in RN (Phase 8). A
 * bottom-anchored panel over a dim scrim, with a grab handle, title/subtitle and a
 * scrolling body. Uses RN's `Modal` (so it floats above the tab bar and handles the
 * hardware back button on Android via onRequestClose). Presentation only — the
 * parent owns open state and what's inside. Shared by every media-kit editor so
 * they stay visually identical.
 */
export function EditSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Scrim — tap outside to dismiss. */}
      <Pressable
        className="flex-1 bg-[rgba(28,27,24,0.32)]"
        onPress={onClose}
        accessibilityLabel="Close"
      />
      {/* Panel — pinned to the bottom; stopPropagation so taps inside don't dismiss. */}
      <View
        className="absolute inset-x-0 bottom-0 max-h-[85%] rounded-t-[24px] bg-app px-5 pb-8 pt-2.5 shadow-l2"
      >
        <View className="mx-auto mb-4 mt-1 h-1 w-9 rounded-full bg-cane-3" />
        <Text className="font-geist-semibold text-title text-ink">{title}</Text>
        {subtitle ? (
          <Text className="mt-1 font-geist text-secondary leading-[19px] text-ink-2">
            {subtitle}
          </Text>
        ) : null}
        <ScrollView
          className="mt-4"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="pb-2"
        >
          {children}
        </ScrollView>
        {footer ? <View className="pt-3">{footer}</View> : null}
      </View>
    </Modal>
  );
}
