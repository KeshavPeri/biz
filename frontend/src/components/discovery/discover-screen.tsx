import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Extrapolation,
  LayoutAnimationConfig,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';

import { CreatorCard } from '@/components/discovery/creator-card';
import { BrandCard } from '@/components/discovery/brand-card';
import { FilterChips } from '@/components/discovery/filter-chips';
import { ListItemFade } from '@/components/motion/list-item-fade';
import { Skeleton } from '@/components/motion/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollEdgeScrim } from '@/components/ui/scroll-edge-scrim';
import { useMotion } from '@/components/motion/use-motion';
import {
  fetchBrandsForBrowse,
  fetchCreatorsForBrowse,
  getMyAccountType,
  type BrandCardData,
  type CreatorCardData,
} from '@/lib/discovery';
import { platformLabel } from '@/lib/media-kit-enums';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useAuthStore } from '@/store/auth-store';

const cap = (s: string) => (s.length ? s[0].toUpperCase() + s.slice(1) : s);
const uniqSorted = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((x): x is string => Boolean(x && x.trim())))].sort((a, b) => a.localeCompare(b));

/**
 * Discover — the marketplace front door (8.2). Direction depends on the signed-in
 * account type: a BRAND browses creators (B2-001), a CREATOR browses brands
 * (B2-005). Search + facet filters are client-side over the fetched (RLS-governed)
 * set. Tapping a card opens the detail route, which keeps this screen mounted so
 * filters survive the round trip.
 */
export function DiscoverScreen() {
  const session = useAuthStore((s) => s.session);
  const tabBarInset = useTabBarInset();
  const [accountType, setAccountType] = useState<'creator' | 'brand' | null>(null);
  const [creators, setCreators] = useState<CreatorCardData[]>([]);
  const [brands, setBrands] = useState<BrandCardData[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [niche, setNiche] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    const type = await getMyAccountType(session.user.id);
    setAccountType(type);
    if (type === 'brand') setCreators(await fetchCreatorsForBrowse());
    else if (type === 'creator') setBrands(await fetchBrandsForBrowse());
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  // Facet options derived from the fetched set.
  const creatorNiches = useMemo(
    () => uniqSorted(creators.flatMap((c) => c.niches.map(cap))),
    [creators],
  );
  const creatorPlatforms = useMemo(
    () => uniqSorted(creators.flatMap((c) => c.platforms.map(platformLabel))),
    [creators],
  );
  const creatorCities = useMemo(() => uniqSorted(creators.map((c) => c.city)), [creators]);
  const brandIndustries = useMemo(() => uniqSorted(brands.map((b) => b.industry)), [brands]);
  const brandCities = useMemo(() => uniqSorted(brands.map((b) => b.hqCity)), [brands]);

  const filteredCreators = useMemo(() => {
    const q = search.trim().toLowerCase();
    return creators.filter((c) => {
      if (q && !c.displayName.toLowerCase().includes(q)) return false;
      if (niche && !c.niches.some((n) => n.toLowerCase() === niche.toLowerCase())) return false;
      if (platform && !c.platforms.some((p) => platformLabel(p) === platform)) return false;
      if (city && c.city !== city) return false;
      return true;
    });
  }, [creators, search, niche, platform, city]);

  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    return brands.filter((b) => {
      if (q && !b.companyName.toLowerCase().includes(q)) return false;
      if (industry && b.industry !== industry) return false;
      if (city && b.hqCity !== city) return false;
      return true;
    });
  }, [brands, search, industry, city]);

  // Scroll-linked header: the large title fades as it leaves, and the pinned search
  // row gains its backing only once content is actually passing beneath it.
  const { reduce } = useMotion();
  const scrollY = useSharedValue(0);
  const titleH = useSharedValue(56);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const onTitleLayout = (e: LayoutChangeEvent) => {
    titleH.value = e.nativeEvent.layout.height;
  };
  const edge = useDerivedValue(() =>
    interpolate(scrollY.value, [titleH.value - 4, titleH.value + 8], [0, 1], Extrapolation.CLAMP)
  );
  const titleStyle = useAnimatedStyle(() =>
    reduce
      ? {}
      : { opacity: interpolate(scrollY.value, [0, titleH.value * 0.8], [1, 0], Extrapolation.CLAMP) }
  );

  const isBrand = accountType === 'brand';
  const count = isBrand ? filteredCreators.length : filteredBrands.length;

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // The search row (child 1) pins once the large title has scrolled away.
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: tabBarInset + 16 }}
        scrollIndicatorInsets={{ bottom: tabBarInset }}
      >
        <Animated.View onLayout={onTitleLayout} style={[styles.title, titleStyle]}>
          <Text className="font-geist-bold text-display text-ink">Discover</Text>
        </Animated.View>

        <View style={styles.searchRow}>
          <ScrollEdgeScrim progress={edge} />
          <View className="rounded-input bg-surface-recess px-4 py-3 shadow-recessInset">
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={loading ? 'Search' : isBrand ? 'Creators by name' : 'Brands by name'}
              placeholderTextColor="#847F78"
              className="font-geist text-body text-ink"
              autoCapitalize="none"
              editable={!loading}
            />
          </View>
        </View>

        {loading ? (
          <View className="px-4 pt-1">
            <Skeleton.CardGrid columns={2} rows={3} />
          </View>
        ) : (
          <View className="px-4 pt-1">
          {isBrand ? (
            <>
              <FilterChips label="Niche" options={creatorNiches} selected={niche} onSelect={setNiche} />
              <FilterChips label="Platform" options={creatorPlatforms} selected={platform} onSelect={setPlatform} />
              <FilterChips label="City" options={creatorCities} selected={city} onSelect={setCity} />
            </>
          ) : (
            <>
              <FilterChips label="Industry" options={brandIndustries} selected={industry} onSelect={setIndustry} />
              <FilterChips label="City" options={brandCities} selected={city} onSelect={setCity} />
            </>
          )}

          <Text className="mb-3 mt-2 font-geist-semibold text-subtitle text-ink">
            {count} {isBrand ? (count === 1 ? 'creator' : 'creators') : count === 1 ? 'brand' : 'brands'}
          </Text>

          {count === 0 ? (
            <EmptyState
              title="Nothing matches those filters"
              description="Try a different search or clear the filters to see everyone available."
              actionLabel="Clear filters"
              onAction={() => {
                setSearch('');
                setNiche(null);
                setPlatform(null);
                setCity(null);
                setIndustry(null);
              }}
            />
          ) : isBrand ? (
            <LayoutAnimationConfig skipEntering>
              <View className="flex-row flex-wrap justify-between gap-y-3">
                {filteredCreators.map((c) => (
                  <ListItemFade key={c.creatorId} className="w-[48.5%]">
                    <CreatorCard creator={c} onPress={() => router.push(`/creator/${c.creatorId}` as Href)} />
                  </ListItemFade>
                ))}
              </View>
            </LayoutAnimationConfig>
          ) : (
            <LayoutAnimationConfig skipEntering>
              {filteredBrands.map((b) => (
                <ListItemFade key={b.brandId}>
                  <BrandCard brand={b} onPress={() => router.push(`/brand/${b.brandId}` as Href)} />
                </ListItemFade>
              ))}
            </LayoutAnimationConfig>
          )}
          </View>
        )}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  // Vertical padding gives the pinned field breathing room from the top edge.
  searchRow: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
});
