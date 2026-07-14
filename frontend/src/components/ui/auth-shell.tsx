import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BackIcon from '@/assets/icons/arrow-left.svg';

const INK = '#1C1B18';

type AuthShellProps = {
  /** Small uppercase kicker above the title (mockup `.eyebrow`). */
  eyebrow: string;
  /** Big question-style heading (mockup `.qtitle`). */
  title: string;
  /** Supporting line under the title (mockup `.qsub`). */
  subtitle?: string;
  /** Scrollable body — the form fields. */
  children: ReactNode;
  /** Pinned footer — the primary button + any links (mockup `.obfoot`). */
  footer: ReactNode;
  /** Optional back affordance (mockup `.backbtn`). */
  onBack?: () => void;
  /** Optional progress bar shown in the top chrome (mockup `.progress`). */
  progress?: ReactNode;
  /**
   * Disables the body ScrollView — used by the signature step while a finger
   * is down on the drawing pad. PanResponder capture flags alone are a
   * JS-thread-only signal that a native ScrollView's own gesture recognizer
   * can still win a drag before it lands; disabling scroll for the duration
   * of the touch is the reliable fix. Defaults to true (normal scrolling).
   */
  scrollEnabled?: boolean;
};

/**
 * AuthShell — the shared onboarding chrome for every (auth) screen, rebuilt in
 * RN from inflo-onboarding.html. Warm app base, top+bottom safe areas, a
 * keyboard-aware scroll body, and a footer pinned above the keyboard. Keeps
 * sign-up / verify / login pixel-consistent with the mockup.
 */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  onBack,
  progress,
  scrollEnabled = true,
}: AuthShellProps) {
  return (
    <SafeAreaView className="flex-1 bg-app" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {onBack || progress ? (
          // Top chrome (mockup `.obhead`): back button + progress bar.
          <View className="flex-row items-center gap-3 px-[10px] pt-1.5">
            {onBack ? (
              <Pressable
                onPress={onBack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                className="h-9 w-9 items-center justify-center rounded-panel"
              >
                <BackIcon width={22} height={22} color={INK} />
              </Pressable>
            ) : null}
            {progress}
          </View>
        ) : null}

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-[22px] pt-2 pb-4"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
        >
          <Text className="mb-2 font-geist-semibold text-micro uppercase tracking-[0.7px] text-ink-3">
            {eyebrow}
          </Text>
          <Text className="mb-[7px] font-geist-bold text-display text-ink">{title}</Text>
          {subtitle ? (
            <Text className="mb-6 font-geist text-body text-ink-2">{subtitle}</Text>
          ) : null}
          {children}
        </ScrollView>

        <View className="px-[22px] pb-[18px] pt-3">{footer}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
