import { Platform } from 'react-native';

// Tonal blue range: light (backgrounds/fills) -> mid (secondary) -> deep (primary actions/active).
export const blue = {
  light50: '#F0F6FF',
  light100: '#DBEAFE',
  light200: '#BFDBFE',
  mid400: '#60A5FA',
  mid500: '#3B82F6',
  deep700: '#1D4ED8',
  deep800: '#1E40AF',
  deep900: '#1E3A8A',
};

export const colors = {
  bg: blue.light50,
  white: '#FFFFFF',
  primary: blue.deep700,
  primaryDark: blue.deep900,
  primaryTint: blue.light100,
  mid: blue.mid500,
  midSoft: blue.light200,
  teal: '#14B8A6',
  amber: '#F59E0B',
  coral: '#F97316',
  green: '#22C55E',
  red: '#EF4444',
  muted: '#E4EEFC',
  text: '#0F1B33',
  textSoft: '#5B6B86',
  border: '#D3E0F5',
  overlay: 'rgba(15,27,51,0.45)',
};

export const radius = 12;

// The wordmark font is the ONE place Plush (Fontfabric) may be used. Plush needs Fontfabric's paid
// App license before it is embedded in the APK, so until the font file is added the wordmark
// falls back to Instrument Serif. To switch: add the licensed font to assets/fonts, load it in
// App.tsx with useFonts, and set wordmark to that family name below.
export const fonts = {
  heading: 'InstrumentSerif_400Regular',
  body: 'WorkSans_400Regular',
  medium: 'WorkSans_500Medium',
  semibold: 'WorkSans_600SemiBold',
  bold: 'WorkSans_700Bold',
  wordmark: 'InstrumentSerif_400Regular',
};

export const shadow = Platform.select({
  android: { elevation: 2 },
  default: {
    shadowColor: '#1E3A8A',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
});

export const chartColors = [blue.deep700, colors.teal, colors.amber, colors.coral, '#8B5CF6', '#EC4899'];
