import React, { useState } from 'react';
import {
  TextInput as RNTextInput,
  StyleSheet,
  View,
  type StyleProp,
  type TextInputProps as RNTextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { theme } from '../theme';
import { Text } from './Text';

export interface InputProps extends RNTextInputProps {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export function Input({
  label,
  hint,
  error,
  leftIcon,
  rightIcon,
  containerStyle,
  inputStyle,
  onFocus,
  onBlur,
  multiline = false,
  editable = true,
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const helperText = error ?? hint;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="label" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          isFocused ? styles.fieldFocused : null,
          error ? styles.fieldError : null,
          !editable ? styles.fieldDisabled : null,
          multiline ? styles.fieldMultiline : null,
        ]}
      >
        {leftIcon ? <View style={styles.iconSlot}>{leftIcon}</View> : null}

        <RNTextInput
          editable={editable}
          multiline={multiline}
          placeholderTextColor={theme.colors.mutedText3}
          selectionColor={theme.colors.primary}
          style={[
            styles.input,
            multiline ? styles.inputMultiline : null,
            !editable ? styles.inputDisabled : null,
            inputStyle,
          ]}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />

        {rightIcon ? <View style={styles.iconSlot}>{rightIcon}</View> : null}
      </View>

      {helperText ? (
        <Text
          variant="caption"
          tone={error ? 'danger' : 'muted'}
          style={styles.helperText}
        >
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: theme.spacing.xs,
  },
  field: {
    minHeight: 52,
    borderRadius: theme.radii.sm,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  fieldFocused: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.backgroundTint,
  },
  fieldError: {
    borderColor: theme.colors.danger,
  },
  fieldDisabled: {
    opacity: 0.65,
  },
  fieldMultiline: {
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.sm,
  },
  iconSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.typography.size.md,
    lineHeight: theme.typography.lineHeight.md,
    paddingVertical: theme.spacing.sm,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    color: theme.colors.mutedText,
  },
  helperText: {
    marginTop: theme.spacing.xs,
  },
});
