import React from 'react';
import {
  Text as RNText,
  StyleSheet,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import { theme } from '../theme';

type TextVariant =
  | 'display'
  | 'title'
  | 'titleSm'
  | 'body'
  | 'bodySm'
  | 'label'
  | 'caption';

type TextTone =
  | 'default'
  | 'muted'
  | 'subtle'
  | 'primary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'inverse';

type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: TextWeight;
  style?: StyleProp<TextStyle>;
}

const styles = StyleSheet.create({
  base: {
    color: theme.colors.textBody,
  },
  display: {
    fontSize: theme.typography.size.xxl,
    lineHeight: theme.typography.lineHeight.xxl,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.text,
  },
  title: {
    fontSize: theme.typography.size.xl,
    lineHeight: theme.typography.lineHeight.xl,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.text,
  },
  titleSm: {
    fontSize: theme.typography.size.lg,
    lineHeight: theme.typography.lineHeight.lg,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.text,
  },
  body: {
    fontSize: theme.typography.size.md,
    lineHeight: theme.typography.lineHeight.md,
    fontWeight: theme.typography.weight.regular,
  },
  bodySm: {
    fontSize: theme.typography.size.sm,
    lineHeight: theme.typography.lineHeight.sm,
    fontWeight: theme.typography.weight.regular,
  },
  label: {
    fontSize: theme.typography.size.sm,
    lineHeight: theme.typography.lineHeight.sm,
    fontWeight: theme.typography.weight.semibold,
  },
  caption: {
    fontSize: theme.typography.size.xs,
    lineHeight: theme.typography.lineHeight.xs,
    fontWeight: theme.typography.weight.medium,
  },
  defaultTone: {
    color: theme.colors.text,
  },
  mutedTone: {
    color: theme.colors.mutedText,
  },
  subtleTone: {
    color: theme.colors.mutedText3,
  },
  primaryTone: {
    color: theme.colors.primary,
  },
  accentTone: {
    color: theme.colors.accent,
  },
  successTone: {
    color: theme.colors.success,
  },
  warningTone: {
    color: theme.colors.warning,
  },
  dangerTone: {
    color: theme.colors.danger,
  },
  inverseTone: {
    color: theme.colors.white,
  },
  regular: {
    fontWeight: theme.typography.weight.regular,
  },
  medium: {
    fontWeight: theme.typography.weight.medium,
  },
  semibold: {
    fontWeight: theme.typography.weight.semibold,
  },
  bold: {
    fontWeight: theme.typography.weight.bold,
  },
});

const variantStyles: Record<TextVariant, TextStyle> = {
  display: styles.display,
  title: styles.title,
  titleSm: styles.titleSm,
  body: styles.body,
  bodySm: styles.bodySm,
  label: styles.label,
  caption: styles.caption,
};

const toneStyles: Record<TextTone, TextStyle> = {
  default: styles.defaultTone,
  muted: styles.mutedTone,
  subtle: styles.subtleTone,
  primary: styles.primaryTone,
  accent: styles.accentTone,
  success: styles.successTone,
  warning: styles.warningTone,
  danger: styles.dangerTone,
  inverse: styles.inverseTone,
};

const weightStyles: Record<TextWeight, TextStyle> = {
  regular: styles.regular,
  medium: styles.medium,
  semibold: styles.semibold,
  bold: styles.bold,
};

export function Text({
  variant = 'body',
  tone = 'default',
  weight,
  style,
  ...props
}: TextProps) {
  return (
    <RNText
      style={[
        styles.base,
        variantStyles[variant],
        toneStyles[tone],
        weight ? weightStyles[weight] : null,
        style,
      ]}
      {...props}
    />
  );
}
