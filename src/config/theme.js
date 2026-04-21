import { Dimensions } from 'react-native';

const { width } = Dimensions.get('window');
export const isSmallScreen = width < 380;

export const colors = {
  accent:     '#7C6AF7',
  accentDim:  '#5b4dd4',
  accentText: '#a99ff8',
  bg0:        '#09090E',
  bg1:        '#0D0D12',
  bg2:        '#13131A',
  bg3:        '#1A1A24',
  bg4:        '#22222F',
  text0:      '#F0EFF8',
  text1:      '#C4C3D0',
  text2:      '#8B8A9B',
  text3:      '#5A596A',
  teal:       '#2DD4BF',
  tealDim:    'rgba(45,212,191,0.08)',
  border:     'rgba(255,255,255,0.06)',
  borderMd:   'rgba(255,255,255,0.1)',
  error:      '#ef4444',
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
};

export const radius = {
  sm: 6, md: 10, lg: 16, full: 999,
};

export const typography = {
  fontMono: 'Courier New',
  fontSize: { xs: 11, sm: 12, md: 14, lg: 16, xl: 18, xxl: 22 },
};