import { Text, View } from 'react-native';

type BrandMark = { background: string; foreground: string; monogram: string };

// Restrained, code-native marks for the ten fictional Discovery brands. Unknown
// brands intentionally retain the standard initials fallback below.
const SAMPLE_BRAND_MARKS: Record<string, BrandMark> = {
  'Zephyra Naturals': { background: '#E6EFE4', foreground: '#355D3E', monogram: 'ZN' },
  'Vridhi Foods': { background: '#F8E6D1', foreground: '#A6502B', monogram: 'VF' },
  'Trailhaus Apparel': { background: '#E8E6DE', foreground: '#4C514B', monogram: 'TH' },
  PaisaPilot: { background: '#E3ECF3', foreground: '#255C7B', monogram: 'P/' },
  'Lernova Edtech': { background: '#EEE8F7', foreground: '#60469A', monogram: 'L*' },
  'Wanderloop Travel': { background: '#E0F0EE', foreground: '#26716A', monogram: 'W°' },
  'Baseline Fitness Co.': { background: '#F4E6E4', foreground: '#A4483D', monogram: 'B=' },
  Ripplekart: { background: '#E5EBF7', foreground: '#405C9A', monogram: 'R~' },
  'Momento Snacks': { background: '#F8EACC', foreground: '#A26920', monogram: 'M.' },
  'Northstar Skincare': { background: '#E5EDF4', foreground: '#385D79', monogram: 'N*' },
};

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
      <Text
        className={`font-geist-semibold ${large ? 'text-title' : 'text-secondary'}`}
        style={{ color: mark?.foreground ?? '#625E58' }}
      >
        {mark?.monogram ?? initials}
      </Text>
    </View>
  );
}
