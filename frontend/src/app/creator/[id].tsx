import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import { MediaKitView } from '@/components/media-kit/media-kit-view';
import { ConnectSheet } from '@/components/discovery/connect-sheet';
import { Skeleton } from '@/components/motion/skeleton';
import { fetchCreatorMediaKitById, type CreatorMediaKit } from '@/lib/media-kit';

import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';

/**
 * Creator detail (B2-002) — the full media kit from a brand's perspective. REUSES
 * MediaKitView with viewerMode='brand' (no fork); the rate card appears only if RLS
 * returned it (brand accounts see enabled cards). The "Start a deal" CTA inside
 * MediaKitView is a disabled placeholder (Phase 9).
 */
export default function CreatorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<CreatorMediaKit | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchCreatorMediaKitById(String(id)).then((kit) => {
      if (active) {
        setData(kit);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <SafeAreaView className="flex-1 bg-app" edges={['top']}>
      <View className="flex-row items-center px-2 py-2">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-10 w-10 items-center justify-center"
        >
          <ChevronLeftIcon width={24} height={24} color="#1C1B18" />
        </Pressable>
      </View>

      {loading ? (
        <Skeleton.Profile />
      ) : !data ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center font-geist text-body text-ink-2">
            This profile couldn’t be loaded.
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-16">
          <MediaKitView data={data} viewerMode="brand" onConnect={() => setConnecting(true)} />
        </ScrollView>
      )}

      {data ? (
        <ConnectSheet
          visible={connecting}
          onClose={() => setConnecting(false)}
          targetType="creator"
          // profiles.id (account_type lives on profiles) — NOT creator_profiles.id.
          targetId={data.profileId}
          targetName={data.displayName}
        />
      ) : null}
    </SafeAreaView>
  );
}
