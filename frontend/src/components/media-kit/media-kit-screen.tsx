import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollEdgeScrim } from '@/components/ui/scroll-edge-scrim';
import { Toggle } from '@/components/ui/toggle';
import { MediaKitView } from '@/components/media-kit/media-kit-view';
import { EditProfileSheet } from '@/components/media-kit/editors/edit-profile-sheet';
import { EditHandleSheet } from '@/components/media-kit/editors/edit-handle-sheet';
import { RateCardEditor } from '@/components/media-kit/editors/rate-card-editor';
import { PrivacySheet } from '@/components/media-kit/editors/privacy-sheet';
import { AffiliationsEditor } from '@/components/media-kit/editors/affiliations-editor';
import { PhotosEditor } from '@/components/media-kit/editors/photos-editor';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { fetchOwnMediaKit, type MediaKitData, type SocialHandle } from '@/lib/media-kit';
import { useAuthStore } from '@/store/auth-store';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';

type Editor = 'profile' | 'handle' | 'rate' | 'privacy' | 'affiliations' | 'photos' | null;

/**
 * The "You" tab container (Phase 8, Cluster A). Fetches the signed-in user's own
 * media kit and dispatches: creators get the full editable kit + a "Preview as
 * brand" toggle; brands get the compact brand-profile editor. All edits go through
 * bottom-sheet editors that write owned records under RLS, then refetch.
 */
