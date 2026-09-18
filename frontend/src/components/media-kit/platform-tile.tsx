import { Text, View } from 'react-native';

export function PlatformTile({ label, size = 'small' }: { label: string; size?: 'small' | 'large' }) {
  const large = size === 'large';
  return (
    <View
      accessibilityLabel={`${label} platform`}
      className={`items-center justify-center border border-hairline bg-avatar ${large ? 'h-10 w-10 rounded-panel' : 'h-7 w-7 rounded-pill'}`}
    >
      <Text className={`font-geist-semibold ${large ? 'text-body' : 'text-micro'} text-ink`}>
        {label.trim()[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}
