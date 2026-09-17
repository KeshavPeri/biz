import { useEffect, useState } from 'react';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Animated from 'react-native-reanimated';

import { BrandProfileView } from '@/components/discovery/brand-profile-view';
import { ConnectSheet } from '@/components/discovery/connect-sheet';
import { Skeleton } from '@/components/motion/skeleton';
import { DetailHeader, useDetailHeaderScroll } from '@/components/ui/detail-header';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchBrandProfileById, type BrandProfile } from '@/lib/media-kit';

/**
 * Brand detail (B2-006 / B2-038) — a creator-facing read of a brand's public
 * business profile. Connect CTA is a disabled placeholder (Phase 9).
 */
export default function BrandDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<BrandProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const insets = useSafeAreaInsets();
  const { onScroll, scrolled } = useDetailHeaderScroll();

  const goBack = () => router.back();

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchBrandProfileById(String(id)).then((brand) => {
      if (active) {
        setData(brand);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <SafeAreaView className="flex-1 bg-app" edges={['top']}>
      <DetailHeader title={data?.companyName ?? 'Brand profile'} scrolled={scrolled} onBack={goBack} />

      {loading ? (
        <Skeleton.Profile />
      ) : !data ? (
        <EmptyState title="This brand couldn’t be loaded" description="Go back and try another profile." actionLabel="Go back" onAction={goBack} />
      ) : (
        <Animated.ScrollView
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <BrandProfileView data={data} onConnect={() => setConnecting(true)} />
        </Animated.ScrollView>
      )}

      {data ? (
        <ConnectSheet
          visible={connecting}
          onClose={() => setConnecting(false)}
          targetType="brand"
          targetId={data.brandId}
          targetName={data.companyName}
        />
      ) : null}
    </SafeAreaView>
  );
}