export function MediaKitScreen() {
  const session = useAuthStore((s) => s.session);
  const tabBarInset = useTabBarInset();
  const [data, setData] = useState<MediaKitData | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'not_onboarded' | 'error'>('loading');
  const [preview, setPreview] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [activeHandle, setActiveHandle] = useState<SocialHandle | null>(null);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const [headerHeight, setHeaderHeight] = useState(52);
  // The header's backing appears only once the hero has started passing beneath it.
  const headerEdge = useDerivedValue(() =>
    interpolate(scrollY.value, [0, 12], [0, 1], Extrapolation.CLAMP)
  );

  const load = useCallback(async () => {
    if (!session) {
      setLoadState('error');
      return;
    }
    setLoadState('loading');
    const result = await fetchOwnMediaKit(session.user.id);
    if (result.status === 'ok') {
      setData(result.data);
    } else {
      setData(null);
    }
    setLoadState(result.status);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch after an edit, then close the sheet.
  const clearActiveHandleAfterDismiss = useCallback(() => {
    setTimeout(() => setActiveHandle(null), 240);
  }, []);

  const closeHandle = useCallback(() => {
    setEditor(null);
    clearActiveHandleAfterDismiss();
  }, [clearActiveHandleAfterDismiss]);

  const afterSave = useCallback(async () => {
    await load();
    setEditor(null);
    if (editor === 'handle') clearActiveHandleAfterDismiss();
    else setActiveHandle(null);
  }, [clearActiveHandleAfterDismiss, editor, load]);

  // Rate-card / affiliation editors stay open across mutations (list editing).
  const afterChange = useCallback(async () => {
    await load();
  }, [load]);

  if (loadState === 'loading') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-transparent" edges={['top']}>
        <ActivityIndicator color="#847F78" />
      </SafeAreaView>
    );
  }

  if (loadState === 'not_onboarded') {
    return (
      <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
        <View className="px-4 pt-2">
          <Text className="font-geist-bold text-display text-ink">You</Text>
          <Text className="mt-3 font-geist text-body text-ink-2">
            Finish onboarding to build your profile.
          </Text>
          <Pressable
            className="mt-5 items-center justify-center rounded-button bg-ink py-3.5"
            onPress={() => router.replace('/(onboarding)/role')}
            accessibilityRole="button"
          >
            <Text className="font-geist-semibold text-body text-white">Continue onboarding</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loadState === 'error' || !data) {
    return (
      <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
        <View className="px-4 pt-2">
          <Text className="font-geist-bold text-display text-ink">You</Text>
          <Text className="mt-3 font-geist text-body text-ink-2">
            Couldn&apos;t load your profile. Check your connection and try again.
          </Text>
          <Pressable
            className="mt-5 items-center justify-center rounded-button border border-hairline-card bg-surface-card py-3.5"
            onPress={() => void load()}
            accessibilityRole="button"
          >
            <Text className="font-geist-semibold text-body text-ink">Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (data.kind === 'brand') {
    return <BrandScreen data={data} onSaved={afterSave} editing={editor === 'profile'} setEditing={(v) => setEditor(v ? 'profile' : null)} />;
  }

  const isPreview = preview;

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Content starts below the overlaid header, then scrolls up beneath it.
        contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: tabBarInset + 16 }}
        scrollIndicatorInsets={{ top: headerHeight, bottom: tabBarInset }}
      >
        <MediaKitView
          data={data}
          viewerMode={isPreview ? 'brand' : 'own'}
          scrollY={scrollY}
          edit={
            isPreview
              ? undefined
              : {
                  onEditProfile: () => setEditor('profile'),
                  onEditHandle: (h) => {
                    setActiveHandle(h);
                    setEditor('handle');
                  },
                  onEditRateCard: () => setEditor('rate'),
                  onEditPrivacy: () => setEditor('privacy'),
                  onEditAffiliations: () => setEditor('affiliations'),
                  onEditPhotos: () => setEditor('photos'),
                }
          }
        />
      </Animated.ScrollView>

      {/* Header overlays the scroll so the hero dissolves beneath it instead of being sliced. */}
      <View
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      >
        <ScrollEdgeScrim progress={headerEdge} />
        {/* Top bar — Preview-as-brand toggle. */}
        <View className="flex-row items-center justify-between gap-3 px-4 py-2">
          <Text numberOfLines={1} className="flex-shrink font-geist-bold text-title text-ink">
            Your media kit
          </Text>
          {/* Never shrinks: the switch and its label stay on one line, aligned, at 320pt. */}
          <View className="flex-shrink-0 flex-row items-center gap-2">
            <Text numberOfLines={1} className="font-geist-medium text-secondary text-ink-2">
              Preview as brand
            </Text>
            <Toggle value={isPreview} onValueChange={setPreview} accessibilityLabel="Preview as brand" />
          </View>
        </View>

        {isPreview ? (
          <View className="mx-4 mb-1 flex-row items-center gap-2 rounded-panel bg-surface-recess px-3.5 py-2 shadow-recessInset">
            <Text className="flex-1 font-geist text-secondary text-ink-2">
              This is roughly what a brand sees. Real visibility is enforced server-side.
            </Text>
            <Pressable onPress={() => setPreview(false)} accessibilityRole="button">
              <Text className="font-geist-semibold text-secondary text-ink">Exit</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Editors. */}
      <EditProfileSheet visible={editor === 'profile'} onClose={() => setEditor(null)} onSaved={afterSave} data={data} />
      <EditHandleSheet
        visible={editor === 'handle'}
        onClose={closeHandle}
        onSaved={afterSave}
        handle={activeHandle}
      />
      <RateCardEditor
        visible={editor === 'rate'}
        onClose={() => setEditor(null)}
        onChanged={afterChange}
        creatorId={data.creatorId}
        rateCard={data.rateCard}
      />
      <PrivacySheet visible={editor === 'privacy'} onClose={() => setEditor(null)} onSaved={afterSave} data={data} />
      <AffiliationsEditor
        visible={editor === 'affiliations'}
        onClose={() => setEditor(null)}
        onChanged={afterChange}
        creatorId={data.creatorId}
        profileId={data.profileId}
        affiliations={data.affiliations}
      />
      <PhotosEditor
        visible={editor === 'photos'}
        onClose={() => setEditor(null)}
        onChanged={afterChange}
        userId={data.profileId}
        photoCarousel={data.photoCarousel}
      />
    </SafeAreaView>
  );
}

// ── Brand: compact profile editor (B2-036 brand half) ────────────────────────

function BrandScreen({
  data,
  onSaved,
  editing,
  setEditing,
}: {
  data: Extract<MediaKitData, { kind: 'brand' }>;
  onSaved: () => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  const tabBarInset = useTabBarInset();
  const attrs = data.profileAttributes ?? {};
  const rows: { label: string; value: string }[] = [
    { label: 'Industry', value: data.industry ?? '—' },
    { label: 'Website', value: data.domain ?? '—' },
    { label: 'HQ city', value: typeof attrs.hq_city === 'string' ? attrs.hq_city : '—' },
    { label: 'Verified', value: data.verified ? 'Yes' : 'Not yet' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="px-4 pt-2"
        contentContainerStyle={{ paddingBottom: tabBarInset + 16 }}
        scrollIndicatorInsets={{ bottom: tabBarInset }}
      >
        <Text className="font-geist-bold text-display text-ink">{data.companyName}</Text>
        <Text className="mt-1 font-geist text-body text-ink-2">Your brand profile in Discovery.</Text>

        <View className="mt-5 rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1">
          {rows.map((r, i) => (
            <View
              key={r.label}
              className={`flex-row items-center justify-between py-2.5 ${
                i === 0 ? '' : 'border-t border-hairline'
              }`}
            >
              <Text className="font-geist text-body text-ink-2">{r.label}</Text>
              <Text className="font-geist-semibold text-body text-ink">{r.value}</Text>
            </View>
          ))}
        </View>

        <Pressable
          className="mt-5 items-center justify-center rounded-button bg-ink py-3.5"
          onPress={() => setEditing(true)}
          accessibilityRole="button"
        >
          <Text className="font-geist-semibold text-body text-white">Edit brand profile</Text>
        </Pressable>
      </ScrollView>

      <EditProfileSheet visible={editing} onClose={() => setEditing(false)} onSaved={onSaved} data={data} />
    </SafeAreaView>
  );
}
