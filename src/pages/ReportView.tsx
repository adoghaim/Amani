import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
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
import type { PersonalPattern, SymptomLog, BaselineStatus, TrendDirection, TrendStrength } from '../types';
import type {
  LabReport, Biomarker, AIInterpretation, BiomarkerCategory,
  BiomarkerName, ReportAnalyte,
} from '../types';
import {
  RefreshCw, Trash2, AlertCircle, ChevronDown, ChevronRight,
  Microscope, Sparkles, Stethoscope, CalendarDays,
  CheckCircle2, Loader2, Info, Activity, Lightbulb, AlertTriangle, FlaskConical,
} from 'lucide-react';
import { detectLabSource } from '../utils/detectLabSource';
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

function normalizeInterpretation(raw: any): AIInterpretation {
  return {
    ...raw,
    headline: typeof raw.headline === 'string' ? raw.headline : '',
    summary_bullets: Array.isArray(raw.summary_bullets) ? raw.summary_bullets : [],
    primary_concern: raw.primary_concern && typeof raw.primary_concern === 'object'
      ? raw.primary_concern
      : undefined,
    key_findings: Array.isArray(raw.key_findings) ? raw.key_findings : undefined,
    what_you_can_do_now: Array.isArray(raw.what_you_can_do_now) ? raw.what_you_can_do_now : undefined,
    what_to_do_next: Array.isArray(raw.what_to_do_next) ? raw.what_to_do_next : undefined,
    top_findings: Array.isArray(raw.top_findings) ? raw.top_findings : [],
    pattern_signals: Array.isArray(raw.pattern_signals) ? raw.pattern_signals : [],
    questions_for_doctor: Array.isArray(raw.questions_for_doctor) ? raw.questions_for_doctor : [],
    disclaimer: typeof raw.disclaimer === 'string' ? raw.disclaimer : '',
    cycle_context: raw.cycle_context ?? {
      estimated_cycle_day: null,
      estimated_cycle_phase: 'unknown',
      confidence: 'low',
      explanation: '',
    },
    safety_notes: Array.isArray(raw.safety_notes) ? raw.safety_notes : [],
    suggested_followups_to_discuss: Array.isArray(raw.suggested_followups_to_discuss)
      ? raw.suggested_followups_to_discuss
      : raw.suggested_followups_to_discuss
        ? [raw.suggested_followups_to_discuss as unknown as string]
        : [],
  };
}

