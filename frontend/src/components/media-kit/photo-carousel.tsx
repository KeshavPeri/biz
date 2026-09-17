import { useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StorageImage } from '@/components/media-kit/storage-image';

/**
 * PhotoCarousel — read-only swipeable pager of a creator's profile photos (B2-031),
 * used as the media-kit hero background. Horizontal paged ScrollView + dot
 * indicator. The caller overlays a scrim + the name/meta on top. When there are no
 * photos the caller renders its gradient fallback instead (this returns null).
 */
export function PhotoCarousel({ paths, height }: { paths: string[]; height: number }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  if (paths.length === 0) return null;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1));
    if (next !== index) setIndex(next);
  };

  const movePager = (next: number) => {
    const clamped = Math.max(0, Math.min(paths.length - 1, next));
    setIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
  };

  return (
    <View style={{ height }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={paths.length > 1}
      >
        {paths.map((path) => (
          <View key={path} style={{ width, height }}>
            <StorageImage path={path} className="h-full w-full" />
          </View>
        ))}
      </ScrollView>

      {paths.length > 1 ? (
        <View
          className="absolute inset-x-0 flex-row items-center justify-center gap-1.5"
          style={{ top: Math.max(insets.top + 8, 16) }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Photo pager"
          accessibilityValue={{ text: `Photo ${index + 1} of ${paths.length}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') movePager(index + 1);
            if (event.nativeEvent.actionName === 'decrement') movePager(index - 1);
          }}
        >
          {paths.map((path, i) => (
            <View
              key={path}
              className={`h-1.5 rounded-full ${
                i === index ? 'w-4 bg-white' : 'w-1.5 bg-[rgba(251,250,246,0.5)]'
              }`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
