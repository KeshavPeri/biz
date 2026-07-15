import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';

import { getSignedProfilePhotoUrl } from '@/lib/media-kit';

const FILL = { width: '100%', height: '100%' } as const;

/**
 * StorageImage — the ONE place app-wide that turns a private-bucket storage PATH
 * into a rendered picture (Phase 8 B2-031). It resolves the path to a temporary
 * signed URL (the bucket is private — no public URLs) and renders it with
 * expo-image.
 *
 * The disk cache is keyed on `cacheKey={path}` — the STABLE storage path — not the
 * rotating signed URL, so a re-signed URL still hits the cache instead of
 * re-downloading identical bytes. `className` sizes/masks the wrapper View (a core
 * RN element NativeWind styles reliably); the image just fills it. While resolving
 * (or on failure) a neutral greige block shows so the layout never jumps.
 */
export function StorageImage({
  path,
  className,
  contentFit = 'cover',
}: {
  path: string | null | undefined;
  className?: string;
  contentFit?: 'cover' | 'contain';
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    if (path) {
      void getSignedProfilePhotoUrl(path).then((u) => {
        if (active) setUrl(u);
      });
    }
    return () => {
      active = false;
    };
  }, [path]);

  return (
    <View className={`overflow-hidden ${url ? '' : 'bg-avatar'} ${className ?? ''}`}>
      {url ? (
        <Image
          // cacheKey lives INSIDE the source (expo-image) so the disk cache keys on
          // the stable storage path, not the rotating signed URL.
          source={{ uri: url, cacheKey: path ?? undefined }}
          cachePolicy="disk"
          contentFit={contentFit}
          transition={150}
          style={FILL}
        />
      ) : null}
    </View>
  );
}
