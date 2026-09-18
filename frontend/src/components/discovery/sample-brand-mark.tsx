import Svg, { Circle, Path } from 'react-native-svg';

import type { SampleBrandMark } from '@/components/discovery/sample-brand-mark-data';

/** Adapted from the CC0 sources listed in assets/icons/brand-marks/manifest.json. */
export function SampleBrandSymbol({ mark, size }: { mark: SampleBrandMark; size: number }) {
  const stroke = {
    stroke: mark.foreground,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const symbol = (() => {
    switch (mark.symbol) {
      case 'leaf':
        return <><Path d="M5.5 18.5C5.5 10.5 11 5 19 5c0 8-5.5 13.5-13.5 13.5Z" fill="none" {...stroke} /><Path d="M7 17 16.5 7.5" fill="none" {...stroke} /></>;
      case 'wheat':
        return <><Path d="M12 20.5V4" fill="none" {...stroke} /><Path d="m12 8-3-2.5M12 11l-3.5-2M12 14l-3.5-2M12 8l3-2.5M12 11l3.5-2M12 14l3.5-2" fill="none" {...stroke} /></>;
      case 'mountain':
        return <Path d="m3.5 18.5 5.8-9 3.2 4.6 2-2.8 6 7.2H3.5Z" fill="none" {...stroke} />;
      case 'compass':
        return <><Circle cx="12" cy="12" r="8" fill="none" {...stroke} /><Path d="m14.8 9.2-1.6 4-4 1.6 1.6-4 4-1.6Z" fill="none" {...stroke} /></>;
      case 'book':
        return <Path d="M4.5 5.5c3.4-.5 5.7.4 7.5 2.1 1.8-1.7 4.1-2.6 7.5-2.1v13c-3.4-.5-5.7.4-7.5 2.1-1.8-1.7-4.1-2.6-7.5-2.1v-13Z" fill="none" {...stroke} />;
      case 'pin':
        return <><Path d="M12 20s6-5.6 6-10a6 6 0 1 0-12 0c0 4.4 6 10 6 10Z" fill="none" {...stroke} /><Circle cx="12" cy="10" r="1.8" fill="none" {...stroke} /></>;
      case 'dumbbell':
        return <><Path d="m8.5 9 7 6" fill="none" {...stroke} /><Path d="m5.2 7.2 2.6 2.3-2.6 3-2.6-2.3 2.6-3ZM18.8 11.5l2.6 2.3-2.6 3-2.6-2.3 2.6-3Z" fill="none" {...stroke} /></>;
      case 'ripple':
        return <><Circle cx="12" cy="12" r="2" fill="none" {...stroke} /><Path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" fill="none" {...stroke} /></>;
      case 'cookie':
        return <><Path d="M17.5 5.5a4.5 4.5 0 0 1-5 5 4.5 4.5 0 0 1-5 5 6.5 6.5 0 1 0 10-10Z" fill="none" {...stroke} /><Circle cx="10" cy="17" r=".8" fill={mark.foreground} /><Circle cx="16" cy="15" r=".8" fill={mark.foreground} /></>;
      case 'star':
        return <Path d="m12 3.8 2.1 5.8 6.1.2-4.8 3.8 1.7 5.9-5.2-3.4-5.2 3.4 1.7-5.9-4.8-3.8 6.1-.2L12 3.8Z" fill="none" {...stroke} />;
    }
  })();

  return <Svg width={size} height={size} viewBox="0 0 24 24">{symbol}</Svg>;
}
