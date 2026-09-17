import { useEffect, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Animated from 'react-native-reanimated';

import { MediaKitView } from '@/components/media-kit/media-kit-view';
import { ConnectSheet } from '@/components/discovery/connect-sheet';
import { Skeleton } from '@/components/motion/skeleton';
import { DetailHeader, useDetailHeaderScroll } from '@/components/ui/detail-header';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchCreatorMediaKitById, type CreatorMediaKit } from '@/lib/media-kit';

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
  const insets = useSafeAreaInsets();
  const { onScroll, scrolled } = useDetailHeaderScroll();

  const goBack = () => router.back();

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
      <DetailHeader title={data?.displayName ?? 'Creator profile'} scrolled={scrolled} onBack={goBack} />

      {loading ? (
        <Skeleton.Profile />
      ) : !data ? (
        <EmptyState title="This profile couldn’t be loaded" description="Go back and try another profile." actionLabel="Go back" onAction={goBack} />
      ) : (
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <MediaKitView data={data} viewerMode="brand" onConnect={() => setConnecting(true)} />
        </Animated.ScrollView>
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
