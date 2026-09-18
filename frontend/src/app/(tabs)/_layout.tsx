import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import React from 'react';
import { Easing, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { BottomNav } from '@/components/bottom-nav';
import { AmbientBackdrop } from '@/components/ui/ambient-backdrop';

// Tab change = a short cross-fade plus a 14pt drift in the direction of travel.
// The built-in 'shift' drifts 50pt with an ease-in-out start that reads as lag;
// this eases out so the new screen is present at once, landing with the dock's pill.
const sceneShift: BottomTabNavigationOptions['sceneStyleInterpolator'] = ({ current }) => ({
  sceneStyle: {
    opacity: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
    transform: [
      {
        translateX: current.progress.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-14, 0, 14],
        }),
      },
    ],
  },
});

// The 5-tab shell (task 6.5). Chrome comes entirely from our custom BottomNav
// (floating glass dock + travelling pill); screens draw their own header. Scenes
// are transparent so every tab scrolls over the one fixed AmbientBackdrop.
export default function TabLayout() {
  const reduceMotion = useReducedMotion();

  return (
    <View style={{ flex: 1 }}>
      <AmbientBackdrop />
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: 'transparent' },
          // Reduce Motion: instant swap, no fade or drift.
          ...(reduceMotion
            ? { animation: 'none' }
            : {
                sceneStyleInterpolator: sceneShift,
                transitionSpec: {
                  animation: 'timing',
                  config: { duration: 220, easing: Easing.out(Easing.cubic) },
                },
              }),
        }}
        tabBar={(props) => <BottomNav {...props} />}
      >
        <Tabs.Screen name="index" options={{ title: 'Discover' }} />
        <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
        <Tabs.Screen name="track" options={{ title: 'Track' }} />
        <Tabs.Screen name="you" options={{ title: 'You' }} />
        <Tabs.Screen name="account" options={{ title: 'Account' }} />
      </Tabs>
    </View>
  );
}
