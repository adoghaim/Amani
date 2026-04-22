import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { CalendarDays } from 'lucide-react-native';
import { dateToKey, formatDate } from '@amani/shared';
import { theme } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

interface DateFieldProps {
  label?: string;
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
  allowClear?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

function parseDateValue(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date();
  }

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function DateField({
  label,
  value,
  onChange,
  placeholder = 'Select a date',
  hint,
  error,
  disabled = false,
  minimumDate,
  maximumDate,
  allowClear = false,
  containerStyle,
}: DateFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [iosDraftDate, setIosDraftDate] = useState<Date | null>(null);
  const helperText = error ?? hint;

  const parsedValue = useMemo(() => parseDateValue(value), [value]);
  const displayValue = value
    ? formatDate(value, { month: 'short', day: 'numeric', year: 'numeric' })
    : placeholder;

  const openPicker = () => {
    if (disabled) {
      return;
    }

    setIosDraftDate(parsedValue);
    setShowPicker(true);
  };

  const closePicker = () => {
    setShowPicker(false);
    setIosDraftDate(null);
  };

  const handleAndroidChange = (event: DateTimePickerEvent, nextDate?: Date) => {
    setShowPicker(false);

    if (event.type === 'set' && nextDate) {
      onChange(dateToKey(nextDate));
    }
  };

  const handleIosChange = (_event: DateTimePickerEvent, nextDate?: Date) => {
    if (nextDate) {
      setIosDraftDate(nextDate);
    }
  };

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="label" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={openPicker}
        style={[
          styles.field,
          disabled ? styles.fieldDisabled : null,
          error ? styles.fieldError : null,
        ]}
      >
        <View style={styles.fieldCopy}>
          <Text
            variant="body"
            tone={value ? 'default' : 'muted'}
            style={styles.fieldValue}
          >
            {displayValue}
          </Text>
        </View>

        <CalendarDays size={18} color={theme.colors.mutedText3} />
      </Pressable>

      {showPicker ? (
        Platform.OS === 'ios' ? (
          <View style={styles.iosPickerShell}>
            <DateTimePicker
              value={iosDraftDate ?? parsedValue}
              mode="date"
              display="spinner"
              onChange={handleIosChange}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
            />

            <View style={styles.iosActions}>
              <Button
                label="Cancel"
                onPress={closePicker}
                variant="ghost"
                style={styles.flexButton}
              />
              <Button
                label="Done"
                onPress={() => {
                  onChange(dateToKey(iosDraftDate ?? parsedValue));
                  closePicker();
                }}
                style={styles.flexButton}
              />
            </View>
          </View>
        ) : (
          <DateTimePicker
            value={parsedValue}
            mode="date"
            display="default"
            onChange={handleAndroidChange}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
          />
        )
      ) : null}

      {helperText || (allowClear && value) ? (
        <View style={styles.footerRow}>
          {helperText ? (
            <Text variant="caption" tone={error ? 'danger' : 'muted'}>
              {helperText}
            </Text>
          ) : (
            <View />
          )}

          {allowClear && value ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onChange('')}
              style={styles.clearButton}
            >
              <Text variant="caption" tone="primary" weight="semibold">
                Clear
              </Text>
            </Pressable>
          ) : null}
        </View>
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
    justifyContent: 'space-between',
    gap: theme.spacing.xs,
  },
  fieldDisabled: {
    opacity: 0.65,
  },
  fieldError: {
    borderColor: theme.colors.danger,
  },
  fieldCopy: {
    flex: 1,
  },
  fieldValue: {
    color: theme.colors.text,
  },
  iosPickerShell: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    overflow: 'hidden',
  },
  iosActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderTopWidth: theme.borders.thin,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  flexButton: {
    flex: 1,
  },
  footerRow: {
    marginTop: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  clearButton: {
    paddingVertical: theme.spacing.xxs,
  },
});
