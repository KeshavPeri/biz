import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SvgProps } from 'react-native-svg';

import { EASE_OUT, useMotion } from '@/components/motion/use-motion';
import { PressableScale } from '@/components/motion/pressable-scale';
import { GlassSurface } from '@/components/ui/glass-surface';
import { useHasUnreadDeals } from '@/hooks/use-has-unread-deals';
import {
  TAB_BAR_ROW_HEIGHT,
  TAB_BAR_TOP_PADDING,
  tabBarBottomPadding,
} from '@/hooks/use-tab-bar-inset';

// Pre-approved icon set (frontend/assets/icons) imported as RN components via
// react-native-svg-transformer. They use stroke="currentColor", so `color`
// drives active (ink) vs inactive (warm-grey) — no colour variants needed.
import DiscoverIcon from '@/assets/icons/discover.svg';
import ChatIcon from '@/assets/icons/chat.svg';
import InsightsIcon from '@/assets/icons/insights.svg';
import ProfileIcon from '@/assets/icons/profile.svg';
import SettingsIcon from '@/assets/icons/settings.svg';

// design-tokens.md §Icons: content/active = ink #1C1B18, wayfinding = #847F78.
const INK = '#1C1B18';
const TERTIARY = '#847F78';

const LIQUID = isLiquidGlassAvailable();

// Without backdrop-filter the blur no-ops on web, so fall back to the near-opaque mockup fill.
const WEB_BLUR =
  Platform.OS === 'web' &&
  typeof CSS !== 'undefined' &&
  (CSS.supports('backdrop-filter', 'blur(1px)') ||
    CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
const BAR_OVERLAY =
  Platform.OS === 'web' && !WEB_BLUR ? 'rgba(251,250,246,0.92)' : 'rgba(251,250,246,0.62)';

type TabDef = {
  /** Must match the Expo Router route name (file basename). */
  name: string;
  label: string;
  Icon: React.FC<SvgProps>;
};

// Order mirrors the mockup's .bnav; `index` is the default (Discover) route.
const TABS: TabDef[] = [
  { name: 'index', label: 'Discover', Icon: DiscoverIcon },
  { name: 'chat', label: 'Chat', Icon: ChatIcon },
  { name: 'track', label: 'Track', Icon: InsightsIcon },
  { name: 'you', label: 'You', Icon: ProfileIcon },
  { name: 'account', label: 'Account', Icon: SettingsIcon },
];

/**
 * BottomNav — Inflo's 5-tab bar, floating over the content (roadmap §3). Native
 * Liquid Glass on iOS 26; elsewhere a light blur with a warm overlay, a specular
 * top edge and a hairline. The ACTIVE tab wears the reserved pillow-glass pill —
 * elevation, never a colour change. Screens pad by `useTabBarInset()`.
 */
export function BottomNav({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const hasUnread = useHasUnreadDeals(`${state.index}:${isFocused}`);

  return (
    <View className="absolute bottom-0 left-0 right-0">
      {/* Soft scroll-edge fade where content slides under the bar. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(251,250,246,0)', 'rgba(251,250,246,0.9)']}
        style={EdgeFade}
      />
      {LIQUID ? (
        <GlassView
          glassEffectStyle="regular"
          colorScheme="light"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <>
          <BlurView
            tint="light"
            intensity={40}
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: BAR_OVERLAY }]}
          />
          <View pointerEvents="none" style={SpecularEdge} />
          <View pointerEvents="none" style={Hairline} />
        </>
      )}
      <View
        className="flex-row px-[10px]"
        style={{
          paddingTop: TAB_BAR_TOP_PADDING,
          paddingBottom: tabBarBottomPadding(insets.bottom),
        }}
      >
        {TABS.map((tab) => {
          // Map the tab def onto this navigator's route by name.
          const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
          if (routeIndex === -1) return null;
          const route = state.routes[routeIndex];
          const isActive = state.index === routeIndex;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isActive && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <NavTab
              key={route.key}
              tab={tab}
              isActive={isActive}
              showDot={tab.name === 'chat' && hasUnread}
              onPress={onPress}
            />
          );
        })}
      </View>
    </View>
  );
}

function NavTab({
  tab,
  isActive,
  showDot,
  onPress,
}: {
  tab: TabDef;
  isActive: boolean;
  showDot: boolean;
  onPress: () => void;
}) {
  const { Icon } = tab;
  const { reduce } = useMotion();
  const active = useSharedValue(isActive ? 1 : 0);

  useEffect(() => {
    active.value = withTiming(isActive ? 1 : 0, { duration: reduce ? 0 : 160, easing: EASE_OUT });
  }, [active, isActive, reduce]);

  // The pill is always mounted and fades/grows in from 0.95, so the icon never
  // jumps between parents and the glass never pops.
  const pillStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ scale: 0.95 + active.value * 0.05 }],
  }));

  return (
    // Selection haptic fires on press-in (PressableScale) so it lands with the touch.
    <PressableScale
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={showDot ? `${tab.label}, unread messages` : tab.label}
      className="flex-1 items-center gap-[3px] py-1.5"
      style={{ height: TAB_BAR_ROW_HEIGHT }}
    >
      <View className="h-[30px] w-11 items-center justify-center">
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, pillStyle]}>
          <GlassSurface variant="pillow" radius={12} liquid className="flex-1" />
        </Animated.View>
        <Icon width={22} height={22} color={isActive ? INK : TERTIARY} />
        {showDot ? (
          // Ink, like the inbox unread badge; ringed by the app base.
          <View className="absolute right-0 top-0 h-[7px] w-[7px] rounded-full border-[1.5px] border-app bg-ink" />
        ) : null}
      </View>
      {/* The one sanctioned fixed-size label: scaling would wrap it and double the bar. */}
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        className={`font-geist-medium text-micro ${isActive ? 'text-ink' : 'text-ink-3'}`}
      >
        {tab.label}
      </Text>
    </PressableScale>
  );
}

const EdgeFade: ViewStyle = { position: 'absolute', top: -12, left: 0, right: 0, height: 12 };

const SpecularEdge: ViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 1,
  backgroundColor: 'rgba(255,255,255,0.8)',
};

const Hairline: ViewStyle = {
  position: 'absolute',
  top: 1,
  left: 0,
  right: 0,
  height: 1,
  backgroundColor: '#EFEDE8',
};
