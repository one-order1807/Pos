import { Platform } from 'react-native';

export const colors = {
  bg: '#F5F8FC',
  white: '#FFFFFF',
  primary: '#2563EB',
  primaryDark: '#1E40AF',
  primaryTint: '#DBEAFE',
  teal: '#14B8A6',
  amber: '#F59E0B',
  coral: '#F97316',
  green: '#22C55E',
  red: '#EF4444',
  muted: '#EAF1FB',
  text: '#0F1B33',
  textSoft: '#5B6B86',
  border: '#D9E3F3',
  overlay: 'rgba(15,27,51,0.45)',
};

export const radius = 12;

export const fonts = {
  heading: 'InstrumentSerif_400Regular',
  body: 'WorkSans_400Regular',
  medium: 'WorkSans_500Medium',
  semibold: 'WorkSans_600SemiBold',
  bold: 'WorkSans_700Bold',
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

export const chartColors = [colors.primary, colors.teal, colors.amber, colors.coral, '#8B5CF6', '#EC4899'];
