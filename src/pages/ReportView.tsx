import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BiomarkerSystemDashboard } from '../components/BiomarkerSystemDashboard';
import { BiomarkerCard } from '../components/BiomarkerCard';
import { DerivedMetricsPanel } from '../components/DerivedMetricsPanel';
import { InsightFlagsPanel } from '../components/InsightFlagsPanel';
import { QuickHighlights } from '../components/QuickHighlights';
import { RecommendedLabs } from '../components/RecommendedLabs';
import { computeDerivedMetrics, evaluateInsightRules } from '../utils/derivedMetrics';
import { BIOMARKER_CATEGORY_MAP, BIOMARKER_DISPLAY } from '../utils/biomarkerDefinitions';
import { classifyLabValue } from '../utils/classifyLabValue';
import { CATEGORY_DISPLAY } from '../types';
import type {
  LabReport, Biomarker, AIInterpretation, BiomarkerCategory,
  BiomarkerName, ReportAnalyte,
} from '../types';
import {
  RefreshCw, Trash2, Copy, AlertCircle, ChevronDown, ChevronRight,
  Microscope, Sparkles, Stethoscope, CalendarDays, MessageSquare,
  CheckCircle2, Loader2, Info, Activity,
} from 'lucide-react';

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
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{analyte.raw_name}</p>
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
  const [showRecommendedLabs, setShowRecommendedLabs] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { fetchReport(); }, [reportId]);

  useEffect(() => {
    if (!report || report.status !== 'processing') return;
    let elapsed = 0;
    const POLL_INTERVAL = 3000;
    const TIMEOUT_MS = 35000;
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
        await supabase.from('lab_reports').update({ status: 'error' }).eq('id', reportId);
        fetchReport();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [report?.status, reportId]);

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
    setLoading(false);
  };

  const derivedMetrics = useMemo(() => computeDerivedMetrics(biomarkers), [biomarkers]);
  const insightFlags = useMemo(
    () => evaluateInsightRules(biomarkers, report?.estimated_cycle_phase),
    [biomarkers, report]
  );

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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

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

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">

        {/* ── A. Header ──────────────────────────────────────────── */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#2A1F23] tracking-tight">
              Lab Report — {formatDate(report.report_date)}
            </h1>
            <p className="text-sm text-[#9A8A90] mt-1">Uploaded {formatDate(report.upload_date)}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {cyclePhase && (
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 capitalize">
                  {cyclePhase.replace(/_/g, ' ')} phase
                </span>
              )}
              <span className="text-xs text-[#9A8A90]">{biomarkers.length} core biomarkers</span>
              {reportAnalytes.length > 0 && (
                <span className="text-xs text-[#9A8A90]">{reportAnalytes.length} total analytes</span>
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
            <div className="rounded-2xl border border-[#e8dce0] bg-white px-6 py-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#C97C8B]/10 flex items-center justify-center flex-shrink-0">
                <Loader2 className="w-5 h-5 text-[#C97C8B] animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#2A1F23]">Generating your analysis</p>
                <p className="text-xs text-[#9A8A90] mt-0.5">This usually takes 15–30 seconds.</p>
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

          {/* ── B. Amani Summary ────────────────────────────────── */}
          {interpretation && !isProcessing && (
            <div className="rounded-2xl overflow-hidden border border-[#e8dce0] shadow-sm">
              <div className="bg-[#2A1F23] px-6 py-5">
                <div className="flex items-center gap-2.5 mb-2">
                  <Sparkles className="w-4 h-4 text-[#E8B4BD]" />
                  <span className="text-xs font-medium text-[#c4adb2] uppercase tracking-widest">Amani Analysis</span>
                </div>
                {interpretation.headline && (
                  <h2 className="text-lg font-semibold text-white leading-snug">
                    {interpretation.headline}
                  </h2>
                )}
              </div>
              <div className="bg-white px-6 py-5">
                {interpretation.summary_bullets.length > 0 && (
                  <ul className="space-y-3">
                    {interpretation.summary_bullets.map((bullet, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C97C8B] flex-shrink-0 mt-2" />
                        <p className="text-sm text-[#4A3A40] leading-relaxed">{bullet}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ── C. Focus Now (top findings) ─────────────────────── */}
          {(interpretation?.top_findings?.length || 0) > 0 || biomarkers.length > 0 ? (
            <QuickHighlights
              biomarkers={biomarkers.map(b => ({
                name: b.name,
                value: b.value,
                unit: b.unit,
                labRefMin: b.reference_min,
                labRefMax: b.reference_max,
              }))}
              cyclePhase={cyclePhase}
              topFindings={interpretation?.top_findings}
            />
          ) : null}

          {/* ── D. Pattern Signals ──────────────────────────────── */}
          {(interpretation?.pattern_signals?.length ?? 0) > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-[#2A1F23]" />
                <h2 className="text-base font-semibold text-[#2A1F23]">Pattern Signals</h2>
              </div>
              <div className="space-y-3">
                {interpretation!.pattern_signals!.map((signal, i) => {
                  const style = PATTERN_CONFIDENCE_STYLE[signal.confidence] ?? PATTERN_CONFIDENCE_STYLE.low;
                  return (
                    <div key={i} className={`rounded-xl border p-4 ${style.bg} ${style.border}`}>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <p className="text-sm font-semibold text-[#2A1F23]">{signal.title}</p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${style.bg} ${style.text} ${style.border}`}>
                          {style.label}
                        </span>
                      </div>
                      <p className={`text-xs leading-relaxed mb-2 ${style.text}`}>{signal.explanation}</p>
                      {signal.related_biomarkers?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {signal.related_biomarkers.map((slug, j) => (
                            <span key={j} className="text-xs px-2 py-0.5 rounded-full bg-white/70 border border-gray-200 text-[#7A6570]">
                              {BIOMARKER_DISPLAY[slug as BiomarkerName] ?? slug.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rule-based flags (always shown if present) */}
          {insightFlags.length > 0 && <InsightFlagsPanel flags={insightFlags} />}

          {/* ── E. Core Biomarkers ──────────────────────────────── */}
          {biomarkers.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-semibold text-[#2A1F23]">
                  Core Biomarkers
                  {activeCategory && (
                    <span className="ml-2 text-sm font-normal text-[#C97C8B]">
                      — {CATEGORY_DISPLAY[activeCategory].label}
                      <button onClick={() => setActiveCategory(null)} className="ml-2 underline text-xs">
                        clear
                      </button>
                    </span>
                  )}
                </h2>
                <span className="text-xs text-[#9A8A90]">
                  {filteredCategories.reduce((a, g) => a + g.items.length, 0)} markers
                </span>
              </div>

              <BiomarkerSystemDashboard
                biomarkers={biomarkers}
                cyclePhase={cyclePhase}
                onCategoryClick={cat => setActiveCategory(prev => prev === cat ? null : cat)}
                activeCategory={activeCategory}
              />

              <div className="mt-6 space-y-8">
                {filteredCategories.map(({ category, items }) => (
                  <div key={category}>
                    <h3 className="text-xs font-bold text-[#9A8A90] uppercase tracking-widest mb-3">
                      {CATEGORY_DISPLAY[category].label}
                    </h3>
                    <div className="space-y-2">
                      {items.map(b => {
                        const interp = interpMap.get(b.name) ?? interpMap.get(b.name.replace(/_/g, ' '));
                        return (
                          <BiomarkerCard
                            key={b.id}
                            name={b.name}
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
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Derived metrics */}
          {derivedMetrics.length > 0 && <DerivedMetricsPanel metrics={derivedMetrics} />}

          {/* ── F. Full Lab Panel (accordion) ───────────────────── */}
          {totalAnalyteCount > 0 && (
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <button
                className="flex items-center justify-between w-full px-5 py-4 text-left bg-white hover:bg-gray-50 transition-colors"
                onClick={() => setShowFullPanel(v => !v)}
              >
                <div className="flex items-center gap-2.5">
                  <Microscope className="w-4 h-4 text-[#7A6570]" />
                  <span className="text-sm font-semibold text-[#2A1F23]">Full Lab Panel</span>
                  <span className="text-xs text-[#9A8A90]">({totalAnalyteCount} items)</span>
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

          {/* ── G. Recommended Labs (accordion) ─────────────────── */}
          <div className="rounded-2xl border border-gray-200 overflow-hidden">
            <button
              className="flex items-center justify-between w-full px-5 py-4 text-left bg-white hover:bg-gray-50 transition-colors"
              onClick={() => setShowRecommendedLabs(v => !v)}
            >
              <div className="flex items-center gap-2.5">
                <Stethoscope className="w-4 h-4 text-[#7A6570]" />
                <span className="text-sm font-semibold text-[#2A1F23]">Recommended Labs</span>
              </div>
              {showRecommendedLabs
                ? <ChevronDown className="w-4 h-4 text-gray-400" />
                : <ChevronRight className="w-4 h-4 text-gray-400" />
              }
            </button>
            {showRecommendedLabs && (
              <div className="border-t border-gray-100">
                <RecommendedLabs presentBiomarkers={presentBiomarkerNames} activeCategory={activeCategory} />
              </div>
            )}
          </div>

          {/* ── Cycle context + Questions for doctor ─────────────── */}
          {interpretation && !isProcessing && (
            <>
              {interpretation.cycle_context && interpretation.cycle_context.estimated_cycle_phase !== 'unknown' && (
                <div className="rounded-2xl border border-[#e8dce0] bg-white px-5 py-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <CalendarDays className="w-4 h-4 text-[#C97C8B]" />
                    <h3 className="text-sm font-semibold text-[#2A1F23]">Cycle Context</h3>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border font-medium ${CONFIDENCE_STYLE[interpretation.cycle_context.confidence]}`}>
                      {interpretation.cycle_context.confidence} confidence
                    </span>
                  </div>
                  <div className="flex gap-4 mb-3">
                    <div>
                      <p className="text-xs text-[#9A8A90]">Phase</p>
                      <p className="text-sm font-semibold text-[#2A1F23] capitalize mt-0.5">
                        {interpretation.cycle_context.estimated_cycle_phase.replace(/_/g, ' ')}
                      </p>
                    </div>
                    {interpretation.cycle_context.estimated_cycle_day && (
                      <div>
                        <p className="text-xs text-[#9A8A90]">Cycle Day</p>
                        <p className="text-sm font-semibold text-[#2A1F23] mt-0.5">{interpretation.cycle_context.estimated_cycle_day}</p>
                      </div>
                    )}
                  </div>
                  {interpretation.cycle_context.explanation && (
                    <p className="text-xs text-[#7A6570] leading-relaxed">{interpretation.cycle_context.explanation}</p>
                  )}
                </div>
              )}

              {interpretation.questions_for_doctor.length > 0 && (
                <div className="rounded-2xl border border-[#e8dce0] bg-white px-5 py-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <MessageSquare className="w-4 h-4 text-[#C97C8B]" />
                      <h3 className="text-sm font-semibold text-[#2A1F23]">Questions for Your Doctor</h3>
                    </div>
                    <button
                      onClick={() => copyToClipboard(interpretation.questions_for_doctor.join('\n'))}
                      className="flex items-center gap-1.5 text-xs text-[#C97C8B] hover:text-[#a05a6a] font-medium transition-colors"
                    >
                      {copied ? (
                        <><CheckCircle2 className="w-3.5 h-3.5" /> Copied</>
                      ) : (
                        <><Copy className="w-3.5 h-3.5" /> Copy all</>
                      )}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {interpretation.questions_for_doctor.map((q, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50">
                        <span className="text-xs font-bold text-[#C97C8B] bg-[#C97C8B]/10 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-sm text-[#4A3A40] leading-relaxed">{q}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── H. Disclaimer ───────────────────────────────────── */}
          {interpretation && (
            <div className="flex items-start gap-3 px-4 py-4">
              <Info className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#9A8A90] leading-relaxed italic">{interpretation.disclaimer}</p>
            </div>
          )}

        </div>
      </div>
    </Layout>
  );
}
