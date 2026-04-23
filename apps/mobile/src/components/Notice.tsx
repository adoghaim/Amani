import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { theme } from '../theme';
import { Text } from './Text';

type NoticeTone = 'info' | 'success' | 'error';

interface NoticeProps {
  children: React.ReactNode;
  tone?: NoticeTone;
  style?: StyleProp<ViewStyle>;
  actionLabel?: string;
  onAction?: (() => void) | null;
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

export function Notice({
  children,
  tone = 'info',
  style,
  actionLabel,
  onAction,
}: NoticeProps) {
  const content =
    typeof children === 'string' || typeof children === 'number' ? (
      <Text variant="bodySm" tone={toneText[tone]}>
        {children}
      </Text>
    ) : (
      children
    );

  return (
    <View style={[styles.notice, toneStyles[tone], style]}>
      <View style={styles.row}>
        <View style={styles.copy}>{content}</View>
        {actionLabel && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction} style={styles.action}>
            <Text variant="bodySm" tone="primary" weight="semibold">
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  copy: {
    flex: 1,
  },
  action: {
    paddingVertical: theme.spacing.xxs,
  },
});
