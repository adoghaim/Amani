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
import { useNavigation } from '@react-navigation/native';
import {
  ArrowDown,
  ArrowUp,
  Calendar as CalendarIcon,
  ChevronRight,
  Droplets,
  History,
  Minus,
  Plus,
  X,
} from 'lucide-react-native';
import {
  Biomarker,
  buildDayMap,
  type DailySymptom,
  type FlowIntensity,
  formatDate,
  formatMonthDay,
  type Intervention,
  type InterventionCategory,
  type LabReport,
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

interface PeriodDraft {
  startDate: string;
  endDate: string;
  flowIntensity: FlowIntensity | null;
  notes: string;
}

interface SymptomDraft {
  date: string;
  symptoms: DailySymptom[];
  notes: string;
}

type RetryRequest =
  | {
      kind: 'period';
      draft: PeriodDraft;
      existingLog: PeriodLog | null;
    }
  | {
      kind: 'symptom';
      draft: SymptomDraft;
      existingLog: SymptomLog | null;
    };

const INTERVENTION_CATEGORIES: Array<{
  value: InterventionCategory;
  label: string;
}> = [
  { value: 'supplement', label: 'Supplement' },
  { value: 'diet', label: 'Diet' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'medication', label: 'Medication' },
  { value: 'sleep', label: 'Sleep' },
  { value: 'other', label: 'Other' },
];

const KEY_BIOMARKERS = ['ferritin', 'vitamin d', 'vitamin_d', 'tsh', 'hba1c', 'ldl', 'ldl-c'];

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

function formatInterventionWindow(intervention: Intervention) {
  const start = formatDate(intervention.start_date, {
    month: 'short',
    day: 'numeric',
  });

  if (!intervention.end_date) {
    return `${start} • Ongoing`;
  }

  const end = formatDate(intervention.end_date, { month: 'short', day: 'numeric' });
  return `${start} - ${end}`;
}

function getInterventionCategoryColor(category: InterventionCategory) {
  const colors: Record<InterventionCategory, string> = {
    supplement: '#F2E8FF',
    diet: '#E8F7EE',
    exercise: '#E8F1FF',
    medication: '#FFECEF',
    sleep: '#ECEBFF',
    other: theme.colors.surface2,
  };
  return colors[category];
}

function createOptimisticId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortPeriodLogsDescending(logs: PeriodLog[]) {
  return [...logs].sort((left, right) => right.start_date.localeCompare(left.start_date));
}

function sortSymptomLogsDescending(logs: SymptomLog[]) {
  return [...logs].sort((left, right) => right.log_date.localeCompare(left.log_date));
}

export function TrackerScreen() {
  const { user, userProfile } = useAuth();
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [periodLogs, setPeriodLogs] = useState<PeriodLog[]>([]);
  const [symptomLogs, setSymptomLogs] = useState<SymptomLog[]>([]);
  const [reports, setReports] = useState<LabReport[]>([]);
  const [biomarkersByReport, setBiomarkersByReport] = useState<Record<string, Biomarker[]>>({});
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [labReportDates, setLabReportDates] = useState<string[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);

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

  const [interventionModalOpen, setInterventionModalOpen] = useState(false);
  const [editingIntervention, setEditingIntervention] = useState<Intervention | null>(null);
  const [interventionTitle, setInterventionTitle] = useState('');
  const [interventionCategory, setInterventionCategory] =
    useState<InterventionCategory>('supplement');
  const [interventionStartDate, setInterventionStartDate] = useState(todayKey());
  const [interventionEndDate, setInterventionEndDate] = useState('');
  const [interventionNotes, setInterventionNotes] = useState('');

  const sortedReports = useMemo(
    () =>
      [...reports].sort(
        (left, right) =>
          new Date(left.report_date).getTime() - new Date(right.report_date).getTime()
      ),
    [reports]
  );
  const [baselineReportId, setBaselineReportId] = useState('');
  const [followupReportId, setFollowupReportId] = useState('');

  useEffect(() => {
    if (user) {
      void fetchData();
    }
  }, [user]);

  useEffect(() => {
    if (sortedReports.length >= 2 && (!baselineReportId || !followupReportId)) {
      setBaselineReportId(sortedReports[sortedReports.length - 2].id);
      setFollowupReportId(sortedReports[sortedReports.length - 1].id);
    }
  }, [sortedReports, baselineReportId, followupReportId]);

  const fetchData = async () => {
    if (!user) {
      return;
    }

    try {
      setLoading(true);

      const [periodRes, symptomRes, reportsRes, interventionsRes] = await Promise.all([
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
          .select('*')
          .eq('user_id', user.id)
          .order('report_date', { ascending: false }),
        supabase
          .from('interventions')
          .select('*')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false }),
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
      if (interventionsRes.error) {
        throw interventionsRes.error;
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
      const fetchedReports = (reportsRes.data ?? []) as LabReport[];
      setReports(fetchedReports);
      setLabReportDates(fetchedReports.map((report) => report.report_date));
      setInterventions((interventionsRes.data ?? []) as Intervention[]);

      if (fetchedReports.length > 0) {
        const reportIds = fetchedReports.map((report) => report.id);
        const { data: biomarkerRows, error: biomarkersError } = await supabase
          .from('biomarkers')
          .select('*')
          .in('lab_report_id', reportIds);

        if (biomarkersError) {
          throw biomarkersError;
        }

        const grouped = ((biomarkerRows ?? []) as Biomarker[]).reduce(
          (accumulator, biomarker) => {
            if (!accumulator[biomarker.lab_report_id]) {
              accumulator[biomarker.lab_report_id] = [];
            }
            accumulator[biomarker.lab_report_id].push(biomarker);
            return accumulator;
          },
          {} as Record<string, Biomarker[]>
        );

        setBiomarkersByReport(grouped);
      } else {
        setBiomarkersByReport({});
      }
    } catch (fetchError) {
      console.error('Error fetching tracker data:', fetchError);
      showError(
        fetchError instanceof Error
          ? fetchError.message
          : 'Unable to load your tracker history.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const clearNotices = () => {
    setError('');
    setSuccess('');
    setRetryRequest(null);
  };

  const showError = (message: string, nextRetryRequest: RetryRequest | null = null) => {
    setSuccess('');
    setError(message);
    setRetryRequest(nextRetryRequest);
  };

  const showSuccess = (message: string) => {
    setError('');
    setSuccess(message);
    setRetryRequest(null);
  };

  const onRefresh = () => {
    setRefreshing(true);
    clearNotices();
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
  const interventionActiveDateSet = useMemo(() => {
    const set = new Set<string>();
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = dateToKey(new Date(year, month, day));
      const hasActiveIntervention = interventions.some(
        (intervention) =>
          intervention.start_date <= dateKey &&
          (!intervention.end_date || intervention.end_date >= dateKey)
      );
      if (hasActiveIntervention) {
        set.add(dateKey);
      }
    }

    return set;
  }, [interventions, calendarMonth]);
  const dayMap = useMemo(
    () =>
      buildDayMap(
        calendarMonth.getFullYear(),
        calendarMonth.getMonth(),
        periodLogs,
        prediction,
        labDateSet,
        symptomDateSet,
        interventionActiveDateSet
      ),
    [calendarMonth, periodLogs, prediction, labDateSet, symptomDateSet, interventionActiveDateSet]
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
    selectedDayInfo.hasIntervention ? 'Intervention active' : null,
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
    clearNotices();
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
    clearNotices();
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

  const submitPeriodDraft = async (
    draft: PeriodDraft,
    existingLog: PeriodLog | null
  ) => {
    if (!user) {
      return;
    }

    const previousPeriodLogs = periodLogs;
    const previousSelectedDateKey = selectedDateKey;
    const now = new Date().toISOString();
    const notes = draft.notes.trim() || null;
    const optimisticLog: PeriodLog = existingLog
      ? {
          ...existingLog,
          start_date: draft.startDate,
          end_date: draft.endDate || null,
          flow_intensity: draft.flowIntensity,
          notes,
          updated_at: now,
        }
      : {
          id: createOptimisticId('period'),
          user_id: user.id,
          start_date: draft.startDate,
          end_date: draft.endDate || null,
          flow_intensity: draft.flowIntensity,
          notes,
          created_at: now,
          updated_at: now,
        };

    try {
      setSaving(true);
      clearNotices();
      setPeriodLogs(
        sortPeriodLogsDescending([
          ...previousPeriodLogs.filter((log) => log.id !== existingLog?.id),
          optimisticLog,
        ])
      );
      setSelectedDateKey(draft.startDate);
      closePeriodEditor();

      const payload = {
        start_date: draft.startDate,
        end_date: draft.endDate || null,
        flow_intensity: draft.flowIntensity,
        notes,
        updated_at: now,
      };

      if (existingLog) {
        const { error: updateError } = await supabase
          .from('period_logs')
          .update(payload)
          .eq('id', existingLog.id);

        if (updateError) {
          throw updateError;
        }
      } else {
        const { error: insertError } = await supabase.from('period_logs').insert({
          user_id: user.id,
          start_date: draft.startDate,
          end_date: draft.endDate || null,
          flow_intensity: draft.flowIntensity,
          notes,
        });

        if (insertError) {
          throw insertError;
        }
      }

      showSuccess(existingLog ? 'Period entry updated.' : 'Period entry saved.');
      await fetchData();
    } catch (saveError) {
      console.error('Error saving period log:', saveError);
      setPeriodLogs(previousPeriodLogs);
      setSelectedDateKey(previousSelectedDateKey);
      showError('Unable to save the period log.', {
        kind: 'period',
        draft,
        existingLog,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePeriod = async () => {
    if (!user) {
      return;
    }

    if (!isIsoDate(periodStartDate)) {
      showError('Choose a valid period start date.');
      return;
    }

    if (periodEndDate && !isIsoDate(periodEndDate)) {
      showError('Choose a valid period end date.');
      return;
    }

    if (periodEndDate && periodEndDate < periodStartDate) {
      showError('The period end date cannot be before the start date.');
      return;
    }

    await submitPeriodDraft(
      {
        startDate: periodStartDate,
        endDate: periodEndDate,
        flowIntensity: periodFlow,
        notes: periodNotes,
      },
      editingPeriodLog
    );
  };

  const submitSymptomDraft = async (
    draft: SymptomDraft,
    existingLog: SymptomLog | null
  ) => {
    if (!user) {
      return;
    }

    const conflictingLog = symptomLogs.find(
      (log) => log.id !== existingLog?.id && log.log_date === draft.date
    );

    if (conflictingLog) {
      showError('A symptom entry already exists for that date. Edit that entry instead.');
      return;
    }

    const previousSymptomLogs = symptomLogs;
    const previousSelectedDateKey = selectedDateKey;
    const now = new Date().toISOString();
    const notes = draft.notes.trim() || null;
    const optimisticLog: SymptomLog = existingLog
      ? {
          ...existingLog,
          log_date: draft.date,
          symptoms: draft.symptoms,
          notes,
          updated_at: now,
        }
      : {
          id: createOptimisticId('symptom'),
          user_id: user.id,
          log_date: draft.date,
          symptoms: draft.symptoms,
          notes,
          created_at: now,
          updated_at: now,
        };

    try {
      setSaving(true);
      clearNotices();
      setSymptomLogs(
        sortSymptomLogsDescending([
          ...previousSymptomLogs.filter((log) => log.id !== existingLog?.id),
          optimisticLog,
        ])
      );
      setSelectedDateKey(draft.date);
      closeSymptomEditor();

      if (existingLog) {
        const { error: updateError } = await supabase
          .from('symptom_logs')
          .update({
            log_date: draft.date,
            symptoms: draft.symptoms,
            notes,
            updated_at: now,
          })
          .eq('id', existingLog.id);

        if (updateError) {
          throw updateError;
        }
      } else {
        const { error: insertError } = await supabase.from('symptom_logs').insert({
          user_id: user.id,
          log_date: draft.date,
          symptoms: draft.symptoms,
          notes,
          updated_at: now,
        });

        if (insertError) {
          throw insertError;
        }
      }

      showSuccess(existingLog ? 'Symptom entry updated.' : 'Symptoms saved.');
      await fetchData();
    } catch (saveError) {
      console.error('Error saving symptom log:', saveError);
      setSymptomLogs(previousSymptomLogs);
      setSelectedDateKey(previousSelectedDateKey);
      showError('Unable to save the symptom log.', {
        kind: 'symptom',
        draft,
        existingLog,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSymptoms = async () => {
    if (!user) {
      return;
    }

    if (!isIsoDate(symptomDate)) {
      showError('Choose a valid symptom date.');
      return;
    }

    if (selectedSymptoms.length === 0 && !symptomNotes.trim()) {
      showError('Add at least one symptom or a note before saving.');
      return;
    }

    await submitSymptomDraft(
      {
        date: symptomDate,
        symptoms: selectedSymptoms,
        notes: symptomNotes,
      },
      editingSymptomLog
    );
  };

  const openInterventionEditor = (intervention?: Intervention | null) => {
    clearNotices();
    setEditingIntervention(intervention ?? null);
    setInterventionTitle(intervention?.title ?? '');
    setInterventionCategory(intervention?.category ?? 'supplement');
    setInterventionStartDate(intervention?.start_date ?? todayKey());
    setInterventionEndDate(intervention?.end_date ?? '');
    setInterventionNotes(intervention?.notes ?? '');
    setInterventionModalOpen(true);
  };

  const closeInterventionEditor = () => {
    setInterventionModalOpen(false);
    setEditingIntervention(null);
  };

  const handleSaveIntervention = async () => {
    if (!user) {
      return;
    }

    if (!interventionTitle.trim()) {
      showError('Add a title for the intervention.');
      return;
    }

    if (!isIsoDate(interventionStartDate)) {
      showError('Choose a valid intervention start date.');
      return;
    }

    if (interventionEndDate && !isIsoDate(interventionEndDate)) {
      showError('Choose a valid intervention end date.');
      return;
    }

    if (interventionEndDate && interventionEndDate < interventionStartDate) {
      showError('The intervention end date cannot be before the start date.');
      return;
    }

    try {
      setSaving(true);
      clearNotices();

      const payload = {
        title: interventionTitle.trim(),
        category: interventionCategory,
        start_date: interventionStartDate,
        end_date: interventionEndDate || null,
        notes: interventionNotes.trim() || null,
      };

      if (editingIntervention) {
        const { error: updateError } = await supabase
          .from('interventions')
          .update(payload)
          .eq('id', editingIntervention.id);
        if (updateError) {
          throw updateError;
        }
      } else {
        const { error: insertError } = await supabase.from('interventions').insert({
          user_id: user.id,
          ...payload,
        });
        if (insertError) {
          throw insertError;
        }
      }

      showSuccess(
        editingIntervention ? 'Intervention updated.' : 'Intervention added.'
      );
      closeInterventionEditor();
      await fetchData();
    } catch (saveError) {
      console.error('Error saving intervention:', saveError);
      showError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to save the intervention.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRetrySave = () => {
    if (!retryRequest || saving) {
      return;
    }

    switch (retryRequest.kind) {
      case 'period':
        void submitPeriodDraft(retryRequest.draft, retryRequest.existingLog);
        return;
      case 'symptom':
        void submitSymptomDraft(retryRequest.draft, retryRequest.existingLog);
        return;
      default:
        return;
    }
  };

  const compareRows = useMemo(() => {
    if (!baselineReportId || !followupReportId) {
      return [];
    }
    const baseline = biomarkersByReport[baselineReportId] ?? [];
    const followup = biomarkersByReport[followupReportId] ?? [];

    return baseline
      .map((baseBiomarker) => {
        const match = followup.find(
          (candidate) =>
            candidate.name.toLowerCase().trim() ===
              baseBiomarker.name.toLowerCase().trim() &&
            candidate.unit === baseBiomarker.unit
        );
        if (!match) {
          return null;
        }
        const delta = match.value - baseBiomarker.value;
        const percent = baseBiomarker.value
          ? (delta / baseBiomarker.value) * 100
          : 0;
        return {
          name: baseBiomarker.name,
          baseline: baseBiomarker.value,
          followup: match.value,
          unit: match.unit,
          delta,
          percent,
        };
      })
      .filter(Boolean) as Array<{
      name: string;
      baseline: number;
      followup: number;
      unit: string;
      delta: number;
      percent: number;
    }>;
  }, [baselineReportId, followupReportId, biomarkersByReport]);

  const sortedInterventions = useMemo(
    () =>
      [...interventions].sort((left, right) =>
        right.start_date.localeCompare(left.start_date)
      ),
    [interventions]
  );

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
          <Notice
            tone="error"
            style={styles.notice}
            actionLabel={retryRequest ? 'Retry' : undefined}
            onAction={retryRequest && !saving ? handleRetrySave : null}
          >
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
            onPress={() => openInterventionEditor()}
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
              Add Intervention
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
          <Text variant="titleSm">Interventions</Text>
          <TouchableOpacity activeOpacity={0.85} onPress={() => openInterventionEditor()}>
            <Text variant="bodySm" tone="primary" weight="semibold">
              Add
            </Text>
          </TouchableOpacity>
        </View>

        {sortedInterventions.length === 0 ? (
          <Card style={styles.emptyHistoryCard}>
            <Text variant="bodySm" tone="muted" style={styles.emptyHistoryText}>
              No interventions yet. Add supplements, medications, or lifestyle changes.
            </Text>
          </Card>
        ) : (
          <View style={styles.logsList}>
            {sortedInterventions.slice(0, 5).map((intervention) => (
              <TouchableOpacity
                key={intervention.id}
                activeOpacity={0.85}
                onPress={() => openInterventionEditor(intervention)}
                style={styles.logItem}
              >
                <View
                  style={[
                    styles.logIcon,
                    { backgroundColor: getInterventionCategoryColor(intervention.category) },
                  ]}
                >
                  <History size={16} color={theme.colors.primaryDark} />
                </View>
                <View style={styles.logContent}>
                  <Text variant="bodySm" weight="bold">
                    {intervention.title}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {formatInterventionWindow(intervention)}
                  </Text>
                  <View style={styles.logBadge}>
                    <Text variant="caption" tone="muted" weight="semibold">
                      {intervention.category}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={16} color={theme.colors.mutedText3} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text variant="titleSm">Compare reports</Text>
          <Text variant="caption" tone="muted">
            Side-by-side biomarker changes.
          </Text>
        </View>

        {sortedReports.length < 2 ? (
          <Card style={styles.emptyHistoryCard}>
            <Text variant="bodySm" tone="muted" style={styles.emptyHistoryText}>
              Upload at least 2 reports to compare biomarker changes.
            </Text>
          </Card>
        ) : (
          <Card style={styles.compareCard}>
            <View style={styles.compareSelectors}>
              <View style={styles.compareColumn}>
                <Text variant="caption" tone="muted" weight="bold">
                  EARLIER
                </Text>
                {sortedReports.map((report) => (
                  <Pressable
                    key={`baseline-${report.id}`}
                    style={[
                      styles.reportChip,
                      baselineReportId === report.id ? styles.reportChipSelected : null,
                    ]}
                    onPress={() => setBaselineReportId(report.id)}
                  >
                    <Text
                      variant="caption"
                      tone={baselineReportId === report.id ? 'inverse' : 'default'}
                      weight="semibold"
                    >
                      {formatDate(report.report_date, { month: 'short', day: 'numeric', year: '2-digit' })}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.compareColumn}>
                <Text variant="caption" tone="muted" weight="bold">
                  LATER
                </Text>
                {sortedReports.map((report) => (
                  <Pressable
                    key={`followup-${report.id}`}
                    style={[
                      styles.reportChip,
                      followupReportId === report.id ? styles.reportChipSelected : null,
                    ]}
                    onPress={() => setFollowupReportId(report.id)}
                  >
                    <Text
                      variant="caption"
                      tone={followupReportId === report.id ? 'inverse' : 'default'}
                      weight="semibold"
                    >
                      {formatDate(report.report_date, { month: 'short', day: 'numeric', year: '2-digit' })}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {compareRows.slice(0, 8).map((row) => (
              <View key={row.name} style={styles.compareRow}>
                <View style={styles.compareTextColumn}>
                  <Text variant="bodySm" weight="semibold">
                    {row.name}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {row.baseline.toFixed(2)} → {row.followup.toFixed(2)} {row.unit}
                  </Text>
                </View>
                {row.delta === 0 ? (
                  <View style={styles.compareDelta}>
                    <Minus size={14} color={theme.colors.mutedText3} />
                    <Text variant="caption" tone="muted">
                      0%
                    </Text>
                  </View>
                ) : row.delta > 0 ? (
                  <View style={styles.compareDelta}>
                    <ArrowUp size={14} color={theme.colors.warning} />
                    <Text variant="caption" tone="warning" weight="semibold">
                      +{row.percent.toFixed(0)}%
                    </Text>
                  </View>
                ) : (
                  <View style={styles.compareDelta}>
                    <ArrowDown size={14} color={theme.colors.success} />
                    <Text variant="caption" tone="success" weight="semibold">
                      {row.percent.toFixed(0)}%
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </Card>
        )}

        <View style={styles.sectionHeader}>
          <Text variant="titleSm">Labs timeline</Text>
          <Text variant="caption" tone="muted">
            Trends over time with active interventions.
          </Text>
        </View>

        {sortedReports.length === 0 ? (
          <Card style={styles.emptyHistoryCard}>
            <Text variant="bodySm" tone="muted" style={styles.emptyHistoryText}>
              No lab reports yet.
            </Text>
          </Card>
        ) : (
          sortedReports.map((report, index) => {
            const previousReport = index > 0 ? sortedReports[index - 1] : null;
            const reportBiomarkers = biomarkersByReport[report.id] ?? [];
            const previousBiomarkers = previousReport
              ? biomarkersByReport[previousReport.id] ?? []
              : [];
            const activeDuringReport = interventions.filter(
              (intervention) =>
                intervention.start_date <= report.report_date &&
                (!intervention.end_date || intervention.end_date >= report.report_date)
            );

            const highlights = KEY_BIOMARKERS.map((name) => {
              const current = reportBiomarkers.find(
                (entry) => entry.name.toLowerCase().trim() === name
              );
              if (!current || !previousReport) {
                return null;
              }
              const previous = previousBiomarkers.find(
                (entry) =>
                  entry.name.toLowerCase().trim() === current.name.toLowerCase().trim()
              );
              if (!previous) {
                return null;
              }
              const delta = current.value - previous.value;
              return { name: current.name, delta, unit: current.unit };
            }).filter(Boolean) as Array<{ name: string; delta: number; unit: string }>;

            return (
              <Card key={report.id} style={styles.timelineCard}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate('ReportDetail', { reportId: report.id })}
                >
                  <Text variant="body" weight="bold">
                    {formatDate(report.report_date, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </Text>
                  {activeDuringReport.length > 0 ? (
                    <View style={styles.badgeRow}>
                      {activeDuringReport.slice(0, 3).map((intervention) => (
                        <View key={intervention.id} style={styles.badge}>
                          <Text variant="caption" tone="muted" weight="semibold">
                            {intervention.title}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {highlights.slice(0, 3).map((item) => (
                    <View key={item.name} style={styles.compareRow}>
                      <Text variant="caption" tone="muted">
                        {item.name}
                      </Text>
                      <Text
                        variant="caption"
                        tone={item.delta > 0 ? 'warning' : item.delta < 0 ? 'success' : 'muted'}
                        weight="semibold"
                      >
                        {item.delta > 0 ? '+' : ''}
                        {item.delta.toFixed(1)} {item.unit}
                      </Text>
                    </View>
                  ))}
                </TouchableOpacity>
              </Card>
            );
          })
        )}

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
                  Pick the dates for this cycle entry to keep predictions accurate.
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

      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        transparent
        visible={interventionModalOpen}
        onRequestClose={closeInterventionEditor}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalBackdrop} />
          <Card style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text variant="titleSm">
                  {editingIntervention ? 'Edit intervention' : 'Add intervention'}
                </Text>
                <Text variant="bodySm" tone="muted">
                  Track supplements, medications, and lifestyle changes.
                </Text>
              </View>
              <Pressable onPress={closeInterventionEditor} style={styles.modalCloseButton}>
                <X size={18} color={theme.colors.mutedText3} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Input
                label="Title"
                value={interventionTitle}
                onChangeText={setInterventionTitle}
                placeholder="e.g., Magnesium glycinate"
              />

              <View style={styles.formSection}>
                <Text variant="label">Category</Text>
                <View style={styles.chipGrid}>
                  {INTERVENTION_CATEGORIES.map((option) => {
                    const selected = option.value === interventionCategory;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => setInterventionCategory(option.value)}
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

              <DateField
                label="Start date"
                value={interventionStartDate}
                onChange={setInterventionStartDate}
                maximumDate={new Date()}
              />

              <DateField
                label="End date"
                value={interventionEndDate}
                onChange={setInterventionEndDate}
                hint="Leave blank if this is ongoing."
                allowClear
                minimumDate={parseDateValue(interventionStartDate)}
                maximumDate={new Date()}
              />

              <Input
                label="Notes"
                value={interventionNotes}
                onChangeText={setInterventionNotes}
                multiline
                placeholder="Dose, timing, adherence, or any context..."
              />

              <View style={styles.modalActions}>
                <Button
                  label="Cancel"
                  onPress={closeInterventionEditor}
                  variant="ghost"
                  style={styles.flexButton}
                />
                <Button
                  label={editingIntervention ? 'Save changes' : 'Save intervention'}
                  onPress={() => {
                    void handleSaveIntervention();
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
    marginBottom: theme.spacing.xl,
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
  compareCard: {
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  compareSelectors: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  compareColumn: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  reportChip: {
    borderRadius: theme.radii.pill,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.surface2,
  },
  reportChipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: theme.borders.thin,
    borderTopColor: theme.colors.borderSubtle,
    paddingTop: theme.spacing.sm,
  },
  compareTextColumn: {
    flex: 1,
  },
  compareDelta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xxs,
  },
  timelineCard: {
    marginBottom: theme.spacing.sm,
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
