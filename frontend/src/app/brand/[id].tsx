import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

import { BrandProfileView } from '@/components/discovery/brand-profile-view';
import { ConnectSheet } from '@/components/discovery/connect-sheet';
import { fetchBrandProfileById, type BrandProfile } from '@/lib/media-kit';

import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';

/**
 * Brand detail (B2-006 / B2-038) — a creator-facing read of a brand's public
 * business profile. Connect CTA is a disabled placeholder (Phase 9).
 */
export default function BrandDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<BrandProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

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
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#847F78" />
        </View>
      ) : !data ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center font-geist text-body text-ink-2">
            This brand couldn’t be loaded.
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-16">
          <BrandProfileView data={data} onConnect={() => setConnecting(true)} />
        </ScrollView>
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
