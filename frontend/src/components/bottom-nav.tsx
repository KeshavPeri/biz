import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SvgProps } from 'react-native-svg';

import { EASE_OUT_STRONG, useMotion } from '@/components/motion/use-motion';
import { PressableScale } from '@/components/motion/pressable-scale';
import { GlassSurface } from '@/components/ui/glass-surface';
import { useHasUnreadDeals } from '@/hooks/use-has-unread-deals';
import {
  DOCK_HEIGHT,
  DOCK_PADDING_Y,
  TAB_BAR_ROW_HEIGHT,
  dockBottomOffset,
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

// Without backdrop-filter the blur no-ops on web, so the tint has to carry legibility alone.
const WEB_BLUR =
  Platform.OS === 'web' &&
  typeof CSS !== 'undefined' &&
  (CSS.supports('backdrop-filter', 'blur(1px)') ||
    CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
// A light warm tint: content stays recognisable through the glass, but dark imagery
// (the media-kit hero) can't drag the 11px inactive labels below legible contrast.
const DOCK_TINT =
  Platform.OS === 'web' && !WEB_BLUR ? 'rgba(251,250,246,0.88)' : 'rgba(251,250,246,0.56)';

const DOCK_RADIUS = DOCK_HEIGHT / 2;
const DOCK_MAX_WIDTH = 440;
const PILL_INSET_X = 3;

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
 * BottomNav — Inflo's 5-tab dock: a horizontally inset glass capsule floating over
 * the content (screens pad by `useTabBarInset()`). Native Liquid Glass (clear) on
 * iOS 26+; elsewhere a light blur, a thin warm tint and edge lighting. One pillow-glass
 * pill travels between tabs and always sits BEHIND the icon and label.
 */
export function BottomNav({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isFocused = useIsFocused();
  const hasUnread = useHasUnreadDeals(`${state.index}:${isFocused}`);
  const activeName = state.routes[state.index]?.name;
  const activeSlot = Math.max(
    0,
    TABS.findIndex((t) => t.name === activeName)
  );

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { paddingHorizontal: width < 360 ? 12 : 16, paddingBottom: dockBottomOffset(insets.bottom) },
      ]}
    >
      <View style={styles.dock}>
        <DockGlass />
        <View style={styles.row}>
          <ActivePill slot={activeSlot} />
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
    </View>
  );
}

/** The capsule's material: glass (or blur + tint) plus the soft edge lighting. */
function DockGlass() {
  return (
    <View pointerEvents="none" style={styles.glassClip}>
      {LIQUID ? (
        <GlassView glassEffectStyle="clear" colorScheme="light" style={StyleSheet.absoluteFill} />
      ) : (
        <>
          <BlurView
            // Web's 'default' adds only a faint white; iOS ultra-thin keeps it clear-ish.
            tint={Platform.OS === 'web' ? 'default' : 'systemUltraThinMaterialLight'}
            intensity={Platform.OS === 'web' ? 50 : 60}
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: DOCK_TINT }]} />
        </>
      )}
      {/* Specular sheen across the top half — light catching a curved lens. */}
      <LinearGradient
        colors={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
        locations={[0, 0.55]}
        style={StyleSheet.absoluteFill}
      />
      {/* Rim light: bright top edge, faint bottom glow, warm outer hairline. */}
      <View style={styles.rim} />
    </View>
  );
}

/** The single active indicator; it slides between slots rather than blinking per tab. */
function ActivePill({ slot }: { slot: number }) {
  const { t } = useMotion();
  const [slotWidth, setSlotWidth] = useState(0);
  const x = useSharedValue(0);
  const placed = useRef(false);

  useEffect(() => {
    if (!slotWidth) return;
    const target = slot * slotWidth;
    // First placement snaps; after that the pill travels.
    x.value = placed.current
      ? withTiming(target, { duration: t(280), easing: EASE_OUT_STRONG })
      : target;
    placed.current = true;
  }, [slot, slotWidth, t, x]);

  const onLayout = (e: LayoutChangeEvent) => setSlotWidth(e.nativeEvent.layout.width / TABS.length);

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {slotWidth ? (
        <Animated.View style={[styles.pillSlot, { width: slotWidth }, pillStyle]}>
          <GlassSurface
            variant="pillow"
            radius={TAB_BAR_ROW_HEIGHT / 2}
            liquid
            style={styles.pill}
          />
        </Animated.View>
      ) : null}
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

  return (
    // Selection haptic fires on press-in (PressableScale) so it lands with the touch.
    <PressableScale
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      // RN-web 0.21 only emits ARIA from aria-* props, not accessibilityState.
      aria-selected={isActive}
      accessibilityLabel={showDot ? `${tab.label}, unread messages` : tab.label}
      className="flex-1 items-center justify-center gap-[3px]"
      style={{ height: TAB_BAR_ROW_HEIGHT }}
    >
      {/* Positioned wrapper: on web an unpositioned <svg> paints BELOW an absolutely
          positioned sibling, which is how the old pill swallowed the active icon. */}
      <View style={styles.iconBox}>
        <Icon width={22} height={22} color={isActive ? INK : TERTIARY} />
        {showDot ? <View style={styles.unreadDot} /> : null}
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

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  dock: {
    width: '100%',
    maxWidth: DOCK_MAX_WIDTH,
    height: DOCK_HEIGHT,
    borderRadius: DOCK_RADIUS,
    paddingHorizontal: 4,
    paddingVertical: DOCK_PADDING_Y,
    // Warm, low and soft: a contact shadow plus a wide ambient one — lift, not a slab.
    boxShadow: '0 1px 2px rgba(28,27,24,0.06), 0 10px 30px rgba(28,27,24,0.10)',
  } as ViewStyle,
  glassClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: DOCK_RADIUS,
    overflow: 'hidden',
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: DOCK_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(28,27,24,0.07)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 1px rgba(255,255,255,0.4)',
  } as ViewStyle,
  row: {
    flex: 1,
    flexDirection: 'row',
    // Paints above the pill layer on every platform.
    zIndex: 1,
  },
  pillSlot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: PILL_INSET_X,
  },
  // The radius also has to live on GlassSurface's outer (shadow) view, or web draws a square lift.
  pill: { flex: 1, borderRadius: TAB_BAR_ROW_HEIGHT / 2 },
  iconBox: {
    position: 'relative',
    zIndex: 1,
    width: 30,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    // Ringed in the app base so it separates from the icon stroke and the glass.
    borderColor: '#FBFAF6',
    backgroundColor: INK,
  },
});
