import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SvgProps } from 'react-native-svg';

import { GlassSurface } from '@/components/ui/glass-surface';

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

type TabDef = {
  /** Must match the Expo Router route name (file basename). */
  name: string;
  label: string;
  Icon: React.FC<SvgProps>;
  /** Static notification dot (Chat) — placeholder per the mockup. */
  dot?: boolean;
};

// Order mirrors the mockup's .bnav; `index` is the default (Discover) route.
const TABS: TabDef[] = [
  { name: 'index', label: 'Discover', Icon: DiscoverIcon },
  { name: 'chat', label: 'Chat', Icon: ChatIcon, dot: true },
  { name: 'track', label: 'Track', Icon: InsightsIcon },
  { name: 'you', label: 'You', Icon: ProfileIcon },
  { name: 'account', label: 'Account', Icon: SettingsIcon },
];

/**
 * BottomNav — Inflo's themed 5-tab bar (task 6.5), rebuilt in React Native from
 * inflo-one.html's `.bnav`. Warm translucent bar with a soft blur; the ACTIVE
 * tab wears the reserved pillow-glass signature (icon in a lifted glass pill),
 * never a colour change. Rendered as Expo Router's custom `tabBar`.
 */
export function BottomNav({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View className="absolute bottom-0 left-0 right-0 border-t border-hairline">
      {/* Soft blur behind the bar. Sits UNDER the 92% warm overlay so if blur
          no-ops on a platform, the warm fill (the mockup value) still reads. */}
      <BlurView
        tint="light"
        intensity={20}
        experimentalBlurMethod="dimezisBlurView"
        className="absolute inset-0"
      />
      <View
        className="flex-row px-[10px] pt-2"
        // Warm translucent fill (#FBFAF6 @ 92%) + home-indicator safe area.
        style={{
          backgroundColor: 'rgba(251,250,246,0.92)',
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        {TABS.map((tab) => {
          // Map the tab def onto this navigator's route by name.
          const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
          if (routeIndex === -1) return null;
          const route = state.routes[routeIndex];
          const isActive = state.index === routeIndex;
          const color = isActive ? INK : TERTIARY;
          const { Icon } = tab;

          const onPress = () => {
            if (Platform.OS === 'ios') {
              Haptics.selectionAsync();
            }
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
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={isActive ? { selected: true } : {}}
              accessibilityLabel={tab.label}
              className="flex-1 items-center gap-[3px] py-1.5"
            >
              <View className="relative">
                {isActive ? (
                  <GlassSurface
                    variant="pillow"
                    className="h-[30px] w-11 items-center justify-center rounded-[12px]"
                  >
                    <Icon width={22} height={22} color={color} />
                  </GlassSurface>
                ) : (
                  <View className="h-[30px] w-11 items-center justify-center">
                    <Icon width={22} height={22} color={color} />
                  </View>
                )}
                {tab.dot ? (
                  // Static green notification dot, ringed by the app base.
                  <View className="absolute right-0 top-0 h-[7px] w-[7px] rounded-full border-[1.5px] border-app bg-status-good" />
                ) : null}
              </View>
              <Text
                className={`text-[11px] ${
                  isActive ? 'font-geist-semibold text-ink' : 'font-geist-medium text-ink-3'
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
