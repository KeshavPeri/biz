import { useState } from 'react';
import {
  useWindowDimensions,
  View,
  ScrollView,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';

import { StorageImage } from '@/components/media-kit/storage-image';

/**
 * PhotoCarousel — read-only swipeable pager of a creator's profile photos (B2-031),
 * used as the media-kit hero background. Horizontal paged ScrollView + dot
 * indicator. The caller overlays a scrim + the name/meta on top. When there are no
 * photos the caller renders its gradient fallback instead (this returns null).
 */
export function PhotoCarousel({ paths, height }: { paths: string[]; height: number }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);

  if (paths.length === 0) return null;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1));
    if (next !== index) setIndex(next);
  };

  return (
    <View style={{ height }}>
      <ScrollView
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
        <View className="absolute inset-x-0 bottom-2 flex-row items-center justify-center gap-1.5">
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
