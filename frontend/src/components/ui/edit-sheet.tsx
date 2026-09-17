import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { EASE_OUT, EASE_OUT_STRONG, useMotion } from '@/components/motion/use-motion';

// Drag past this (pt) or flick faster than this (pt/s) to dismiss.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

/**
 * EditSheet — the shared bottom sheet (every media-kit editor and deal sheet).
 * Parent owns open state and content. The scrim fades while the panel slides
 * (roadmap §2.2: in 260ms, out 220ms on the same path; fade-only 150ms under
 * reduce-motion). The header is a drag handle with rubber-banding above rest; the
 * panel rides above the keyboard and clears the home indicator. The Modal stays
 * mounted until the exit finishes, so closing animates too.
 */
export function EditSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  scrollEnabled = true,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  scrollEnabled?: boolean;
}) {
  const { reduce } = useMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);

  const offset = useSharedValue(reduce ? 0 : windowHeight);
  const panelOpacity = useSharedValue(reduce ? 0 : 1);
  const scrim = useSharedValue(0);
  const scrolled = useSharedValue(0);

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    const unmount = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(setMounted, false);
    };
    if (visible) {
      scrolled.value = 0;
      scrim.value = withTiming(1, { duration: reduce ? 150 : 200, easing: EASE_OUT });
      if (reduce) {
        offset.value = 0;
        panelOpacity.value = withTiming(1, { duration: 150 });
      } else {
        panelOpacity.value = 1;
        offset.value = withTiming(0, { duration: 260, easing: EASE_OUT_STRONG });
      }
    } else if (reduce) {
      scrim.value = withTiming(0, { duration: 150 });
      panelOpacity.value = withTiming(0, { duration: 150 }, unmount);
    } else {
      scrim.value = withTiming(0, { duration: 160 });
      offset.value = withTiming(windowHeight, { duration: 220 }, unmount);
    }
  }, [mounted, offset, panelOpacity, reduce, scrim, scrolled, visible, windowHeight]);

  const settle = useCallback(() => {
    offset.value = withTiming(0, { duration: 200, easing: EASE_OUT });
  }, [offset]);

  // A drag asked to close; some sheets refuse while saving, so snap back if still open.
  const requestDismiss = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    setTimeout(() => {
      if (visibleRef.current) settle();
    }, 50);
  }, [onClose, settle]);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          // Follows the finger down; resists (÷3) above the rest position.
          offset.value = e.translationY > 0 ? e.translationY : e.translationY / 3;
        })
        .onEnd((e) => {
          if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
            scheduleOnRN(requestDismiss);
          } else {
            offset.value = withTiming(0, { duration: 200, easing: EASE_OUT });
          }
        }),
    [offset, requestDismiss]
  );

  const onScroll = useAnimatedScrollHandler((e) => {
    const next = e.contentOffset.y > 0 ? 1 : 0;
    if (next !== scrolled.value) scrolled.value = withTiming(next, { duration: 150 });
  });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: panelOpacity.value,
    transform: [{ translateY: offset.value }],
  }));
  const edgeStyle = useAnimatedStyle(() => ({ opacity: scrolled.value }));

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Android needs its own gesture root inside a Modal. */}
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          {/* Scrim — tap outside to dismiss. */}
          <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.anchor}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.panel, panelStyle]} accessibilityViewIsModal>
            <View
              className="flex-shrink rounded-t-sheet bg-app px-5 pt-2.5 shadow-l2"
              style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
            >
              {/* Header doubles as the drag handle (≥44pt tall with the grabber). */}
              <GestureDetector gesture={drag}>
                <View className="pb-3">
                  <View className="mx-auto mb-4 mt-1 h-[5px] w-9 rounded-pill bg-[rgba(28,27,24,0.18)]" />
                  <Text className="font-geist-semibold text-title text-ink">{title}</Text>
                  {subtitle ? (
                    <Text className="mt-1 font-geist text-secondary text-ink-2">{subtitle}</Text>
                  ) : null}
                </View>
              </GestureDetector>
              <View className="flex-shrink">
                {/* Hairline + soft fade appear only once the body scrolls under the header. */}
                <Animated.View pointerEvents="none" style={[styles.edge, edgeStyle]}>
                  <View style={styles.hairline} />
                  <LinearGradient
                    colors={['rgba(251,250,246,1)', 'rgba(251,250,246,0)']}
                    style={styles.fade}
                  />
                </Animated.View>
                <Animated.ScrollView
                  scrollEnabled={scrollEnabled}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  onScroll={onScroll}
                  scrollEventThrottle={16}
                  contentContainerStyle={styles.body}
                >
                  {children}
                </Animated.ScrollView>
              </View>
              {footer ? <View className="pt-3">{footer}</View> : null}
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { backgroundColor: 'rgba(28,27,24,0.32)' },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  panel: { maxHeight: '85%' },
  edge: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  hairline: { height: 1, backgroundColor: '#EFEDE8' },
  fade: { height: 12 },
  body: { paddingTop: 4, paddingBottom: 8 },
});
