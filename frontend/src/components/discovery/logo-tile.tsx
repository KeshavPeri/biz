import { Text, View } from 'react-native';

import { SampleBrandSymbol } from '@/components/discovery/sample-brand-mark';
import { SAMPLE_BRAND_MARKS } from '@/components/discovery/sample-brand-mark-data';

export function LogoTile({ name, size = 'small' }: { name: string; size?: 'small' | 'large' }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || '?';
  const large = size === 'large';
  const mark = SAMPLE_BRAND_MARKS[name];

  return (
    <View
      accessibilityLabel={`${name} logo`}
      className={`items-center justify-center ${large ? 'h-16 w-16 rounded-panel' : 'h-11 w-11 rounded-panel'}`}
      style={{
        borderWidth: 1,
        borderColor: 'rgba(28,27,24,0.09)',
        backgroundColor: mark?.background ?? '#E9E5DD',
      }}
    >
      {mark ? <SampleBrandSymbol mark={mark} size={large ? 34 : 24} /> : (
        <Text className={`font-geist-semibold ${large ? 'text-title' : 'text-secondary'} text-ink-2`}>
          {initials}
        </Text>
      )}
    </View>
  );
}
