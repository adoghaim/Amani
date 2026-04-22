import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Calendar as CalendarIcon,
  ChevronRight,
  Droplets,
  History,
  Plus,
  X,
} from 'lucide-react-native';
import {
  buildDayMap,
  type DailySymptom,
  type FlowIntensity,
  formatDate,
  formatMonthDay,
  phaseDescription,
  type PeriodLog,
  type SymptomLog,
  computeCyclePrediction,
  dateToKey,
} from '@amani/shared';
import {
  Button,
  Card,
  DateField,
  Input,
  Notice,
  Text,
  TrackerCalendar,
} from '../components';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';

const FLOW_OPTIONS: Array<{ value: FlowIntensity; label: string }> = [
  { value: 'spotting', label: 'Spotting' },
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'heavy', label: 'Heavy' },
];

const SYMPTOM_OPTIONS: Array<{ value: DailySymptom; label: string }> = [
  { value: 'cramps', label: 'Cramps' },
  { value: 'headache', label: 'Headache' },
  { value: 'bloating', label: 'Bloating' },
  { value: 'fatigue', label: 'Fatigue' },
  { value: 'acne', label: 'Acne' },
  { value: 'mood_changes', label: 'Mood changes' },
  { value: 'breast_tenderness', label: 'Breast tenderness' },
  { value: 'sleep_issues', label: 'Sleep issues' },
  { value: 'low_energy', label: 'Low energy' },
];

type TrackerTimelineItem =
  | {
      id: string;
      kind: 'period';
      date: string;
      title: string;
      subtitle: string;
      badge: string;
      accentColor: string;
      surfaceColor: string;
      onPress: () => void;
    }
  | {
      id: string;
      kind: 'symptom';
      date: string;
      title: string;
      subtitle: string;
      badge: string;
      accentColor: string;
      surfaceColor: string;
      onPress: () => void;
    };

