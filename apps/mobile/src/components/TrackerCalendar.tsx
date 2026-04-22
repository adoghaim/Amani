import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  ChevronLeft,
  ChevronRight,
  Pill,
  TestTube2,
  Zap,
} from 'lucide-react-native';
import { type DayInfo, type DayState, dateToKey } from '@amani/shared';
import { theme } from '../theme';
import { Text } from './Text';

interface TrackerCalendarProps {
  dayMap: Map<string, DayInfo>;
  currentMonth: Date;
  onMonthChange: (month: Date) => void;
  onDayPress: (dateKey: string) => void;
  selectedDateKey?: string | null;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getPrimaryState(states: DayState[]): DayState | null {
  if (states.includes('confirmed_period')) return 'confirmed_period';
  if (states.includes('ovulation')) return 'ovulation';
  if (states.includes('predicted_period')) return 'predicted_period';
  if (states.includes('fertile_window')) return 'fertile_window';
  if (states.includes('today')) return 'today';
  return null;
}

function LegendItem({
  color,
  borderColor,
  dashed,
  label,
}: {
  color: string;
  borderColor?: string;
  dashed?: boolean;
  label: string;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendSwatch,
          {
            backgroundColor: color,
            borderColor: borderColor ?? 'transparent',
            borderStyle: dashed ? 'dashed' : 'solid',
          },
        ]}
      />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

export function TrackerCalendar({
  dayMap,
  currentMonth,
  onMonthChange,
  onDayPress,
  selectedDateKey,
}: TrackerCalendarProps) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthLabel = currentMonth.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const todayKey = dateToKey(new Date());

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i += 1) {
    cells.push(<View key={`empty-${i}`} style={styles.emptyCell} />);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = dateToKey(new Date(year, month, day));
    const info = dayMap.get(dateKey) ?? {
      states: [],
      hasLab: false,
      hasSymptom: false,
      hasIntervention: false,
    };
    const primaryState = getPrimaryState(info.states);
    const isToday = dateKey === todayKey;
    const isSelected = selectedDateKey === dateKey;

    cells.push(
      <View key={dateKey} style={styles.dayCell}>
        <Pressable
          onPress={() => onDayPress(dateKey)}
          style={[
            styles.dayButton,
            primaryState === 'confirmed_period' ? styles.dayConfirmedPeriod : null,
            primaryState === 'predicted_period' ? styles.dayPredictedPeriod : null,
            primaryState === 'ovulation' ? styles.dayOvulation : null,
            primaryState === 'fertile_window' ? styles.dayFertile : null,
            primaryState === 'today' && !isSelected ? styles.dayToday : null,
            isSelected ? styles.daySelected : null,
          ]}
        >
          <Text
            variant="bodySm"
            weight={
              primaryState === 'confirmed_period' || isToday || isSelected
                ? 'bold'
                : 'medium'
            }
            tone={primaryState === 'confirmed_period' ? 'inverse' : 'default'}
            style={[
              styles.dayNumber,
              primaryState === 'predicted_period' ? styles.dayNumberPredicted : null,
              primaryState === 'ovulation' ? styles.dayNumberOvulation : null,
              primaryState === 'fertile_window' ? styles.dayNumberFertile : null,
              primaryState === 'today' || isSelected ? styles.dayNumberToday : null,
            ]}
          >
            {day}
          </Text>

          <View style={styles.dayIndicators}>
            {info.hasLab ? (
              <TestTube2 size={10} color={theme.colors.primary} />
            ) : null}
            {info.hasSymptom ? (
              <Zap size={10} color={theme.colors.warning} />
            ) : null}
            {info.hasIntervention ? (
              <Pill size={10} color={theme.colors.success} />
            ) : null}
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable
          onPress={() => onMonthChange(new Date(year, month - 1, 1))}
          style={styles.navButton}
        >
          <ChevronLeft size={18} color={theme.colors.mutedText} />
        </Pressable>

        <Text variant="body" weight="bold">
          {monthLabel}
        </Text>

        <Pressable
          onPress={() => onMonthChange(new Date(year, month + 1, 1))}
          style={styles.navButton}
        >
          <ChevronRight size={18} color={theme.colors.mutedText} />
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((day) => (
          <View key={day} style={styles.weekdayCell}>
            <Text variant="caption" tone="muted" weight="semibold">
              {day}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>{cells}</View>

      <View style={styles.legend}>
        <LegendItem color={theme.colors.danger} label="Period" />
        <LegendItem
          color={`${theme.colors.danger}12`}
          borderColor={`${theme.colors.danger}55`}
          dashed
          label="Predicted"
        />
        <LegendItem
          color={`${theme.colors.warning}18`}
          borderColor={`${theme.colors.warning}66`}
          label="Ovulation"
        />
        <LegendItem
          color={`${theme.colors.success}12`}
          borderColor={`${theme.colors.success}55`}
          label="Fertile"
        />
        <View style={styles.legendIcon}>
          <TestTube2 size={12} color={theme.colors.primary} />
          <Text variant="caption" tone="muted">
            Labs
          </Text>
        </View>
        <View style={styles.legendIcon}>
          <Zap size={12} color={theme.colors.warning} />
          <Text variant="caption" tone="muted">
            Symptoms
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: theme.borders.thin,
    borderBottomColor: theme.colors.border,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayRow: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
  },
  weekdayCell: {
    width: '14.2857%',
    alignItems: 'center',
    paddingBottom: theme.spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
  },
  emptyCell: {
    width: '14.2857%',
    height: 66,
  },
  dayCell: {
    width: '14.2857%',
    padding: 2,
  },
  dayButton: {
    minHeight: 62,
    borderRadius: theme.radii.sm,
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.xxs,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayConfirmedPeriod: {
    backgroundColor: theme.colors.danger,
  },
  dayPredictedPeriod: {
    backgroundColor: `${theme.colors.danger}12`,
    borderWidth: theme.borders.thin,
    borderColor: `${theme.colors.danger}55`,
    borderStyle: 'dashed',
  },
  dayOvulation: {
    backgroundColor: `${theme.colors.warning}18`,
    borderWidth: theme.borders.thin,
    borderColor: `${theme.colors.warning}66`,
  },
  dayFertile: {
    backgroundColor: `${theme.colors.success}12`,
    borderWidth: theme.borders.thin,
    borderColor: `${theme.colors.success}55`,
  },
  dayToday: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface2,
  },
  daySelected: {
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
  dayNumber: {
    color: theme.colors.textBody,
  },
  dayNumberPredicted: {
    color: theme.colors.danger,
  },
  dayNumberOvulation: {
    color: '#8A5A12',
  },
  dayNumberFertile: {
    color: theme.colors.success,
  },
  dayNumberToday: {
    color: theme.colors.primaryDark,
  },
  dayIndicators: {
    minHeight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    flexWrap: 'wrap',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: theme.borders.thin,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundTint,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 4,
    borderWidth: theme.borders.thin,
  },
  legendIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
