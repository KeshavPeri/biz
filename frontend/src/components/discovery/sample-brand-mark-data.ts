export type SampleBrandMark = {
  background: string;
  foreground: string;
  symbol: 'leaf' | 'wheat' | 'mountain' | 'compass' | 'book' | 'pin' | 'dumbbell' | 'ripple' | 'cookie' | 'star';
};

export const SAMPLE_BRAND_MARKS: Record<string, SampleBrandMark> = {
  'Zephyra Naturals': { background: '#E6EFE4', foreground: '#355D3E', symbol: 'leaf' },
  'Vridhi Foods': { background: '#F8E6D1', foreground: '#A6502B', symbol: 'wheat' },
  'Trailhaus Apparel': { background: '#E8E6DE', foreground: '#4C514B', symbol: 'mountain' },
  PaisaPilot: { background: '#E3ECF3', foreground: '#255C7B', symbol: 'compass' },
  'Lernova Edtech': { background: '#EEE8F7', foreground: '#60469A', symbol: 'book' },
  'Wanderloop Travel': { background: '#E0F0EE', foreground: '#26716A', symbol: 'pin' },
  'Baseline Fitness Co.': { background: '#F4E6E4', foreground: '#A4483D', symbol: 'dumbbell' },
  Ripplekart: { background: '#E5EBF7', foreground: '#405C9A', symbol: 'ripple' },
  'Momento Snacks': { background: '#F8EACC', foreground: '#A26920', symbol: 'cookie' },
  'Northstar Skincare': { background: '#E5EDF4', foreground: '#385D79', symbol: 'star' },
};