function todayKey() {
  return dateToKey(new Date());
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateValue(value: string) {
  if (!isIsoDate(value)) {
    return new Date();
  }

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatPeriodWindow(log: PeriodLog) {
  const start = formatDate(log.start_date, { month: 'short', day: 'numeric' });
  if (!log.end_date) {
    return `${start} to today`;
  }

  const end = formatDate(log.end_date, { month: 'short', day: 'numeric' });
  return `${start} - ${end}`;
}

function formatSymptomSummary(log: SymptomLog) {
  if (log.symptoms.length === 0) {
    return log.notes?.trim() ? 'Notes only' : 'No symptoms selected';
  }

  if (log.symptoms.length === 1) {
    return (
      SYMPTOM_OPTIONS.find((option) => option.value === log.symptoms[0])?.label ??
      '1 symptom'
    );
  }

  return `${log.symptoms.length} symptoms tracked`;
}

export function TrackerScreen() {
  const { user, userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [periodLogs, setPeriodLogs] = useState<PeriodLog[]>([]);
  const [symptomLogs, setSymptomLogs] = useState<SymptomLog[]>([]);
  const [labReportDates, setLabReportDates] = useState<string[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [editingPeriodLog, setEditingPeriodLog] = useState<PeriodLog | null>(null);
  const [periodStartDate, setPeriodStartDate] = useState(todayKey());
  const [periodEndDate, setPeriodEndDate] = useState('');
  const [periodFlow, setPeriodFlow] = useState<FlowIntensity | null>(null);
  const [periodNotes, setPeriodNotes] = useState('');

  const [symptomModalOpen, setSymptomModalOpen] = useState(false);
  const [editingSymptomLog, setEditingSymptomLog] = useState<SymptomLog | null>(null);
  const [symptomDate, setSymptomDate] = useState(todayKey());
  const [selectedSymptoms, setSelectedSymptoms] = useState<DailySymptom[]>([]);
  const [symptomNotes, setSymptomNotes] = useState('');

  useEffect(() => {
    if (user) {
      void fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    if (!user) {
      return;
    }

    try {
      setLoading(true);

      const [periodRes, symptomRes, reportsRes] = await Promise.all([
        supabase
          .from('period_logs')
          .select('*')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false }),
        supabase
          .from('symptom_logs')
          .select('*')
          .eq('user_id', user.id)
          .order('log_date', { ascending: false }),
        supabase
          .from('lab_reports')
          .select('report_date')
          .eq('user_id', user.id)
          .order('report_date', { ascending: false }),
      ]);

      if (periodRes.error) {
        throw periodRes.error;
      }

      if (symptomRes.error) {
        throw symptomRes.error;
      }

      if (reportsRes.error) {
        throw reportsRes.error;
      }

      setPeriodLogs((periodRes.data ?? []) as PeriodLog[]);
      setSymptomLogs(
        ((symptomRes.data ?? []) as Array<SymptomLog & { symptoms?: DailySymptom[] }>).map(
          (log) => ({
            ...log,
            symptoms: Array.isArray(log.symptoms) ? log.symptoms : [],
          })
        )
      );
      setLabReportDates(
        ((reportsRes.data ?? []) as Array<{ report_date: string }>).map((report) => report.report_date)
      );
    } catch (fetchError) {
      console.error('Error fetching tracker data:', fetchError);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : 'Unable to load your tracker history.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    setError('');
    setSuccess('');
    void fetchData();
  };

  const prediction = useMemo(
    () =>
      periodLogs.length > 0 ? computeCyclePrediction(periodLogs, userProfile) : null,
    [periodLogs, userProfile]
  );

  const activePeriodLog = useMemo(
    () => periodLogs.find((log) => !log.end_date) ?? null,
    [periodLogs]
  );

  const labDateSet = useMemo(() => new Set(labReportDates), [labReportDates]);
  const symptomDateSet = useMemo(
    () => new Set(symptomLogs.map((log) => log.log_date)),
    [symptomLogs]
  );
  const dayMap = useMemo(
    () =>
      buildDayMap(
        calendarMonth.getFullYear(),
        calendarMonth.getMonth(),
        periodLogs,
        prediction,
        labDateSet,
        symptomDateSet,
        new Set<string>()
      ),
    [calendarMonth, periodLogs, prediction, labDateSet, symptomDateSet]
  );

  const selectedPeriodLog = useMemo(
    () =>
      periodLogs.find(
        (log) =>
          log.start_date <= selectedDateKey &&
          (!log.end_date || log.end_date >= selectedDateKey)
      ) ?? null,
    [periodLogs, selectedDateKey]
  );

  const selectedSymptomLog = useMemo(
    () => symptomLogs.find((log) => log.log_date === selectedDateKey) ?? null,
    [symptomLogs, selectedDateKey]
  );

  const selectedDayInfo = dayMap.get(selectedDateKey) ?? {
    states: [],
    hasLab: false,
    hasSymptom: false,
    hasIntervention: false,
  };

  const selectedBadges = [
    selectedPeriodLog ? 'Period logged' : null,
    selectedDayInfo.states.includes('predicted_period') ? 'Predicted period' : null,
    selectedDayInfo.states.includes('ovulation') ? 'Estimated ovulation' : null,
    selectedDayInfo.states.includes('fertile_window') ? 'Fertile window' : null,
    selectedSymptomLog ? formatSymptomSummary(selectedSymptomLog) : null,
    selectedDayInfo.hasLab ? 'Lab report' : null,
  ].filter(Boolean) as string[];

  const selectedDayDescription = selectedSymptomLog
    ? selectedSymptomLog.notes?.trim() || 'Tap to review or update the symptoms you tracked.'
    : selectedPeriodLog
      ? `Current period window: ${formatPeriodWindow(selectedPeriodLog)}`
      : selectedDayInfo.states.includes('predicted_period')
        ? 'This day is part of your predicted next period.'
        : selectedDayInfo.states.includes('ovulation')
          ? 'This day is marked as estimated ovulation.'
          : selectedDayInfo.states.includes('fertile_window')
            ? 'This day sits inside your estimated fertile window.'
            : 'No period or symptom log recorded for this day yet.';

  const timelineItems = useMemo<TrackerTimelineItem[]>(
    () =>
      [
        ...periodLogs.map((log) => ({
          id: `period-${log.id}`,
          kind: 'period' as const,
          date: log.start_date,
          title: log.end_date ? 'Period logged' : 'Current period',
          subtitle: formatPeriodWindow(log),
          badge:
            FLOW_OPTIONS.find((option) => option.value === log.flow_intensity)?.label ??
            'Flow not set',
          accentColor: theme.colors.danger,
          surfaceColor: `${theme.colors.danger}10`,
          onPress: () => openPeriodEditor(log),
        })),
        ...symptomLogs.map((log) => ({
          id: `symptom-${log.id}`,
          kind: 'symptom' as const,
          date: log.log_date,
          title: 'Symptoms logged',
          subtitle: formatDate(log.log_date, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          badge: formatSymptomSummary(log),
          accentColor: theme.colors.warning,
          surfaceColor: `${theme.colors.warning}10`,
          onPress: () => openSymptomEditor(log),
        })),
      ].sort((left, right) => right.date.localeCompare(left.date)),
    [periodLogs, symptomLogs]
  );

  const visibleTimelineItems = historyExpanded
    ? timelineItems
    : timelineItems.slice(0, 6);

  const openPeriodEditor = (log?: PeriodLog | null, defaultDate?: string) => {
    setError('');
    setSuccess('');
    setEditingPeriodLog(log ?? null);
    setPeriodStartDate(log?.start_date ?? defaultDate ?? todayKey());
    setPeriodEndDate(log?.end_date ?? '');
    setPeriodFlow(log?.flow_intensity ?? null);
    setPeriodNotes(log?.notes ?? '');
    setPeriodModalOpen(true);
  };

  const closePeriodEditor = () => {
    setPeriodModalOpen(false);
    setEditingPeriodLog(null);
  };

  const openSymptomEditor = (log?: SymptomLog | null, defaultDate?: string) => {
    setError('');
    setSuccess('');
    setEditingSymptomLog(log ?? null);
    setSymptomDate(log?.log_date ?? defaultDate ?? todayKey());
    setSelectedSymptoms(log?.symptoms ?? []);
    setSymptomNotes(log?.notes ?? '');
    setSymptomModalOpen(true);
  };

  const closeSymptomEditor = () => {
    setSymptomModalOpen(false);
    setEditingSymptomLog(null);
  };

  const toggleSymptom = (symptom: DailySymptom) => {
    setSelectedSymptoms((current) =>
      current.includes(symptom)
        ? current.filter((entry) => entry !== symptom)
        : [...current, symptom]
    );
  };

  const handleSavePeriod = async () => {
    if (!user) {
      return;
    }

    if (!isIsoDate(periodStartDate)) {
      setError('Use YYYY-MM-DD for the period start date.');
      return;
    }

    if (periodEndDate && !isIsoDate(periodEndDate)) {
      setError('Use YYYY-MM-DD for the period end date.');
      return;
    }

    if (periodEndDate && periodEndDate < periodStartDate) {
      setError('The period end date cannot be before the start date.');
      return;
    }

    try {
      setSaving(true);
      setError('');

      const payload = {
        start_date: periodStartDate,
        end_date: periodEndDate || null,
        flow_intensity: periodFlow,
        notes: periodNotes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (editingPeriodLog) {
        const { error: updateError } = await supabase
          .from('period_logs')
          .update(payload)
          .eq('id', editingPeriodLog.id);

        if (updateError) {
          throw updateError;
        }
      } else {
        const { error: insertError } = await supabase.from('period_logs').insert({
          user_id: user.id,
          start_date: periodStartDate,
          end_date: periodEndDate || null,
          flow_intensity: periodFlow,
          notes: periodNotes.trim() || null,
        });

        if (insertError) {
          throw insertError;
        }
      }

      setSelectedDateKey(periodStartDate);
      setSuccess(editingPeriodLog ? 'Period entry updated.' : 'Period entry saved.');
      closePeriodEditor();
      await fetchData();
    } catch (saveError) {
      console.error('Error saving period log:', saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to save the period log.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSymptoms = async () => {
    if (!user) {
      return;
    }

    if (!isIsoDate(symptomDate)) {
      setError('Use YYYY-MM-DD for the symptom date.');
      return;
    }

    if (selectedSymptoms.length === 0 && !symptomNotes.trim()) {
      setError('Add at least one symptom or a note before saving.');
      return;
    }

    try {
      setSaving(true);
      setError('');

      const { error: upsertError } = await supabase.from('symptom_logs').upsert(
        {
          user_id: user.id,
          log_date: symptomDate,
          symptoms: selectedSymptoms,
          notes: symptomNotes.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,log_date' }
      );

      if (upsertError) {
        throw upsertError;
      }

      setSelectedDateKey(symptomDate);
      setSuccess(editingSymptomLog ? 'Symptom entry updated.' : 'Symptoms saved.');
      closeSymptomEditor();
      await fetchData();
    } catch (saveError) {
      console.error('Error saving symptom log:', saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to save the symptom log.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text variant="title">Cycle Tracker</Text>
        <Text variant="bodySm" tone="muted">
          Log your cycle and symptoms to keep predictions current.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
          />
        }
      >
        {error ? (
          <Notice tone="error" style={styles.notice}>
            {error}
          </Notice>
        ) : null}

        {success ? (
          <Notice tone="success" style={styles.notice}>
            {success}
          </Notice>
        ) : null}

        {prediction ? (
          <Card style={styles.predictionCard}>
            <View style={styles.phaseBadge}>
              <Droplets size={14} color={theme.colors.danger} />
              <Text variant="caption" tone="danger" weight="bold">
                {prediction.currentPhase.toUpperCase()} PHASE
              </Text>
            </View>

            <Text variant="titleSm" style={styles.predictionTitle}>
              Day {prediction.currentCycleDay} of your cycle
            </Text>
            <Text variant="bodySm" tone="muted" style={styles.predictionDescription}>
              {phaseDescription(prediction.currentPhase)}
            </Text>

            <View style={styles.predictionStats}>
              <View style={styles.statBox}>
                <Text variant="caption" tone="muted" weight="bold">
                  NEXT PERIOD
                </Text>
                <Text variant="body" weight="bold">
                  {formatMonthDay(prediction.nextPeriodStart)}
                </Text>
              </View>
              <View style={styles.statBox}>
                <Text variant="caption" tone="muted" weight="bold">
                  FERTILE WINDOW
                </Text>
                <Text variant="body" weight="bold">
                  {formatMonthDay(prediction.fertileWindowStart)}
                </Text>
              </View>
            </View>

            {activePeriodLog ? (
              <View style={styles.currentPeriodSummary}>
                <Text variant="caption" tone="muted" weight="bold">
                  CURRENT ENTRY
                </Text>
                <Text variant="bodySm" style={styles.currentPeriodText}>
                  Started{' '}
                  {formatDate(activePeriodLog.start_date, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : (
          <Card style={styles.emptyCard}>
            <CalendarIcon size={48} color={theme.colors.surface2} />
            <Text variant="titleSm" style={styles.emptyTitle}>
              Start tracking
            </Text>
            <Text variant="bodySm" tone="muted" style={styles.emptyText}>
              Log your first period so Amani can start building cycle predictions.
            </Text>
            <Button label="Log period" onPress={() => openPeriodEditor()} fullWidth />
          </Card>
        )}

        <View style={styles.actionRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.actionButton}
            onPress={() => openPeriodEditor(activePeriodLog, selectedDateKey)}
          >
            <View
              style={[
                styles.actionIcon,
                { backgroundColor: `${theme.colors.danger}15` },
              ]}
            >
              <Droplets size={20} color={theme.colors.danger} />
            </View>
            <Text variant="bodySm" weight="semibold">
              {activePeriodLog ? 'Update Period' : 'Log Period'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.actionButton}
            onPress={() => openSymptomEditor(selectedSymptomLog, selectedDateKey)}
          >
            <View
              style={[
                styles.actionIcon,
                { backgroundColor: `${theme.colors.warning}15` },
              ]}
            >
              <Plus size={20} color={theme.colors.warning} />
            </View>
            <Text variant="bodySm" weight="semibold">
              {selectedSymptomLog ? 'Edit Symptoms' : 'Symptoms'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.actionButton}
            onPress={() => setHistoryExpanded((current) => !current)}
          >
            <View
              style={[
                styles.actionIcon,
                { backgroundColor: `${theme.colors.primary}15` },
              ]}
            >
              <History size={20} color={theme.colors.primary} />
            </View>
            <Text variant="bodySm" weight="semibold">
              {historyExpanded ? 'Collapse' : 'History'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <Text variant="titleSm">Calendar</Text>
          <Text variant="caption" tone="muted">
            Tap a day to review or add logs.
          </Text>
        </View>

        <TrackerCalendar
          dayMap={dayMap}
          currentMonth={calendarMonth}
          onMonthChange={setCalendarMonth}
          onDayPress={setSelectedDateKey}
          selectedDateKey={selectedDateKey}
        />

        <Card style={styles.selectedDateCard}>
          <Text variant="caption" tone="muted" weight="bold">
            SELECTED DAY
          </Text>
          <Text variant="titleSm" style={styles.selectedDateTitle}>
            {formatDate(selectedDateKey, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.selectedDateCopy}>
            {selectedDayDescription}
          </Text>

          {selectedBadges.length > 0 ? (
            <View style={styles.badgeRow}>
              {selectedBadges.map((badge) => (
                <View key={badge} style={styles.badge}>
                  <Text variant="caption" tone="muted" weight="semibold">
                    {badge}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.selectedActions}>
            <Button
              label={selectedPeriodLog ? 'Edit period' : 'Log period'}
              variant={selectedPeriodLog ? 'outline' : 'primary'}
              onPress={() => openPeriodEditor(selectedPeriodLog, selectedDateKey)}
              style={styles.flexButton}
            />
            <Button
              label={selectedSymptomLog ? 'Edit symptoms' : 'Log symptoms'}
              variant="secondary"
              onPress={() => openSymptomEditor(selectedSymptomLog, selectedDateKey)}
              style={styles.flexButton}
            />
          </View>
        </Card>

        <View style={styles.sectionHeader}>
          <Text variant="titleSm">
            {historyExpanded ? 'Full history' : 'Recent logs'}
          </Text>
          {timelineItems.length > 6 ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setHistoryExpanded((current) => !current)}
            >
              <Text variant="bodySm" tone="primary" weight="semibold">
                {historyExpanded ? 'Show less' : 'View all'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {timelineItems.length === 0 ? (
          <Card style={styles.emptyHistoryCard}>
            <Text variant="bodySm" tone="muted" style={styles.emptyHistoryText}>
              No period or symptom logs recorded yet.
            </Text>
          </Card>
        ) : (
          <View style={styles.logsList}>
            {visibleTimelineItems.map((item) => (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.85}
                onPress={item.onPress}
                style={styles.logItem}
              >
                <View style={[styles.logIcon, { backgroundColor: item.surfaceColor }]}>
                  {item.kind === 'period' ? (
                    <Droplets size={16} color={item.accentColor} />
                  ) : (
                    <Plus size={16} color={item.accentColor} />
                  )}
                </View>

                <View style={styles.logContent}>
                  <Text variant="bodySm" weight="bold">
                    {item.title}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {item.subtitle}
                  </Text>
                  <View style={styles.logBadge}>
                    <Text variant="caption" tone="muted" weight="semibold">
                      {item.badge}
                    </Text>
                  </View>
                </View>

                <ChevronRight size={16} color={theme.colors.mutedText3} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        transparent
        visible={periodModalOpen}
        onRequestClose={closePeriodEditor}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalBackdrop} />
          <Card style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text variant="titleSm">
                  {editingPeriodLog ? 'Edit period entry' : 'Log a period'}
                </Text>
                <Text variant="bodySm" tone="muted">
                  Use ISO dates so the cycle prediction stays stable.
                </Text>
              </View>
              <Pressable onPress={closePeriodEditor} style={styles.modalCloseButton}>
                <X size={18} color={theme.colors.mutedText3} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <DateField
                label="Start date"
                value={periodStartDate}
                onChange={setPeriodStartDate}
                maximumDate={periodEndDate ? parseDateValue(periodEndDate) : new Date()}
              />

              <DateField
                label="End date"
                value={periodEndDate}
                onChange={setPeriodEndDate}
                hint="Leave blank if the period is still ongoing."
                allowClear
                minimumDate={parseDateValue(periodStartDate)}
                maximumDate={new Date()}
              />

              <View style={styles.formSection}>
                <Text variant="label">Flow intensity</Text>
                <View style={styles.chipGrid}>
                  {FLOW_OPTIONS.map((option) => {
                    const selected = option.value === periodFlow;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => setPeriodFlow(selected ? null : option.value)}
                        style={[styles.chip, selected ? styles.chipSelected : null]}
                      >
                        <Text
                          variant="bodySm"
                          tone={selected ? 'inverse' : 'default'}
                          weight="semibold"
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Input
                label="Notes"
                value={periodNotes}
                onChangeText={setPeriodNotes}
                multiline
                placeholder="Anything useful to remember about this cycle..."
              />

              <View style={styles.modalActions}>
                <Button
                  label="Cancel"
                  onPress={closePeriodEditor}
                  variant="ghost"
                  style={styles.flexButton}
                />
                <Button
                  label={editingPeriodLog ? 'Save changes' : 'Save period'}
                  onPress={() => {
                    void handleSavePeriod();
                  }}
                  loading={saving}
                  style={styles.flexButton}
                />
              </View>
            </ScrollView>
          </Card>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        transparent
        visible={symptomModalOpen}
        onRequestClose={closeSymptomEditor}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalBackdrop} />
          <Card style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text variant="titleSm">
                  {editingSymptomLog ? 'Edit symptom entry' : 'Log symptoms'}
                </Text>
                <Text variant="bodySm" tone="muted">
                  Track how you felt today to connect symptoms with cycle phase.
                </Text>
              </View>
              <Pressable onPress={closeSymptomEditor} style={styles.modalCloseButton}>
                <X size={18} color={theme.colors.mutedText3} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <DateField
                label="Date"
                value={symptomDate}
                onChange={setSymptomDate}
                maximumDate={new Date()}
              />

              <View style={styles.formSection}>
                <Text variant="label">Symptoms</Text>
                <View style={styles.chipGrid}>
                  {SYMPTOM_OPTIONS.map((option) => {
                    const selected = selectedSymptoms.includes(option.value);
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => toggleSymptom(option.value)}
                        style={[styles.chip, selected ? styles.chipSelected : null]}
                      >
                        <Text
                          variant="bodySm"
                          tone={selected ? 'inverse' : 'default'}
                          weight="semibold"
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Input
                label="Notes"
                value={symptomNotes}
                onChangeText={setSymptomNotes}
                multiline
                placeholder="Energy, mood, pain levels, or anything else worth noting..."
              />

              <View style={styles.modalActions}>
                <Button
                  label="Cancel"
                  onPress={closeSymptomEditor}
                  variant="ghost"
                  style={styles.flexButton}
                />
                <Button
                  label={editingSymptomLog ? 'Save changes' : 'Save symptoms'}
                  onPress={() => {
                    void handleSaveSymptoms();
                  }}
                  loading={saving}
                  style={styles.flexButton}
                />
              </View>
            </ScrollView>
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
  },
  notice: {
    marginBottom: theme.spacing.md,
  },
  predictionCard: {
    marginBottom: theme.spacing.xl,
  },
  phaseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: theme.spacing.xxs,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.radii.pill,
    marginBottom: theme.spacing.sm,
  },
  predictionTitle: {
    marginBottom: theme.spacing.xxs,
  },
  predictionDescription: {
    marginBottom: theme.spacing.lg,
  },
  predictionStats: {
    flexDirection: 'row',
    borderTopWidth: theme.borders.thin,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  statBox: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  currentPeriodSummary: {
    marginTop: theme.spacing.md,
    borderTopWidth: theme.borders.thin,
    borderTopColor: theme.colors.borderSubtle,
    paddingTop: theme.spacing.md,
  },
  currentPeriodText: {
    marginTop: theme.spacing.xxs,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xxxl,
    marginBottom: theme.spacing.xl,
  },
  emptyTitle: {
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  emptyText: {
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xl,
  },
  actionButton: {
    width: '31%',
    alignItems: 'center',
  },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  selectedDateCard: {
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  selectedDateTitle: {
    marginTop: theme.spacing.xs,
  },
  selectedDateCopy: {
    marginTop: theme.spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  badge: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xxs,
  },
  selectedActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  emptyHistoryCard: {
    alignItems: 'center',
  },
  emptyHistoryText: {
    textAlign: 'center',
  },
  logsList: {
    gap: theme.spacing.sm,
  },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  logIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.sm,
  },
  logContent: {
    flex: 1,
  },
  logBadge: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.xxs,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(42, 31, 35, 0.2)',
  },
  modalCard: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '88%',
    paddingBottom: theme.spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  modalHeaderCopy: {
    flex: 1,
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
  },
  modalContent: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  formSection: {
    gap: theme.spacing.sm,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    borderRadius: theme.radii.pill,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  flexButton: {
    flex: 1,
  },
});
