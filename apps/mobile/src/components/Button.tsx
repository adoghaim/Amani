import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { theme } from '../theme';
import { Text } from './Text';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label?: string;
  children?: React.ReactNode;
  onPress: (event: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const sizeStyles = StyleSheet.create({
  sm: {
    minHeight: 40,
    paddingHorizontal: theme.spacing.md,
  },
  md: {
    minHeight: 48,
    paddingHorizontal: theme.spacing.lg,
  },
  lg: {
    minHeight: 56,
    paddingHorizontal: theme.spacing.xl,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    ...theme.shadows.button,
  },
  secondary: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
  },
  outline: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  danger: {
    backgroundColor: theme.colors.danger,
    borderColor: theme.colors.danger,
    ...theme.shadows.button,
  },
});

const pressedStyles = StyleSheet.create({
  primary: {
    backgroundColor: theme.colors.primaryDark,
    borderColor: theme.colors.primaryDark,
  },
  secondary: {
    backgroundColor: theme.colors.surfaceHover,
  },
  outline: {
    backgroundColor: theme.colors.surface2,
  },
  ghost: {
    backgroundColor: theme.colors.surface2,
  },
  danger: {
    opacity: 0.92,
  },
});

const textTones: Record<ButtonVariant, 'default' | 'inverse' | 'primary' | 'danger'> = {
  primary: 'inverse',
  secondary: 'default',
  outline: 'default',
  ghost: 'primary',
  danger: 'inverse',
};

const spinnerColors: Record<ButtonVariant, string> = {
  primary: theme.colors.white,
  secondary: theme.colors.text,
  outline: theme.colors.text,
  ghost: theme.colors.primary,
  danger: theme.colors.white,
};

const iconColors: Record<ButtonVariant, string> = {
  primary: theme.colors.white,
  secondary: theme.colors.text,
  outline: theme.colors.text,
  ghost: theme.colors.primary,
  danger: theme.colors.white,
};

const iconSizes: Record<ButtonSize, number> = {
  sm: 16,
  md: 18,
  lg: 20,
};

const labelVariants: Record<ButtonSize, 'bodySm' | 'label' | 'body'> = {
  sm: 'bodySm',
  md: 'label',
  lg: 'body',
};

function renderIcon(icon: React.ReactNode, color: string, size: number) {
  if (!React.isValidElement(icon)) {
    return icon;
  }

  const element = icon as React.ReactElement<Record<string, unknown>>;
  return React.cloneElement(element, {
    color: (element.props.color as string | undefined) ?? color,
    size: (element.props.size as number | undefined) ?? size,
  });
}

export function Button({
  label,
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  textStyle,
  icon,
  iconPosition = 'left',
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const iconNode = loading ? null : renderIcon(icon, iconColors[variant], iconSizes[size]);
  const buttonLabel =
    label ?? (typeof children === 'string' || typeof children === 'number' ? String(children) : null);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        sizeStyles[size],
        variantStyles[variant],
        fullWidth ? styles.fullWidth : null,
        pressed && !isDisabled ? pressedStyles[variant] : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColors[variant]} />
      ) : (
        <View style={styles.content}>
          {iconNode && iconPosition === 'left' ? iconNode : null}
          {buttonLabel ? (
            <Text
              variant={labelVariants[size]}
              tone={textTones[variant]}
              style={textStyle}
            >
              {buttonLabel}
            </Text>
          ) : (
            children
          )}
          {iconNode && iconPosition === 'right' ? iconNode : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: theme.radii.sm,
    borderWidth: theme.borders.thin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
  },
  disabled: {
    opacity: 0.55,
  },
});
