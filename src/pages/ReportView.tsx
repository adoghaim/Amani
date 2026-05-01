import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BiomarkerCard } from '../components/BiomarkerCard';
import { DerivedMetricsPanel } from '../components/DerivedMetricsPanel';
import { InsightFlagsPanel } from '../components/InsightFlagsPanel';
import { TopFindingsCard } from '../components/TopFindingsCard';
import { BiggestChangesCard } from '../components/BiggestChangesCard';
import { WhatToWatchCard } from '../components/WhatToWatchCard';
import { SystemSummaryCards } from '../components/SystemSummaryCards';
import { DoctorQuestionsCard } from '../components/DoctorQuestionsCard';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { RecommendedLabs } from '../components/RecommendedLabs';
import { computeDerivedMetrics, evaluateInsightRules } from '../utils/derivedMetrics';
import { BIOMARKER_CATEGORY_MAP, BIOMARKER_DISPLAY, RECOMMENDED_LABS } from '../utils/biomarkerDefinitions';
import { classifyLabValue } from '../utils/classifyLabValue';
import { buildInsightSummary } from '../lib/insights/buildInsightSummary';
import { buildPersonalInsights } from '../lib/insights/buildPersonalInsights';
import { computeBaseline } from '../lib/personalization/baseline';
import { analyzeTrend } from '../lib/personalization/trendAnalysis';
import { CATEGORY_DISPLAY, PERSONALIZATION_THRESHOLDS } from '../types';
import { YourPatternsCard } from '../components/YourPatternsCard';
import { PrimaryInsightCard } from '../components/PrimaryInsightCard';
import type { PersonalPattern, SymptomLog, BaselineStatus, TrendDirection, TrendStrength } from '../types';
import type { InsightSummary, BiggestChange } from '../lib/insights/buildInsightSummary';
import type {
  LabReport, Biomarker, AIInterpretation, BiomarkerCategory,
  BiomarkerName, ReportAnalyte,
} from '../types';
import {
  RefreshCw, Trash2, AlertCircle, ChevronDown, ChevronRight,
  Microscope, Sparkles, Stethoscope, CalendarDays,
  CheckCircle2, Loader2, Info, Activity, Lightbulb, AlertTriangle, FlaskConical,
} from 'lucide-react';
import type { LabSource } from '../types';

const CATEGORY_ORDER: BiomarkerCategory[] = [
  'hormones', 'thyroid', 'metabolic', 'lipids', 'liver', 'kidney', 'inflammation', 'nutrients',
];

const CORE_BIOMARKER_CATEGORIES_UI: Record<string, string> = {
  wbc: 'Blood (CBC)', rbc: 'Blood (CBC)', hemoglobin: 'Blood (CBC)', hematocrit: 'Blood (CBC)',
  mcv: 'Blood (CBC)', mch: 'Blood (CBC)', mchc: 'Blood (CBC)', rdw: 'Blood (CBC)',
  platelets: 'Blood (CBC)', mpv: 'Blood (CBC)',
  neutrophils: 'Blood (CBC)', lymphocytes: 'Blood (CBC)', monocytes: 'Blood (CBC)',
  eosinophils: 'Blood (CBC)', basophils: 'Blood (CBC)',
  neutrophils_abs: 'Blood (CBC)', lymphocytes_abs: 'Blood (CBC)', monocytes_abs: 'Blood (CBC)',
  eosinophils_abs: 'Blood (CBC)', basophils_abs: 'Blood (CBC)',
  sodium: 'Metabolic (CMP)', potassium: 'Metabolic (CMP)', chloride: 'Metabolic (CMP)',
  co2: 'Metabolic (CMP)', calcium: 'Metabolic (CMP)',
  total_protein: 'Liver', albumin: 'Liver', globulin: 'Liver', albumin_globulin_ratio: 'Liver',
  chol_hdl_ratio: 'Lipids', bun_creatinine_ratio: 'Kidney',
  t3_uptake: 'Thyroid', free_thyroxine_index: 'Thyroid', total_t3: 'Thyroid',
  serum_iron: 'Nutrients (Iron)', tibc: 'Nutrients (Iron)', uibc: 'Nutrients (Iron)',
};

