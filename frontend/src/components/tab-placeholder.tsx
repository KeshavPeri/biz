import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * TabPlaceholder — the shell screen for each of the 5 tabs (task 6.5). The
 * screen title (Display role, ink) on the app base, plus optional children for
 * throwaway/dev content. Real content lands in later phases (Discover = 8,
 * Chat/Track = 9/11, etc.).
 */
export function TabPlaceholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <View className="px-4 pt-2">
        <Text className="font-geist-bold text-display text-ink">{title}</Text>
        {children}
      </View>
    </SafeAreaView>
  );
}
