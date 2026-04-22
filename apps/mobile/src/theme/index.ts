import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

const colors = {
  primary: '#C97C8B',
  primaryDark: '#A85C6D',
  primaryLight: '#E8B4BD',
  primaryFaded: '#D4A8B0',
  accent: '#7A3E55',
  background: '#FFF8F7',
  backgroundTint: '#FDF7F8',
  surface: '#FFFFFF',
  surface2: '#F6ECEB',
  surfaceHover: '#EED9D9',
  text: '#2A1F23',
  textBody: '#4A3A40',
  mutedText: '#6B5B60',
  mutedText2: '#7A6570',
  mutedText3: '#9A8A90',
  mutedText4: '#A8969C',
  border: '#E9D6DA',
  borderSubtle: '#E8DCE0',
  borderInner: '#F0E6EA',
  success: '#2F8F6B',
  warning: '#C78A2A',
  danger: '#B5475A',
  white: '#FFFFFF',
  black: '#000000',
} as const;

const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

const radii = {
  sm: 12,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

const typography = {
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 24,
    xxl: 30,
  },
  lineHeight: {
    xs: 16,
    sm: 20,
    md: 24,
    lg: 26,
    xl: 30,
    xxl: 36,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  } satisfies Record<string, TextStyle['fontWeight']>,
} as const;

const shadows = {
  card: Platform.select<ViewStyle>({
    ios: {
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 20,
    },
    android: {
      elevation: 3,
    },
    default: {},
  }) ?? {},
  button: Platform.select<ViewStyle>({
    ios: {
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08,
      shadowRadius: 16,
    },
    android: {
      elevation: 2,
    },
    default: {},
  }) ?? {},
} as const;

const borders = {
  hairline: StyleSheet.hairlineWidth,
  thin: 1,
} as const;

export const theme = {
  colors,
  spacing,
  radii,
  typography,
  shadows,
  borders,
} as const;

export type AppTheme = typeof theme;