export function ReportView() {
  const { id: reportId = '' } = useParams<{ id: string }>();
  const { userProfile } = useAuth();
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
        return;
      }
      if (elapsed >= TIMEOUT_MS) {
        clearInterval(interval);
        // Edge function likely timed out — set ready so report is still viewable
        await supabase.from('lab_reports').update({ status: 'ready' }).eq('id', reportId);
        fetchReport();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [report?.status, reportId]);

  useEffect(() => {
    if (!report || report.status !== 'ready' || interpretation !== null || loading) return;
    if (interpPollingActive.current) return;
    interpPollingActive.current = true;
    let elapsed = 0;
    const POLL_INTERVAL = 3000;
    const TIMEOUT_MS = 60000;
    const interval = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      const { data } = await supabase
        .from('interpretations')
        .select('id, json_output')
        .eq('lab_report_id', reportId)
        .maybeSingle();
      if (data?.json_output) {
        clearInterval(interval);
        interpPollingActive.current = false;
        setInterpretation(normalizeInterpretation(data.json_output));
        return;
      }
      if (elapsed >= TIMEOUT_MS) {
        clearInterval(interval);
        interpPollingActive.current = false;
        // Guarded one-time retry: interpretation still missing after 60s
        // This handles cases where the initial invocation was dropped silently
        if (!interpRetryFired.current) {
          interpRetryFired.current = true;
          console.log('[ReportView] Interpretation missing after timeout — checking before retry');
          // Pre-retry existence check: only invoke if interpretation truly does not exist.
          // Without this, retry would re-set status to 'processing' on a report that
          // already has (or is about to have) an interpretation, causing a UX regression.
          (async () => {
            try {
              const { data: preRetryData } = await supabase
                .from('interpretations')
                .select('id, json_output')
                .eq('lab_report_id', reportId)
                .maybeSingle();
              if (preRetryData?.json_output) {
                console.log('[ReportView] Interpretation found before retry — skipping invoke');
                setInterpretation(normalizeInterpretation(preRetryData.json_output));
                return;
              }
              console.log('[ReportView] Interpretation confirmed missing — firing retry');
              const { error: retryErr } = await supabase.functions.invoke('generate-interpretation', {
                body: { reportId },
              });
              if (retryErr) {
                console.warn('[ReportView] Retry interpretation failed:', retryErr.message);
                return;
              }
              let retryElapsed = 0;
              const RETRY_INTERVAL = 4000;
              const RETRY_TIMEOUT = 60000;
              const retryInterval = setInterval(async () => {
                retryElapsed += RETRY_INTERVAL;
                const { data: retryData } = await supabase
                  .from('interpretations')
                  .select('id, json_output')
                  .eq('lab_report_id', reportId)
                  .maybeSingle();
                if (retryData?.json_output) {
                  clearInterval(retryInterval);
                  setInterpretation(normalizeInterpretation(retryData.json_output));
                } else if (retryElapsed >= RETRY_TIMEOUT) {
                  clearInterval(retryInterval);
                  console.warn('[ReportView] Retry interpretation also did not produce a result.');
                }
              }, RETRY_INTERVAL);
            } catch (e) {
              console.error('[ReportView] Retry flow exception:', e);
            }
          })();
        }
      }
    }, POLL_INTERVAL);
    return () => {
      clearInterval(interval);
      interpPollingActive.current = false;
    };
  }, [report?.status, report?.id, interpretation, loading, reportId]);

  const fetchReport = async () => {
    const { data: reportData, error: reportError } = await supabase
      .from('lab_reports').select('*').eq('id', reportId).maybeSingle();
    if (reportError) { setError(`Failed to load: ${reportError.message}`); setLoading(false); return; }
    if (!reportData) { setError('Report not found'); setLoading(false); return; }
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
          .neq('id', reportId)
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

    setLoading(false);
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
    const toCollapse = new Set<BiomarkerCategory>();
    for (const cat of CATEGORY_ORDER) {
      const items = sortedGroupedBiomarkers[cat];
      if (!items || items.length === 0) continue;
      const hasFlagged = items.some(b => b.flagged === 'out_of_range' || b.flagged === 'borderline');
      if (!hasFlagged) toCollapse.add(cat);
    }
    setCollapsedCategories(toCollapse);
    setCategoriesInitialized(true);
  }, [biomarkers, sortedGroupedBiomarkers, categoriesInitialized]);

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
    } catch (err: any) {
      await supabase.from('lab_reports').update({ status: 'error' }).eq('id', reportId);
      await fetchReport();
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    const { error } = await supabase.from('lab_reports').delete().eq('id', reportId);
    if (!error) window.location.href = '/app';
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
          <a href="/app"><Button>Back to Dashboard</Button></a>
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
              Lab Report — {formatDate(report.report_date)}
            </h1>
            <p className="text-sm text-theme-muted-text-3 mt-1">Uploaded {formatDate(report.upload_date)}</p>
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
                    ? 'text-sky-700 bg-sky-50 border-sky-200'
                    : 'text-emerald-700 bg-emerald-50 border-emerald-200'
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
          {hasError && !interpretation && (() => {
            const hasData = biomarkers.length > 0 || reportAnalytes.length > 0;
            const reason = !hasData
              ? 'No lab values were extracted — the PDF may be image-based.'
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
                    <span>{reportAnalytes.length || biomarkers.length} lab values detected — your data is intact below</span>
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

          {/* ── AI loading indicator (ready but no interpretation yet) ─── */}
          {report.status === 'ready' && !interpretation && !isProcessing && insightSummary && (
            <div className="rounded-2xl border border-theme-border-subtle bg-white px-6 py-4 flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-theme-primary animate-spin flex-shrink-0" />
              <p className="text-sm text-theme-muted-text-2">AI summary is being generated — your lab data is ready below.</p>
            </div>
          )}

          {/* ── B. Amani Summary ────────────────────────────────── */}
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
                  {insightSummary
                    ? (() => {
                        const findings = insightSummary.topFindings;
                        const outsideCount = findings.filter(f => f.status === 'out_of_range').length;
                        const borderlineCount = findings.filter(f => f.status === 'borderline').length;
                        const topOutside = findings.find(f => f.status === 'out_of_range');
                        const topBorderline = findings.find(f => f.status === 'borderline');

                        if (outsideCount === 0 && borderlineCount === 0) {
                          return 'All measured values are within the Amani optimal range.';
                        }
                        if (outsideCount > 0 && borderlineCount > 0) {
                          const name = topOutside?.displayName;
                          return `${outsideCount} value${outsideCount !== 1 ? 's' : ''} outside optimal range, ${borderlineCount} borderline${name ? ` — ${name} is the top priority` : ''}.`;
                        }
                        if (outsideCount > 0) {
                          const name = topOutside?.displayName;
                          return `${outsideCount} value${outsideCount !== 1 ? 's' : ''} outside optimal range${name ? ` — ${name} is the top priority` : ''}.`;
                        }
                        const name = topBorderline?.displayName;
                        return `${borderlineCount} borderline value${borderlineCount !== 1 ? 's' : ''} flagged${name ? ` — ${name} needs attention` : ''}.`;
                      })()
                    : (interpretation?.headline ?? '')}
                </h2>
              </div>

              {/* Primary Concern — most important finding, always first */}
              {interpretation?.primary_concern && (
                <div className="border-b border-theme-border-inner bg-theme-background-tint px-6 py-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-theme-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <AlertTriangle className="w-4 h-4 text-theme-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-theme-primary uppercase tracking-widest mb-1">
                        Top Priority
                      </p>
                      <p className="text-sm font-semibold text-theme-text mb-1.5">
                        {interpretation.primary_concern.title}
                      </p>
                      <p className="text-sm text-theme-text-body leading-relaxed mb-2">
                        {interpretation.primary_concern.summary}
                      </p>
                      {interpretation.primary_concern.why_it_matters && (
                        <p className="text-xs text-theme-muted-text-2 leading-relaxed border-l-2 border-theme-primary/30 pl-3">
                          {interpretation.primary_concern.why_it_matters}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Summary bullets: show when no primary_concern (from AI) or when no AI interpretation at all */}
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
            </div>
          )}

          {/* ── B2. Your Patterns (personalization) ─────────────── */}
          {personalInsights.length > 0 && !isProcessing && (
            <YourPatternsCard patterns={personalInsights} reportCount={historicalReportCount} />
          )}

          {/* ── C. Top Findings (deterministic) ─────────────────── */}
          {insightSummary && !isProcessing && (
            <TopFindingsCard findings={insightSummary.topFindings} />
          )}

          {/* ── C2. Biggest Changes (vs previous report) ─────────── */}
          {insightSummary && !isProcessing && insightSummary.biggestChanges.length > 0 && (
            <BiggestChangesCard changes={insightSummary.biggestChanges} />
          )}

          {/* ── C3. What to Watch (deterministic signals) ────────── */}
          {insightSummary && !isProcessing && insightSummary.watchSignals.length > 0 && (
            <WhatToWatchCard signals={insightSummary.watchSignals} />
          )}

          {/* ── C4. What You Can Do Now ──────────────────────────── */}
          {interpretation && !isProcessing && (interpretation.what_you_can_do_now?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 overflow-hidden">
              <div className="px-5 py-4 border-b border-emerald-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Lightbulb className="w-4 h-4 text-emerald-700" />
                  </div>
                  <h2 className="text-sm font-bold text-emerald-900">What You Can Do Now</h2>
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

          {/* ── D. Core Biomarkers ──────────────────────────────── */}
          {biomarkers.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-theme-text">
                  Your Lab Results
                  {activeCategory && (
                    <span className="ml-2 text-sm font-normal text-theme-primary">
                      — {CATEGORY_DISPLAY[activeCategory].label}
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
