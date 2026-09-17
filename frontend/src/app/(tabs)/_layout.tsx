import { Tabs } from 'expo-router';
import React from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import { BottomNav } from '@/components/bottom-nav';

// The 5-tab shell (task 6.5). Chrome comes entirely from our custom BottomNav
// (warm blurred bar + pillow-glass active pill); screens draw their own header.
export default function TabLayout() {
  const reduceMotion = useReducedMotion();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'fade',
        sceneStyle: { backgroundColor: '#FBFAF6' },
        transitionSpec: { animation: 'timing', config: { duration: 180 } },
      }}
      tabBar={(props) => <BottomNav {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Discover' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="track" options={{ title: 'Track' }} />
      <Tabs.Screen name="you" options={{ title: 'You' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