const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  in_range:    { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'In range' },
  out_of_range:{ bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500',     label: 'Out of range' },
  borderline:  { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400',   label: 'Borderline' },
  unknown:     { bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400',    label: 'No range' },
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high:   'text-emerald-700 bg-emerald-50 border-emerald-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  low:    'text-gray-500 bg-gray-100 border-gray-200',
};

const PATTERN_CONFIDENCE_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  high:   { bg: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-100',   label: 'High confidence' },
  medium: { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-100',  label: 'Medium confidence' },
  low:    { bg: 'bg-gray-50',   text: 'text-gray-600',   border: 'border-gray-200',   label: 'Low confidence' },
};

interface OpeningContext {
  primaryIsImproving: boolean;
  primaryImprovingChange: BiggestChange | null;
  primaryIsWorsening: boolean;
  primaryWorseningChange: BiggestChange | null;
  primaryIsStableAbnormal: boolean;
  primaryStableChange: BiggestChange | null;
  primaryHasDelta: boolean;
  anyWorsening: boolean;
  worseningChange: BiggestChange | null;
  anyBoundaryCrossImproved: boolean;
}

function getOpeningContext(summary: InsightSummary): OpeningContext {
  const primaryKey = summary.primaryFinding?.key ?? null;

  const primaryImprovingChange = primaryKey
    ? (summary.biggestChanges.find(
        c =>
          c.key === primaryKey &&
          (c.trajectoryStatus === 'improving_still_high' || c.trajectoryStatus === 'improving_still_low') &&
          c.significance !== 'minor',
      ) ?? null)
    : null;

  const primaryRawDelta = primaryKey ? summary.deltaMap.get(primaryKey) ?? null : null;

  const primaryWorseningChange: BiggestChange | null = (() => {
    if (!primaryKey || !primaryRawDelta) return null;
    if (
      primaryRawDelta.trajectoryStatus !== 'worsening_still_high' &&
      primaryRawDelta.trajectoryStatus !== 'worsening_still_low'
    ) return null;
    const fromBiggest = summary.biggestChanges.find(c => c.key === primaryKey);
    if (fromBiggest) return fromBiggest;
    return {
      key: primaryRawDelta.key,
      displayName: primaryRawDelta.displayName,
      previousValue: primaryRawDelta.previousValue,
      currentValue: primaryRawDelta.currentValue,
      unit: primaryRawDelta.unit,
      percentDelta: primaryRawDelta.percentDelta,
      trendDirection: primaryRawDelta.trendDirection,
      significance: primaryRawDelta.significance,
      boundaryCrossing: primaryRawDelta.boundaryCrossing,
      trajectoryStatus: primaryRawDelta.trajectoryStatus,
      distanceToNormalImprovement: primaryRawDelta.distanceToNormalImprovement,
      fact: '',
    };
  })();

  const primaryStableChange: BiggestChange | null = (() => {
    if (!primaryKey || !primaryRawDelta) return null;
    if (primaryRawDelta.trajectoryStatus !== 'stable_abnormal') return null;
    if (primaryRawDelta.previousValue === undefined || primaryRawDelta.currentValue === undefined) return null;
    const fromBiggest = summary.biggestChanges.find(c => c.key === primaryKey);
    if (fromBiggest) return fromBiggest;
    return {
      key: primaryRawDelta.key,
      displayName: primaryRawDelta.displayName,
      previousValue: primaryRawDelta.previousValue,
      currentValue: primaryRawDelta.currentValue,
      unit: primaryRawDelta.unit,
      percentDelta: primaryRawDelta.percentDelta,
      trendDirection: primaryRawDelta.trendDirection,
      significance: primaryRawDelta.significance,
      boundaryCrossing: primaryRawDelta.boundaryCrossing,
      trajectoryStatus: primaryRawDelta.trajectoryStatus,
      distanceToNormalImprovement: primaryRawDelta.distanceToNormalImprovement,
      fact: '',
    };
  })();

  const worseningChange =
    summary.biggestChanges.find(
      c =>
        c.trajectoryStatus === 'worsening_still_high' ||
        c.trajectoryStatus === 'worsening_still_low' ||
        c.boundaryCrossing?.direction === 'worsened',
    ) ?? null;

  return {
    primaryIsImproving: primaryImprovingChange !== null,
    primaryImprovingChange,
    primaryIsWorsening: primaryWorseningChange !== null,
    primaryWorseningChange,
    primaryIsStableAbnormal: primaryStableChange !== null,
    primaryStableChange,
    primaryHasDelta: primaryImprovingChange !== null || primaryWorseningChange !== null || primaryStableChange !== null,
    anyWorsening: worseningChange !== null,
    worseningChange,
    anyBoundaryCrossImproved: summary.biggestChanges.some(c => c.boundaryCrossing?.direction === 'improved'),
  };
}

function AnalyteRow({ analyte }: { analyte: ReportAnalyte }) {
  const status = classifyLabValue(
    analyte.value_numeric,
    analyte.normalized_min,
    analyte.normalized_max,
    analyte.normalized_operator,
    analyte.normalized_operator_value
  );
  const style = STATUS_STYLE[status];
  const label = analyte.display_name || analyte.raw_name;
  const isUnmapped = analyte.parse_status === 'unmapped';
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 truncate">{label}</p>
          {isUnmapped && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">unmapped</span>
          )}
        </div>
        {analyte.raw_reference_range && (
          <p className="text-xs text-gray-400 mt-0.5">Ref: {analyte.raw_reference_range}</p>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
        <span className="text-sm font-semibold text-gray-900 tabular-nums">
          {analyte.raw_value_text ?? analyte.value_numeric}
          {analyte.unit && <span className="text-gray-500 font-normal ml-1 text-xs">{analyte.unit}</span>}
        </span>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
      </div>
    </div>
  );
}

function normalizeInterpretation(raw: unknown): AIInterpretation {
  const data = raw && typeof raw === 'object'
    ? raw as Partial<AIInterpretation> & Record<string, unknown>
    : {};

  return {
    ...data,
    headline: typeof data.headline === 'string' ? data.headline : '',
    summary_bullets: Array.isArray(data.summary_bullets) ? data.summary_bullets : [],
    primary_concern: data.primary_concern && typeof data.primary_concern === 'object'
      ? data.primary_concern as AIInterpretation['primary_concern']
      : undefined,
    key_findings: Array.isArray(data.key_findings) ? data.key_findings : undefined,
    what_you_can_do_now: Array.isArray(data.what_you_can_do_now) ? data.what_you_can_do_now : undefined,
    what_to_do_next: Array.isArray(data.what_to_do_next) ? data.what_to_do_next : undefined,
    top_findings: Array.isArray(data.top_findings) ? data.top_findings : [],
    pattern_signals: Array.isArray(data.pattern_signals) ? data.pattern_signals : [],
    questions_for_doctor: Array.isArray(data.questions_for_doctor) ? data.questions_for_doctor : [],
    disclaimer: typeof data.disclaimer === 'string' ? data.disclaimer : '',
    cycle_context: data.cycle_context as AIInterpretation['cycle_context'] ?? {
      estimated_cycle_day: null,
      estimated_cycle_phase: 'unknown',
      confidence: 'low',
      explanation: '',
    },
    safety_notes: Array.isArray(data.safety_notes) ? data.safety_notes : [],
    suggested_followups_to_discuss: Array.isArray(data.suggested_followups_to_discuss)
      ? data.suggested_followups_to_discuss
      : data.suggested_followups_to_discuss
        ? [String(data.suggested_followups_to_discuss)]
        : [],
  };
}

export function ReportView() {
  const { id: reportId = '' } = useParams<{ id: string }>();
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState<LabReport | null>(null);
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>([]);
  const [reportAnalytes, setReportAnalytes] = useState<ReportAnalyte[]>([]);
  const [interpretation, setInterpretation] = useState<AIInterpretation | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState<BiomarkerCategory | null>(null);
  const [showFullPanel, setShowFullPanel] = useState(false);
  const [showRecommendedLabs, setShowRecommendedLabs] = useState(true);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<BiomarkerCategory>>(new Set());
  const [categoriesInitialized, setCategoriesInitialized] = useState(false);
  const [previousBiomarkers, setPreviousBiomarkers] = useState<Biomarker[]>([]);
  const [historicalBiomarkers, setHistoricalBiomarkers] = useState<Map<string, { reportDate: string; value: number }[]>>(new Map());
  const [symptomLogs, setSymptomLogs] = useState<SymptomLog[]>([]);
  const [historicalReportCount, setHistoricalReportCount] = useState(0);
  const [interpGaveUp, setInterpGaveUp] = useState(false);
  const interpPollingActive = useRef(false);
  const interpRetryFired = useRef(false);

  useEffect(() => { fetchReport(); }, [reportId]);

  useEffect(() => {
    if (!report || report.status !== 'processing') return;
    let elapsed = 0;
    const POLL_INTERVAL = 3000;
    // 90s: edge function can take up to 28s for OpenAI + DB writes + startup latency
    const TIMEOUT_MS = 90000;
    const interval = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      const { data } = await supabase
        .from('lab_reports').select('status').eq('id', reportId).maybeSingle();
      if (data && data.status !== 'processing') {
        clearInterval(interval);
        fetchReport();
        const { data: interpData } = await supabase
          .from('interpretations')
          .select('id, json_output')
          .eq('lab_report_id', reportId)
          .maybeSingle();
        if (interpData?.json_output) {
          setInterpretation(normalizeInterpretation(interpData.json_output));
        }
        return;
      }
      if (elapsed >= TIMEOUT_MS) {
        clearInterval(interval);
        await supabase.from('lab_reports').update({ status: 'ready' }).eq('id', reportId);
        fetchReport();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [report?.status, reportId]);

  useEffect(() => {
    if (!report || (report.status !== 'ready' && report.status !== 'error') || interpretation !== null) return;
    if (interpPollingActive.current) return;

    interpPollingActive.current = true;
    interpRetryFired.current = false;
    setInterpGaveUp(false);

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { data: existing } = await supabase
          .from('interpretations')
          .select('id, json_output')
          .eq('lab_report_id', reportId)
          .maybeSingle();

        if (cancelled) return;

        if (existing?.json_output) {
          interpPollingActive.current = false;
          setInterpretation(normalizeInterpretation(existing.json_output));
          return;
        }

        interpRetryFired.current = true;
        const { error: invokeErr } = await supabase.functions.invoke('generate-interpretation', {
          body: { reportId },
        });
        if (cancelled) return;
        if (invokeErr) {
          interpPollingActive.current = false;
          setInterpGaveUp(true);
          return;
        }

        let elapsed = 0;
        const POLL_INTERVAL = 3000;
        const TIMEOUT_MS = 120000;
        pollInterval = setInterval(async () => {
          if (cancelled) { clearInterval(pollInterval!); return; }
          elapsed += POLL_INTERVAL;
          const { data } = await supabase
            .from('interpretations')
            .select('id, json_output')
            .eq('lab_report_id', reportId)
            .maybeSingle();
          if (data?.json_output) {
            clearInterval(pollInterval!);
            interpPollingActive.current = false;
            setInterpretation(normalizeInterpretation(data.json_output));
            return;
          }
          if (elapsed >= TIMEOUT_MS) {
            clearInterval(pollInterval!);
            interpPollingActive.current = false;
            setInterpGaveUp(true);
          }
        }, POLL_INTERVAL);
      } catch {
        if (!cancelled) {
          interpPollingActive.current = false;
          setInterpGaveUp(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [report?.status, report?.id, interpretation, reportId]);

  const fetchReport = async (isRetry = false) => {
    const { data: reportData, error: reportError } = await supabase
      .from('lab_reports').select('*').eq('id', reportId).maybeSingle();
    if (reportError) { setError(`Failed to load: ${reportError.message}`); setLoading(false); return; }
    if (!reportData) {
      if (!isRetry) {
        await new Promise(r => setTimeout(r, 1200));
        return fetchReport(true);
      }
      setError('Report not found');
      setLoading(false);
      return;
    }
    setReport(reportData as LabReport);

    const [{ data: biomarkersData }, { data: analytesData }, { data: interpretationData }] = await Promise.all([
      supabase.from('biomarkers').select('*').eq('lab_report_id', reportId),
      supabase.from('report_analytes').select('*').eq('lab_report_id', reportId).order('raw_name'),
      supabase.from('interpretations').select('*').eq('lab_report_id', reportId).maybeSingle(),
    ]);

    if (biomarkersData) setBiomarkers(biomarkersData as Biomarker[]);
    if (analytesData) setReportAnalytes(analytesData as ReportAnalyte[]);
    if (interpretationData?.json_output) {
      setInterpretation(normalizeInterpretation(interpretationData.json_output));
    }

    setLoading(false);

    if (reportData.user_id) {
      const windowStart = new Date(reportData.report_date);
      windowStart.setDate(windowStart.getDate() - PERSONALIZATION_THRESHOLDS.SYMPTOM_WINDOW_DAYS);
      const windowEnd = new Date(reportData.report_date);
      windowEnd.setDate(windowEnd.getDate() + PERSONALIZATION_THRESHOLDS.SYMPTOM_WINDOW_DAYS);

      const [
        { data: prevReportData },
        { data: allReportsData },
        { data: symptomLogsData },
      ] = await Promise.all([
        supabase
          .from('lab_reports')
          .select('id')
          .eq('user_id', reportData.user_id)
          .lt('report_date', reportData.report_date)
          .order('report_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('lab_reports')
          .select('id, report_date')
          .eq('user_id', reportData.user_id)
          .lt('report_date', reportData.report_date)
          .order('report_date', { ascending: true }),
        supabase
          .from('symptom_logs')
          .select('*')
          .eq('user_id', reportData.user_id)
          .gte('log_date', windowStart.toISOString().split('T')[0])
          .lte('log_date', windowEnd.toISOString().split('T')[0]),
      ]);

      if (prevReportData?.id) {
        const { data: prevBioData } = await supabase
          .from('biomarkers')
          .select('*')
          .eq('lab_report_id', prevReportData.id);
        if (prevBioData) setPreviousBiomarkers(prevBioData as Biomarker[]);
      }

      if (symptomLogsData) {
        setSymptomLogs(symptomLogsData as SymptomLog[]);
      }

      if (allReportsData && allReportsData.length > 0) {
        setHistoricalReportCount(allReportsData.length);
        const reportDateMap = new Map<string, string>();
        for (const r of allReportsData) {
          reportDateMap.set(r.id, r.report_date);
        }

        const allHistoricalIds = allReportsData.map(r => r.id);
        const { data: allHistoricalBiomarkers } = await supabase
          .from('biomarkers')
          .select('name, value, lab_report_id')
          .in('lab_report_id', allHistoricalIds);

        if (allHistoricalBiomarkers) {
          const histMap = new Map<string, { reportDate: string; value: number }[]>();
          for (const b of allHistoricalBiomarkers) {
            const reportDate = reportDateMap.get(b.lab_report_id);
            if (!reportDate) continue;
            if (!histMap.has(b.name)) histMap.set(b.name, []);
            histMap.get(b.name)!.push({ reportDate, value: b.value });
          }
          setHistoricalBiomarkers(histMap);
        }
      }
    }
  };

  const derivedMetrics = useMemo(() => computeDerivedMetrics(biomarkers), [biomarkers]);
  const insightFlags = useMemo(
    () => evaluateInsightRules(biomarkers, report?.estimated_cycle_phase),
    [biomarkers, report]
  );

  const analyteTelemetryMap = useMemo(() => {
    const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const NORM_RANK: Record<string, number> = { mapped: 3, partial: 2, unmapped: 1 };
    const map = new Map<string, { parserConfidence: 'high' | 'medium' | 'low'; normalizationStatus: 'mapped' | 'partial' | 'unmapped'; sourceFormat: 'text' | 'ocr' | 'manual' | 'unknown' | null }>();
    for (const a of reportAnalytes) {
      if (!a.canonical_slug) continue;
      const incoming = {
        parserConfidence: a.confidence_score,
        normalizationStatus: (a.normalization_status ?? a.parse_status) as 'mapped' | 'partial' | 'unmapped',
        sourceFormat: a.source_format ?? null,
      };
      const existing = map.get(a.canonical_slug);
      if (!existing) {
        map.set(a.canonical_slug, incoming);
      } else {
        const incomingScore =
          (CONFIDENCE_RANK[incoming.parserConfidence] ?? 0) +
          (NORM_RANK[incoming.normalizationStatus] ?? 0);
        const existingScore =
          (CONFIDENCE_RANK[existing.parserConfidence] ?? 0) +
          (NORM_RANK[existing.normalizationStatus] ?? 0);
        if (incomingScore > existingScore) {
          map.set(a.canonical_slug, incoming);
        }
      }
    }
    return map;
  }, [reportAnalytes]);

  const dominantSourceFormat = useMemo<'text' | 'ocr' | 'manual' | 'unknown' | null>(() => {
    if (reportAnalytes.length === 0) return null;
    const counts: Record<string, number> = {};
    for (const a of reportAnalytes) {
      const fmt = a.source_format ?? 'unknown';
      counts[fmt] = (counts[fmt] ?? 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = sorted[0]?.[0];
    if (!top || top === 'unknown') return null;
    return top as 'text' | 'ocr' | 'manual';
  }, [reportAnalytes]);

  const personalInsights = useMemo<PersonalPattern[]>(() => {
    if (biomarkers.length === 0 || historicalReportCount === 0) return [];
    const currentBiomarkers = biomarkers.map(b => ({
      name: b.name,
      value: b.value,
      flagged: b.flagged as 'out_of_range' | 'borderline' | 'in_range' | 'unknown',
    }));
    return buildPersonalInsights(
      currentBiomarkers,
      historicalBiomarkers,
      symptomLogs,
      report?.report_date ?? ''
    );
  }, [biomarkers, historicalBiomarkers, symptomLogs, historicalReportCount, report]);

  const biomarkerPersonalizationMap = useMemo(() => {
    const map = new Map<string, {
      baselineStatus?: BaselineStatus;
      baselineValue?: number;
      trendDirection?: TrendDirection;
      trendStrength?: TrendStrength;
    }>();

    if (historicalReportCount < PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_BASELINE) return map;

    for (const b of biomarkers) {
      const history = historicalBiomarkers.get(b.name);
      if (!history || history.length === 0) continue;

      const ordered = history
        .sort((a, c) => a.reportDate.localeCompare(c.reportDate))
        .map(h => h.value);

      const entry: {
        baselineStatus?: BaselineStatus;
        baselineValue?: number;
        trendDirection?: TrendDirection;
        trendStrength?: TrendStrength;
      } = {};

      if (ordered.length >= PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_BASELINE) {
        const baseline = computeBaseline(ordered, b.value);
        if (baseline) {
          entry.baselineStatus = baseline.baselineStatus;
          entry.baselineValue = baseline.baselineValue;
        }
      }

      if (ordered.length >= PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_TREND) {
        const trend = analyzeTrend([...ordered, b.value]);
        if (trend) {
          entry.trendDirection = trend.trendDirection;
          entry.trendStrength = trend.trendStrength;
        }
      }

      if (Object.keys(entry).length > 0) {
        map.set(b.name, entry);
      }
    }

    return map;
  }, [biomarkers, historicalBiomarkers, historicalReportCount]);

  const insightSummary = useMemo(() => {
    if (biomarkers.length === 0) return null;
    const current = biomarkers.map(b => {
      const telemetry = analyteTelemetryMap.get(b.name);
      return {
        key: b.name as BiomarkerName,
        value: b.value,
        unit: b.unit,
        labRefMin: b.reference_min,
        labRefMax: b.reference_max,
        parserConfidence: telemetry?.parserConfidence ?? null,
        normalizationStatus: telemetry?.normalizationStatus ?? null,
        sourceFormat: telemetry?.sourceFormat ?? null,
      };
    });
    const previous = previousBiomarkers.length > 0
      ? previousBiomarkers.map(b => ({
          key: b.name as BiomarkerName,
          value: b.value,
          unit: b.unit,
          labRefMin: b.reference_min,
          labRefMax: b.reference_max,
        }))
      : null;
    return buildInsightSummary(current, previous, report?.estimated_cycle_phase);
  }, [biomarkers, previousBiomarkers, report, analyteTelemetryMap]);



  const groupedBiomarkers = useMemo(() => {
    const groups: Partial<Record<BiomarkerCategory, Biomarker[]>> = {};
    for (const b of biomarkers) {
      const cat = BIOMARKER_CATEGORY_MAP[b.name as BiomarkerName] ?? null;
      if (!cat) continue;
      if (!groups[cat]) groups[cat] = [];
      groups[cat]!.push(b);
    }
    return groups;
  }, [biomarkers]);

  const sortedGroupedBiomarkers = useMemo(() => {
    const result: Partial<Record<BiomarkerCategory, Biomarker[]>> = {};
    for (const [cat, items] of Object.entries(groupedBiomarkers) as [BiomarkerCategory, Biomarker[]][]) {
      const sorted = [...items].sort((a, b) => {
        const flagOrder = { out_of_range: 0, borderline: 1, unknown: 2, in_range: 3 };
        return (flagOrder[a.flagged] ?? 3) - (flagOrder[b.flagged] ?? 3);
      });
      result[cat] = sorted;
    }
    return result;
  }, [groupedBiomarkers]);

  useEffect(() => {
    if (biomarkers.length === 0 || categoriesInitialized) return;
    // Default: collapse every system. Auto-expand only the system containing the primary finding.
    const toCollapse = new Set<BiomarkerCategory>();
    const primaryKey = insightSummary?.primaryFinding?.key ?? null;
    const primaryCategory = primaryKey
      ? (BIOMARKER_CATEGORY_MAP[primaryKey as BiomarkerName] ?? null)
      : null;
    for (const cat of CATEGORY_ORDER) {
      const items = sortedGroupedBiomarkers[cat];
      if (!items || items.length === 0) continue;
      if (cat !== primaryCategory) toCollapse.add(cat);
    }
    setCollapsedCategories(toCollapse);
    setCategoriesInitialized(true);
  }, [biomarkers, sortedGroupedBiomarkers, categoriesInitialized, insightSummary]);

  const interpMap = useMemo(() => {
    if (!interpretation?.biomarkers) return new Map<string, NonNullable<AIInterpretation['biomarkers']>[number]>();
    return new Map(interpretation.biomarkers.map(b => [b.name, b]));
  }, [interpretation]);

  const filteredCategories = useMemo(() => {
    if (activeCategory) {
      const items = sortedGroupedBiomarkers[activeCategory];
      if (!items) return [];
      return [{ category: activeCategory, items }];
    }
    return CATEGORY_ORDER
      .map(cat => ({ category: cat, items: sortedGroupedBiomarkers[cat] ?? [] }))
      .filter(g => g.items.length > 0);
  }, [sortedGroupedBiomarkers, activeCategory]);

  const presentBiomarkerNames = useMemo(() => {
    const fromBiomarkers = biomarkers.map(b => b.name);
    const fromAnalytes = reportAnalytes.filter(a => a.canonical_slug).map(a => a.canonical_slug as string);
    return [...new Set([...fromBiomarkers, ...fromAnalytes])];
  }, [biomarkers, reportAnalytes]);

  const analytesForDisplay = useMemo(() => {
    const nonCore = reportAnalytes.filter(a => !a.is_core);
    const groups: Record<string, ReportAnalyte[]> = {};
    for (const a of nonCore) {
      const key = (a.canonical_slug
        ? (CORE_BIOMARKER_CATEGORIES_UI[a.canonical_slug] ?? a.canonical_slug.replace(/_/g, ' '))
        : null) ?? 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    }
    const unmapped = reportAnalytes.filter(a => a.is_core && a.parse_status === 'unmapped');
    if (unmapped.length > 0) groups['Unmapped'] = [...(groups['Unmapped'] ?? []), ...unmapped];
    return groups;
  }, [reportAnalytes]);

  const totalAnalyteCount = useMemo(() => reportAnalytes.filter(a => !a.is_core).length, [reportAnalytes]);

  const hasRecommendedLabs = useMemo(() => {
    const presentSet = new Set(presentBiomarkerNames);
    return (Object.keys(RECOMMENDED_LABS) as BiomarkerCategory[]).some(cat =>
      (RECOMMENDED_LABS[cat] ?? []).some(r => !presentSet.has(r.name))
    );
  }, [presentBiomarkerNames]);

  const handleRegenerate = async () => {
    if (!report || report.regeneration_count >= 3) return;
    if (userProfile?.subscription_status !== 'active' && !isTrialActive()) return;
    setRegenerating(true);
    setError('');
    try {
      await supabase.from('interpretations').delete().eq('lab_report_id', reportId);
      await supabase.from('lab_reports').update({
        status: 'processing',
        regeneration_count: report.regeneration_count + 1,
      }).eq('id', reportId);
      const { data: fnData, error: interpError } = await supabase.functions.invoke('generate-interpretation', { body: { reportId } });
      if (interpError || !fnData?.success) {
        await supabase.from('lab_reports').update({ status: 'error' }).eq('id', reportId);
      }
      await fetchReport();
    } catch {
      await supabase.from('lab_reports').update({ status: 'error' }).eq('id', reportId);
      await fetchReport();
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    const { error } = await supabase.from('lab_reports').delete().eq('id', reportId);
    if (!error) navigate('/app', { replace: true });
  };

  const isTrialActive = () => {
    if (!userProfile) return false;
    if (userProfile.subscription_status === 'active') return true;
    if (userProfile.subscription_status === 'trial') {
      const trialStart = new Date(userProfile.trial_start_date);
      const days = Math.floor((Date.now() - trialStart.getTime()) / 86400000);
      return days < 7;
    }
    return false;
  };

  const formatDate = (d: string) => {
    if (!d) return '—';
    const base = d.length === 10 ? d + 'T12:00:00' : d;
    return new Date(base).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#C97C8B]" />
        </div>
      </Layout>
    );
  }

  if (!report) {
    return (
      <Layout>
        <div className="text-center py-12">
          <h1 className="text-xl font-bold text-gray-900 mb-4">Report not found</h1>
          <Link to="/app"><Button>Back to Dashboard</Button></Link>
        </div>
      </Layout>
    );
  }

  const canRegenerate = report.regeneration_count < 3 && (userProfile?.subscription_status === 'active' || isTrialActive());
  const cyclePhase = report.estimated_cycle_phase !== 'unknown' ? report.estimated_cycle_phase : null;
  const hasError = report.status === 'error';
  const isProcessing = report.status === 'processing' || regenerating;

  const resolvedLabSource: LabSource = (() => {
    if (report.lab_source && report.lab_source !== 'unknown') return report.lab_source;
    return 'unknown';
  })();

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">

        {/* ── A. Header ──────────────────────────────────────────── */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-2xl font-bold text-theme-text tracking-tight">
              Lab Report: {formatDate(report.report_date)}
            </h1>
            <p className="text-sm text-theme-muted-text-3 mt-1">
              <span className="font-medium text-theme-muted-text-2">Lab date:</span> {formatDate(report.report_date)}
              {report.upload_date && report.upload_date.split('T')[0] !== report.report_date && (
                <span className="ml-2 text-theme-muted-text-3">
                  (uploaded {formatDate(report.upload_date)})
                </span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {cyclePhase && (
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 capitalize">
                  {cyclePhase.replace(/_/g, ' ')} phase
                </span>
              )}
              <span className="text-xs text-theme-muted-text-3">{biomarkers.length} core biomarkers</span>
              {reportAnalytes.length > 0 && (
                <span className="text-xs text-theme-muted-text-3">{reportAnalytes.length} total analytes</span>
              )}
              {resolvedLabSource !== 'unknown' && (
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                  resolvedLabSource === 'quest'
                    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : 'text-sky-700 bg-sky-50 border-sky-200'
                }`}>
                  <FlaskConical className="w-3 h-3" />
                  Imported from {resolvedLabSource === 'quest' ? 'Quest' : 'Labcorp'}
                </span>
              )}
              {dominantSourceFormat && (
                <span className="text-xs text-theme-muted-text-3 px-1.5 py-0.5 rounded border border-theme-border">
                  Source: {dominantSourceFormat === 'ocr' ? 'OCR' : dominantSourceFormat.charAt(0).toUpperCase() + dominantSourceFormat.slice(1)}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {canRegenerate && (
              <Button variant="secondary" size="sm" onClick={handleRegenerate} disabled={regenerating}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${regenerating ? 'animate-spin' : ''}`} />
                Regenerate ({3 - report.regeneration_count} left)
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={handleDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Delete
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-8">

          {/* ── Processing ──────────────────────────────────────── */}
          {isProcessing && (
            <div className="rounded-2xl border border-theme-border-subtle bg-white px-6 py-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-theme-primary/10 flex items-center justify-center flex-shrink-0">
                <Loader2 className="w-5 h-5 text-theme-primary animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-theme-text">Generating your analysis</p>
                <p className="text-xs text-theme-muted-text-3 mt-0.5">This usually takes 15–30 seconds.</p>
              </div>
            </div>
          )}

          {/* ── Error state ─────────────────────────────────────── */}
          {hasError && !interpretation && interpGaveUp && (() => {
            const hasData = biomarkers.length > 0 || reportAnalytes.length > 0;
            const reason = !hasData
              ? 'No lab values were extracted. The PDF may be image-based.'
              : 'The AI analysis timed out or hit an error. Your lab data is intact below.';
            return (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-900">AI summary failed</p>
                    <p className="text-xs text-red-700 mt-1 leading-relaxed">{reason}</p>
                  </div>
                </div>
                {hasData && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-100/60 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <span>{reportAnalytes.length || biomarkers.length} lab values detected. Your data is intact below.</span>
                  </div>
                )}
                {canRegenerate ? (
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-60"
                  >
                    <RefreshCw className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} />
                    {regenerating ? 'Retrying...' : `Retry summary (${3 - report.regeneration_count} of 3 left)`}
                  </button>
                ) : (
                  <p className="text-xs text-red-600">All retry attempts used. Your lab data is visible below.</p>
                )}
              </div>
            );
          })()}

          {/* ── AI loading indicator (ready/error but no interpretation yet) ─── */}
          {(report.status === 'ready' || report.status === 'error') && !interpretation && !isProcessing && !interpGaveUp && insightSummary && (
            <div className="rounded-2xl border border-theme-border-subtle bg-white px-6 py-4 flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-theme-primary animate-spin flex-shrink-0" />
              <p className="text-sm text-theme-muted-text-2">AI summary is being generated. Your lab data is ready below.</p>
            </div>
          )}

          {/* ── B. Amani Summary (Headline) ──────────────────────── */}
          {(insightSummary || interpretation) && !isProcessing && (
            <div className="rounded-2xl overflow-hidden border border-theme-border-subtle shadow-sm">
              <div className="bg-theme-text px-6 py-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <Sparkles className="w-4 h-4 text-theme-primary-light" />
                  <span className="text-xs font-medium text-theme-muted-text-5 uppercase tracking-widest">Amani Analysis</span>
                  {insightSummary && (
                    <div className="ml-auto">
                      <ConfidenceBadge confidence={insightSummary.confidence} />
                    </div>
                  )}
                </div>
                <h2 className="text-lg font-semibold text-white leading-snug">
                  {(() => {
                    const ctx = insightSummary ? getOpeningContext(insightSummary) : null;
                    const isImproving = ctx?.primaryIsImproving && ctx?.primaryImprovingChange !== null;
                    const isWorsening = ctx?.primaryIsWorsening && ctx?.primaryWorseningChange !== null;
                    const isStableAbnormal = ctx?.primaryIsStableAbnormal && ctx?.primaryStableChange !== null;

                    if (insightSummary) {
                      const allFindings = insightSummary.primaryFinding ? [insightSummary.primaryFinding, ...insightSummary.topFindings] : insightSummary.topFindings;
                      const outOfRange = allFindings.filter(f => f.status === 'out_of_range');
                      const borderline = allFindings.filter(f => f.status === 'borderline');
                      const topName = outOfRange[0]?.displayName ?? borderline[0]?.displayName;
                      const secondName = outOfRange[1]?.displayName ?? (outOfRange.length === 0 ? borderline[1]?.displayName : borderline[0]?.displayName);
                      const dirLabel = insightSummary.primaryFinding?.direction === 'low' ? 'remains low' : 'remains elevated';

                      // Force trajectory headline override if improving
                      if (isImproving && ctx.primaryImprovingChange) {
                        const ch = ctx.primaryImprovingChange;
                        const pctStr = ch.percentDelta !== null ? ` (down ${Math.abs(ch.percentDelta)}%)` : '';
                        const valueStr = `from ${ch.previousValue} to ${ch.currentValue} ${ch.unit}${pctStr}`;
                        if (!ctx.anyWorsening) {
                          return `${topName} ${dirLabel}, but has improved ${valueStr} since your last report — a meaningful move in the right direction.`;
                        }
                        const worsenedName = ctx.worseningChange?.displayName;
                        return `${topName} has improved ${valueStr} since your last report, though ${worsenedName ?? 'another marker'} still warrants attention.`;
                      }

                      // Force trajectory headline override if primary is worsening
                      if (isWorsening && ctx.primaryWorseningChange) {
                        const ch = ctx.primaryWorseningChange;
                        const valueStr = `from ${ch.previousValue} to ${ch.currentValue} ${ch.unit}`;
                        return `${topName} ${dirLabel} and has worsened ${valueStr} since your last report — worth discussing with your provider.`;
                      }

                      // Force trajectory headline override if primary is stable abnormal
                      if (isStableAbnormal && ctx.primaryStableChange) {
                        const ch = ctx.primaryStableChange;
                        return `${topName} ${dirLabel} and has not changed significantly from the prior report (${ch.previousValue} to ${ch.currentValue} ${ch.unit}).`;
                      }

                      // If AI headline available and no trajectory override, use AI headline
                      if (interpretation?.headline) return interpretation.headline;

                      // Fallbacks if no AI headline
                      if (outOfRange.length === 0 && borderline.length === 0) {
                        if (ctx?.anyBoundaryCrossImproved) {
                          const name = insightSummary.biggestChanges.find(c => c.boundaryCrossing?.direction === 'improved')!.displayName;
                          return `All values are within optimal range, and ${name} has improved since your last draw.`;
                        }
                        return 'All measured values are within the Amani optimal range.';
                      }

                      if (outOfRange.length > 0 && borderline.length > 0 && secondName) {
                        return `${topName} is outside optimal range and ${secondName} is borderline. These are the two areas worth focusing on.`;
                      }
                      if (outOfRange.length >= 2 && secondName) {
                        return `${topName} and ${secondName} are both outside optimal range. These are your top priorities.`;
                      }
                      if (outOfRange.length === 1 && borderline.length === 0) {
                        if (ctx?.anyBoundaryCrossImproved) {
                          const name = insightSummary.biggestChanges.find(c => c.boundaryCrossing?.direction === 'improved')!.displayName;
                          return `${topName} is outside optimal range, though ${name} has improved since your last report.`;
                        }
                        return `${topName} is outside optimal range and is the primary finding on this panel.`;
                      }
                      if (borderline.length >= 2 && secondName) {
                        return `${topName} and ${secondName} are both borderline. Worth monitoring but no urgent flags.`;
                      }
                      return `${topName} is borderline. Worth keeping an eye on over time.`;
                    }
                    return interpretation?.headline || '';
                  })()}
                </h2>
              </div>

              {/* Top Priority — Deterministic direction override for all trajectory states */}
              {(() => {
                const ctx = insightSummary ? getOpeningContext(insightSummary) : null;
                const isImproving = ctx?.primaryIsImproving && ctx?.primaryImprovingChange !== null;
                const isWorsening = ctx?.primaryIsWorsening && ctx?.primaryWorseningChange !== null;
                const isStableAbnormal = ctx?.primaryIsStableAbnormal && ctx?.primaryStableChange !== null;

                // 1a. Deterministic Override — Improving
                if (isImproving && ctx.primaryImprovingChange && insightSummary?.primaryFinding) {
                  const ch = ctx.primaryImprovingChange;
                  const dirWord = insightSummary.primaryFinding.direction === 'high' ? 'elevated' : 'low';
                  return (
                    <div className="border-b border-theme-border-inner bg-theme-background-tint px-6 py-5">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 bg-emerald-500/15">
                          <AlertTriangle className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-extrabold uppercase tracking-[0.15em] mb-2 text-emerald-600">
                            Top Priority
                          </p>
                          <p className="text-base font-bold text-theme-text mb-2 leading-snug">
                            {interpretation?.primary_concern?.title || insightSummary.primaryFinding.displayName}
                          </p>
                          <p className="text-sm text-theme-text-body leading-relaxed">
                            {insightSummary.primaryFinding.displayName} remains {dirWord} at {insightSummary.primaryFinding.value} {insightSummary.primaryFinding.unit}, but has improved from {ch.previousValue} {ch.unit} since your last report
                            {ch.percentDelta !== null ? ` — a ${Math.abs(ch.percentDelta)}% improvement` : ''}.
                          </p>
                          <p className="text-xs text-emerald-700 leading-relaxed border-l-2 border-emerald-400/60 pl-3 mt-2.5">
                            This improvement is meaningful, even though the value remains outside the optimal range. Continue tracking at your next panel.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }

                // 1b. Deterministic Override — Worsening
                if (isWorsening && ctx.primaryWorseningChange && insightSummary?.primaryFinding) {
                  const ch = ctx.primaryWorseningChange;
                  const dirWord = insightSummary.primaryFinding.direction === 'high' ? 'elevated' : 'low';
                  const aiWhyItMatters = interpretation?.primary_concern?.why_it_matters;
                  return (
                    <div className="border-b border-theme-border-inner bg-theme-background-tint px-6 py-5">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 bg-amber-500/15">
                          <AlertTriangle className="w-5 h-5 text-amber-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-extrabold uppercase tracking-[0.15em] mb-2 text-amber-600">
                            Top Priority
                          </p>
                          <p className="text-base font-bold text-theme-text mb-2 leading-snug">
                            {interpretation?.primary_concern?.title || insightSummary.primaryFinding.displayName}
                          </p>
                          <p className="text-sm text-theme-text-body leading-relaxed">
                            {insightSummary.primaryFinding.displayName} remains {dirWord} and has worsened from {ch.previousValue} to {ch.currentValue} {ch.unit} since your last report{ch.percentDelta !== null ? ` (${ch.percentDelta > 0 ? '+' : ''}${ch.percentDelta}%)` : ''}.
                          </p>
                          {aiWhyItMatters ? (
                            <p className="text-xs text-theme-muted-text-2 leading-relaxed border-l-2 border-amber-400/60 pl-3 mt-2.5">
                              {aiWhyItMatters}
                            </p>
                          ) : (
                            <p className="text-xs text-amber-700 leading-relaxed border-l-2 border-amber-400/60 pl-3 mt-2.5">
                              This trend is worth discussing with your provider at your next visit.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // 1c. Deterministic Override — Stable Abnormal
                if (isStableAbnormal && ctx.primaryStableChange && insightSummary?.primaryFinding) {
                  const ch = ctx.primaryStableChange;
                  const dirWord = insightSummary.primaryFinding.direction === 'high' ? 'elevated' : 'low';
                  const aiWhyItMatters = interpretation?.primary_concern?.why_it_matters;
                  return (
                    <div className="border-b border-theme-border-inner bg-theme-background-tint px-6 py-5">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-theme-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle className="w-5 h-5 text-theme-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-extrabold text-theme-primary uppercase tracking-[0.15em] mb-2">
                            Top Priority
                          </p>
                          <p className="text-base font-bold text-theme-text mb-2 leading-snug">
                            {interpretation?.primary_concern?.title || insightSummary.primaryFinding.displayName}
                          </p>
                          <p className="text-sm text-theme-text-body leading-relaxed">
                            {insightSummary.primaryFinding.displayName} remains {dirWord} and has not changed significantly from the prior report ({ch.previousValue} to {ch.currentValue} {ch.unit}).
                          </p>
                          {aiWhyItMatters ? (
                            <p className="text-xs text-theme-muted-text-2 leading-relaxed border-l-2 border-theme-primary/40 pl-3 mt-2.5">
                              {aiWhyItMatters}
                            </p>
                          ) : (
                            <p className="text-xs text-theme-muted-text-2 leading-relaxed border-l-2 border-theme-primary/40 pl-3 mt-2.5">
                              Continued tracking at your next panel will help clarify whether this is a persistent pattern.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // 2. Standard AI Path
                if (interpretation?.primary_concern) {
                  return (
                    <div className="border-b border-theme-border-inner bg-theme-background-tint px-6 py-5">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-theme-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle className="w-5 h-5 text-theme-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-extrabold text-theme-primary uppercase tracking-[0.15em] mb-2">
                            Top Priority
                          </p>
                          <p className="text-base font-bold text-theme-text mb-2 leading-snug">
                            {interpretation.primary_concern.title}
                          </p>
                          <p className="text-sm text-theme-text-body leading-relaxed">
                            {interpretation.primary_concern.summary}
                          </p>
                          {interpretation.primary_concern.why_it_matters && (
                            <p className="text-xs text-theme-muted-text-2 leading-relaxed border-l-2 border-theme-primary/40 pl-3 mt-2.5">
                              {interpretation.primary_concern.why_it_matters}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // 3. Complete Fallback Path
                if (insightSummary?.primaryFinding) {
                  return (
                    <div className="border-b border-theme-border-inner bg-theme-background-tint px-6 py-5">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-theme-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle className="w-5 h-5 text-theme-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-extrabold text-theme-primary uppercase tracking-[0.15em] mb-2">
                            Top Priority
                          </p>
                          <p className="text-base font-bold text-theme-text mb-2 leading-snug">
                            {insightSummary.primaryFinding.displayName}
                          </p>
                          <p className="text-sm text-theme-text-body leading-relaxed">
                            {insightSummary.primaryFinding.fact}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }

                return null;
              })()}

              {/* Summary bullets: only when no primary_concern */}
              {interpretation && !interpretation.primary_concern && interpretation.summary_bullets.length > 0 && (
                <div className="bg-white px-6 py-5">
                  <ul className="space-y-3">
                    {interpretation.summary_bullets.map((bullet, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-theme-primary flex-shrink-0 mt-2" />
                        <p className="text-sm text-theme-text-body leading-relaxed">{bullet}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* What This Means — narrative, unified inside the card */}
              {insightSummary && (() => {
                const aiText = interpretation?.overall_interpretation;
                const topFindings = insightSummary.primaryFinding
                  ? [insightSummary.primaryFinding, ...insightSummary.topFindings]
                  : insightSummary.topFindings;

                const outOfRange = topFindings.filter(f => f.status === 'out_of_range');
                const borderline = topFindings.filter(f => f.status === 'borderline');
                const improved = insightSummary.biggestChanges.filter(c => c.boundaryCrossing?.direction === 'improved');
                const worsened = insightSummary.biggestChanges.filter(c => c.boundaryCrossing?.direction === 'worsened');
                const ctx = getOpeningContext(insightSummary);

                let fallback = '';
                const topName = outOfRange[0]?.displayName ?? borderline[0]?.displayName;
                if (outOfRange.length === 0 && borderline.length === 0) {
                  if (improved.length > 0) {
                    const names = improved.slice(0, 2).map(c => c.displayName).join(' and ');
                    fallback = `Your panel looks solid overall, with ${names} showing improvement since your last draw. The trend is moving in a positive direction.`;
                  } else {
                    fallback = `All measured values are within optimal ranges. This is a useful baseline to track over time.`;
                  }
                } else if (ctx.primaryIsImproving && ctx.primaryImprovingChange) {
                  const ch = ctx.primaryImprovingChange;
                  const dirLabel = insightSummary.primaryFinding?.direction === 'low' ? 'low' : 'elevated';
                  const pctStr = ch.percentDelta !== null ? ` — a ${Math.abs(ch.percentDelta)}% improvement` : '';
                  if (!ctx.anyWorsening) {
                    fallback = `${topName} remains ${dirLabel}, though it has come down from ${ch.previousValue} to ${ch.currentValue} ${ch.unit}${pctStr}. That movement is encouraging and worth continuing to track at your next panel.`;
                    if (borderline.length > 0 && borderline[0].displayName !== topName) {
                      fallback += ` ${borderline[0].displayName} is also borderline — worth monitoring but not urgent on its own.`;
                    }
                  } else {
                    const worsenedName = ctx.worseningChange?.displayName ?? worsened[0]?.displayName;
                    fallback = `${topName} has improved from ${ch.previousValue} to ${ch.currentValue} ${ch.unit}${pctStr}, which is a meaningful step in the right direction. At the same time, ${worsenedName ?? 'another marker'} has shifted since your last draw and deserves attention alongside it.`;
                  }
                } else if (improved.length > 0 && outOfRange.length > 0) {
                  fallback = `${topName} remains the primary area to keep an eye on, while ${improved[0].displayName} has shown improvement since your last report. The picture is mixed but moving in a constructive direction.`;
                } else if (worsened.length > 0 && outOfRange.length > 0) {
                  fallback = `${topName} is the priority finding here, and ${worsened[0].displayName} has shifted since your last draw. Tracking both at your next panel will help clarify the direction.`;
                } else if (outOfRange.length >= 2) {
                  const names = outOfRange.slice(0, 2).map(f => f.displayName).join(' and ');
                  fallback = `${names} are both outside optimal range and are the two findings most worth discussing with your provider.`;
                } else if (outOfRange.length === 1 && borderline.length > 0) {
                  fallback = `${topName} is outside optimal range and is the top priority. ${borderline[0].displayName} is borderline — worth monitoring, but not urgent on its own.`;
                } else if (outOfRange.length === 1) {
                  fallback = `${topName} is the standout finding in this report. The rest of the panel is within range, which provides helpful context for tracking over time.`;
                } else {
                  fallback = `${topName} is the primary item to keep an eye on. Continue tracking these markers to see how the trend develops.`;
                }

                const isImproving = ctx.primaryIsImproving && ctx.primaryImprovingChange !== null;
                const isWorsening = ctx.primaryIsWorsening && ctx.primaryWorseningChange !== null;
                const isStableAbnormal = ctx.primaryIsStableAbnormal && ctx.primaryStableChange !== null;
                let text = '';

                if (isImproving) {
                  text = fallback;
                } else if (isWorsening && ctx.primaryWorseningChange && insightSummary.primaryFinding) {
                  const ch = ctx.primaryWorseningChange;
                  const dirWord = insightSummary.primaryFinding.direction === 'high' ? 'elevated' : 'low';
                  const pctStr = ch.percentDelta !== null ? ` (${ch.percentDelta > 0 ? '+' : ''}${ch.percentDelta}%)` : '';
                  text = `${insightSummary.primaryFinding.displayName} remains ${dirWord} and has worsened from ${ch.previousValue} to ${ch.currentValue} ${ch.unit}${pctStr} since the prior report. This is worth discussing with your provider at your next visit.`;
                  if (borderline.length > 0 && borderline[0].displayName !== insightSummary.primaryFinding.displayName) {
                    text += ` ${borderline[0].displayName} is also borderline — worth monitoring alongside it.`;
                  }
                } else if (isStableAbnormal && ctx.primaryStableChange && insightSummary.primaryFinding) {
                  const ch = ctx.primaryStableChange;
                  const dirWord = insightSummary.primaryFinding.direction === 'high' ? 'elevated' : 'low';
                  text = `${insightSummary.primaryFinding.displayName} has remained ${dirWord} and has not changed significantly from the prior report (${ch.previousValue} to ${ch.currentValue} ${ch.unit}). Continued tracking is the right next step.`;
                } else {
                  // Use AI with fluff filtering
                  const rawText = aiText ?? fallback;
                  const headline = interpretation?.headline ?? '';
                  const normalizeForCompare = (s: string) =>
                    s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
                  const headlineNorm = normalizeForCompare(headline);

                  const splitSentences = (t: string): string[] =>
                    t.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()).filter(Boolean) ?? [t];

                  const FILLER_PATTERNS = [
                    /\bstand(s)? out as\b/i,
                    /\bmost abnormal\b/i,
                    /\bprimary (finding|concern|result)\b/i,
                  ];
                  const isFluff = (sentence: string): boolean =>
                    FILLER_PATTERNS.some(p => p.test(sentence)) &&
                    !/(direction|action|trend|monitor|track|discuss|follow|watch)/i.test(sentence);

                  const isDuplicateOfHeadline = (sentence: string): boolean => {
                    if (!headlineNorm) return false;
                    const sentNorm = normalizeForCompare(sentence);
                    const headlineWords = headlineNorm.split(' ').filter(w => w.length > 4);
                    if (headlineWords.length === 0) return false;
                    const matchCount = headlineWords.filter(w => sentNorm.includes(w)).length;
                    return matchCount / headlineWords.length >= 0.7;
                  };

                  const sentences = splitSentences(rawText);
                  const filtered = sentences.filter(s => !isDuplicateOfHeadline(s));
                  const strong = filtered.filter((s, i) => i === 0 || !isFluff(s));
                  const capped = strong.slice(0, 2).join(' ');
                  text = capped || rawText;
                }

                return (
                  <div className="border-t border-theme-border-inner bg-white px-6 py-5">
                    <p className="text-xs font-medium text-theme-muted-text-2 uppercase tracking-widest mb-3">
                      What This Means
                    </p>
                    <p className="text-[15px] text-theme-text-body leading-[1.7]">{text}</p>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── C2. Primary Finding (dominant single takeaway) ────── */}
          {insightSummary?.primaryFinding && !isProcessing && (
            <PrimaryInsightCard
              finding={insightSummary.primaryFinding}
              aiExplanation={
                interpretation?.key_findings?.find(
                  kf => kf.biomarker_slug === insightSummary.primaryFinding!.key
                )?.explanation
              }
              delta={
                insightSummary.biggestChanges.find(c => c.key === insightSummary.primaryFinding!.key) ??
                (() => {
                  const d = insightSummary.deltaMap.get(insightSummary.primaryFinding!.key);
                  if (!d) return null;
                  return {
                    key: d.key,
                    displayName: d.displayName,
                    previousValue: d.previousValue,
                    currentValue: d.currentValue,
                    unit: d.unit,
                    percentDelta: d.percentDelta,
                    trendDirection: d.trendDirection,
                    significance: d.significance,
                    boundaryCrossing: d.boundaryCrossing,
                    trajectoryStatus: d.trajectoryStatus,
                    distanceToNormalImprovement: d.distanceToNormalImprovement,
                    fact: '',
                  };
                })()
              }
            />
          )}

          {/* ── D. Top Findings (secondary items, softer tone) ────── */}
          {insightSummary && !isProcessing && insightSummary.topFindings.length > 0 && (
            <TopFindingsCard
              findings={insightSummary.topFindings}
              aiExplanations={
                interpretation?.key_findings
                  ? Object.fromEntries(
                      interpretation.key_findings.map(kf => [kf.biomarker_slug, kf.explanation])
                    )
                  : undefined
              }
              isPrimary={false}
            />
          )}

          {/* ── D2. Biggest Changes (vs previous report) ─────────── */}
          {insightSummary && !isProcessing && insightSummary.biggestChanges.length > 0 && (
            <BiggestChangesCard changes={insightSummary.biggestChanges} />
          )}

          {/* ── D3. Your Patterns (personalization) ─────────────── */}
          {personalInsights.length > 0 && !isProcessing && (
            <YourPatternsCard patterns={personalInsights} reportCount={historicalReportCount} />
          )}

          {/* ── D4. What to Watch ────────────────────────────────── */}
          {insightSummary && !isProcessing && insightSummary.watchSignals.length > 0 && (
            <WhatToWatchCard signals={insightSummary.watchSignals} />
          )}

          {/* ── C4. Next Steps ───────────────────────────────────── */}
          {interpretation && !isProcessing && (interpretation.what_you_can_do_now?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 overflow-hidden">
              <div className="px-5 py-4 border-b border-emerald-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Lightbulb className="w-4 h-4 text-emerald-700" />
                  </div>
                  <h2 className="text-sm font-bold text-emerald-900">Next Steps</h2>
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                {interpretation.what_you_can_do_now!.map((tip, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-emerald-800">{i + 1}</span>
                    </div>
                    <p className="text-sm text-emerald-900 leading-relaxed">{tip}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── E. More Details (Pattern Signals, Flags, Derived) ── */}
          {((interpretation?.pattern_signals?.length ?? 0) > 0 || insightFlags.length > 0 || derivedMetrics.length > 0) && (
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <button
                className="flex items-center justify-between w-full px-5 py-4 text-left bg-white hover:bg-gray-50 transition-colors"
                onClick={() => setShowMoreDetails(v => !v)}
              >
                <div className="flex items-center gap-2.5">
                  <Activity className="w-4 h-4 text-theme-muted-text-2" />
                  <span className="text-sm font-semibold text-theme-text">Patterns & Insights</span>
                  <span className="text-xs text-theme-muted-text-3">signals, flags, derived metrics</span>
                </div>
                {showMoreDetails
                  ? <ChevronDown className="w-4 h-4 text-gray-400" />
                  : <ChevronRight className="w-4 h-4 text-gray-400" />
                }
              </button>
              {showMoreDetails && (
                <div className="border-t border-gray-100 px-5 py-5 space-y-6">
                  {(interpretation?.pattern_signals?.length ?? 0) > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-theme-muted-text-3 uppercase tracking-widest">Pattern Signals</p>
                      {interpretation!.pattern_signals!.map((signal, i) => {
                        const style = PATTERN_CONFIDENCE_STYLE[signal.confidence] ?? PATTERN_CONFIDENCE_STYLE.low;
                        return (
                          <div key={i} className={`rounded-xl border p-4 ${style.bg} ${style.border}`}>
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <p className="text-sm font-semibold text-theme-text">{signal.title}</p>
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${style.bg} ${style.text} ${style.border}`}>
                                {style.label}
                              </span>
                            </div>
                            <p className={`text-xs leading-relaxed mb-2 ${style.text}`}>{signal.explanation}</p>
                            {signal.related_biomarkers?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {signal.related_biomarkers.map((slug, j) => (
                                  <span key={j} className="text-xs px-2 py-0.5 rounded-full bg-white/70 border border-gray-200 text-theme-muted-text-2">
                                    {BIOMARKER_DISPLAY[slug as BiomarkerName] ?? slug.replace(/_/g, ' ')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {insightFlags.length > 0 && <InsightFlagsPanel flags={insightFlags} />}
                  {derivedMetrics.length > 0 && <DerivedMetricsPanel metrics={derivedMetrics} />}
                </div>
              )}
            </div>
          )}

          {/* ── F. Full Lab Panel (accordion) ───────────────────── */}
          {totalAnalyteCount > 0 && (
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <button
                className="flex items-center justify-between w-full px-5 py-4 text-left bg-white hover:bg-gray-50 transition-colors"
                onClick={() => setShowFullPanel(v => !v)}
              >
                <div className="flex items-center gap-2.5">
                  <Microscope className="w-4 h-4 text-theme-muted-text-2" />
                  <span className="text-sm font-semibold text-theme-text">Full Lab Panel</span>
                  <span className="text-xs text-theme-muted-text-3">({totalAnalyteCount} items)</span>
                </div>
                {showFullPanel
                  ? <ChevronDown className="w-4 h-4 text-gray-400" />
                  : <ChevronRight className="w-4 h-4 text-gray-400" />
                }
              </button>
              {showFullPanel && (
                <div className="px-5 pb-5 pt-1 border-t border-gray-100 space-y-6">
                  {Object.entries(analytesForDisplay)
                    .sort(([a], [b]) => a === 'Unmapped' ? 1 : b === 'Unmapped' ? -1 : a.localeCompare(b))
                    .map(([cat, items]) => (
                      <div key={cat}>
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">{cat}</h3>
                        <div className="divide-y divide-gray-100">
                          {items.map(item => <AnalyteRow key={item.id} analyte={item} />)}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ── G. Recommended Labs (accordion — only when there are suggestions) */}
          {hasRecommendedLabs && (
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <button
                className="flex items-center justify-between w-full px-5 py-4 text-left bg-white hover:bg-gray-50 transition-colors"
                onClick={() => setShowRecommendedLabs(v => !v)}
              >
                <div className="flex items-center gap-2.5">
                  <Stethoscope className="w-4 h-4 text-theme-muted-text-2" />
                  <span className="text-sm font-semibold text-theme-text">Recommended Labs</span>
                </div>
                {showRecommendedLabs
                  ? <ChevronDown className="w-4 h-4 text-gray-400" />
                  : <ChevronRight className="w-4 h-4 text-gray-400" />
                }
              </button>
              {showRecommendedLabs && (
                <div className="border-t border-gray-100 px-5 pb-5 pt-3">
                  <RecommendedLabs presentBiomarkers={presentBiomarkerNames} activeCategory={activeCategory} />
                </div>
              )}
            </div>
          )}

          {/* ── Cycle context ─────────────────────────────────────── */}
          {!isProcessing && (() => {
            const aiCycle = interpretation?.cycle_context;
            const aiPhase = aiCycle?.estimated_cycle_phase;
            const reportPhase = report.estimated_cycle_phase;
            const resolvedPhase = (aiPhase && aiPhase !== 'unknown') ? aiPhase : (reportPhase && reportPhase !== 'unknown' ? reportPhase : null);
            if (!resolvedPhase) return null;
            return (
              <div className="rounded-2xl border border-theme-border-subtle bg-white px-5 py-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <CalendarDays className="w-4 h-4 text-theme-primary" />
                  <h3 className="text-sm font-semibold text-theme-text">Cycle Context</h3>
                  {aiCycle?.confidence && (
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border font-medium ${CONFIDENCE_STYLE[aiCycle.confidence]}`}>
                      {aiCycle.confidence} confidence
                    </span>
                  )}
                </div>
                <div className="flex gap-4 mb-3">
                  <div>
                    <p className="text-xs text-theme-muted-text-3">Phase</p>
                    <p className="text-sm font-semibold text-theme-text capitalize mt-0.5">
                      {resolvedPhase.replace(/_/g, ' ')}
                    </p>
                  </div>
                  {aiCycle?.estimated_cycle_day && (
                    <div>
                      <p className="text-xs text-theme-muted-text-3">Cycle Day</p>
                      <p className="text-sm font-semibold text-theme-text mt-0.5">{aiCycle.estimated_cycle_day}</p>
                    </div>
                  )}
                </div>
                {aiCycle?.explanation && (
                  <p className="text-xs text-theme-muted-text-2 leading-relaxed">{aiCycle.explanation}</p>
                )}
              </div>
            );
          })()}

          {/* ── Questions for Your Doctor (deterministic) ──────── */}
          {insightSummary && !isProcessing && insightSummary.questionsForDoctor.length > 0 && (
            <DoctorQuestionsCard questions={insightSummary.questionsForDoctor} />
          )}

          {/* ── Health Systems (drill-down to underlying biomarkers) ── */}
          {biomarkers.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-semibold text-theme-text">
                  Health Systems
                  {activeCategory && (
                    <span className="ml-2 text-sm font-normal text-theme-primary">
                      : {CATEGORY_DISPLAY[activeCategory].label}
                      <button onClick={() => setActiveCategory(null)} className="ml-2 underline text-xs">
                        clear
                      </button>
                    </span>
                  )}
                </h2>
                <span className="text-xs text-theme-muted-text-3">
                  {filteredCategories.reduce((a, g) => a + g.items.length, 0)} markers
                </span>
              </div>
              <p className="text-sm text-theme-muted-text-2 mb-4">
                Explore your results by body system when you want more detail.
              </p>

              {insightSummary && (
                <SystemSummaryCards
                  systems={insightSummary.systemSummaries}
                  activeCategory={activeCategory}
                  onCategoryClick={cat => setActiveCategory(prev => prev === cat ? null : cat)}
                />
              )}

              <div className="mt-5 space-y-2">
                {filteredCategories.map(({ category, items }) => {
                  const flaggedCount = items.filter(b => b.flagged === 'out_of_range' || b.flagged === 'borderline').length;
                  const isCollapsed = collapsedCategories.has(category);
                  const toggleCollapsed = () => {
                    setCollapsedCategories(prev => {
                      const next = new Set(prev);
                      if (next.has(category)) next.delete(category);
                      else next.add(category);
                      return next;
                    });
                  };
                  return (
                    <div key={category} className="rounded-xl border border-gray-200 overflow-hidden">
                      <button
                        onClick={toggleCollapsed}
                        className="flex items-center justify-between w-full px-4 py-3 text-left bg-white hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-semibold text-theme-text">
                            {CATEGORY_DISPLAY[category].label}
                          </span>
                          {flaggedCount > 0 && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              {flaggedCount} outside optimal
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-theme-muted-text-3">{items.length}</span>
                          {isCollapsed
                            ? <ChevronRight className="w-4 h-4 text-gray-400" />
                            : <ChevronDown className="w-4 h-4 text-gray-400" />
                          }
                        </div>
                      </button>
                      {!isCollapsed && (
                        <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-2">
                          {items.map(b => {
                            const interp = interpMap.get(b.name) ?? interpMap.get(b.name.replace(/_/g, ' '));
                            const personalization = biomarkerPersonalizationMap.get(b.name);
                            return (
                              <BiomarkerCard
                                key={b.id}
                                name={b.name as BiomarkerName}
                                value={b.value}
                                rawValueText={b.raw_value_text}
                                unit={b.unit}
                                labRefMin={b.reference_min}
                                labRefMax={b.reference_max}
                                cyclePhase={cyclePhase}
                                plainEnglishMeaning={interp?.plain_english_meaning}
                                timingNotes={interp?.timing_notes}
                                commonNonAlarmReasons={interp?.common_non_alarm_reasons}
                                whenCliniciansFollowUp={interp?.when_clinicians_follow_up}
                                baselineStatus={personalization?.baselineStatus}
                                baselineValue={personalization?.baselineValue}
                                trendDirection={personalization?.trendDirection}
                                trendStrength={personalization?.trendStrength}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── H. Disclaimer ───────────────────────────────────── */}
          {interpretation && (
            <div className="flex items-start gap-3 px-4 py-4">
              <Info className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-theme-muted-text-3 leading-relaxed italic">{interpretation.disclaimer}</p>
            </div>
          )}

        </div>
      </div>
    </Layout>
  );
}
