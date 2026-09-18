import { Text, View } from 'react-native';

export function LogoTile({ name, size = 'small' }: { name: string; size?: 'small' | 'large' }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || '?';
  const large = size === 'large';

  return (
    <View
      accessibilityLabel={`${name} logo`}
      className={`items-center justify-center bg-avatar ${large ? 'h-16 w-16 rounded-panel' : 'h-11 w-11 rounded-panel'}`}
      style={{ borderWidth: 1, borderColor: 'rgba(28,27,24,0.09)' }}
    >
      <Text className={`font-geist-semibold ${large ? 'text-title' : 'text-secondary'} text-ink-2`}>
        {initials}
      </Text>
    </View>
  );
}
