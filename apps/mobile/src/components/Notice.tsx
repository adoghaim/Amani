import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme';
import { Text } from './Text';

type NoticeTone = 'info' | 'success' | 'error';

interface NoticeProps {
  children: React.ReactNode;
  tone?: NoticeTone;
  style?: StyleProp<ViewStyle>;
}

const toneStyles = StyleSheet.create({
  info: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
  },
  success: {
    backgroundColor: '#EEF8F3',
    borderColor: '#CBE7D9',
  },
  error: {
    backgroundColor: '#FDEEEF',
    borderColor: '#F4C7CF',
  },
});

const toneText = {
  info: 'default',
  success: 'success',
  error: 'danger',
} as const;

export function Notice({ children, tone = 'info', style }: NoticeProps) {
  return (
    <View style={[styles.notice, toneStyles[tone], style]}>
      <Text variant="bodySm" tone={toneText[tone]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderWidth: theme.borders.thin,
    borderRadius: theme.radii.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
});
