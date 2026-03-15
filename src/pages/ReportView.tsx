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
import type { LabReport, Biomarker, AIInterpretation, BiomarkerCategory, BiomarkerName, ReportAnalyte } from '../types';
import {
  RefreshCw, Trash2, Copy, Clock, AlertCircle, ChevronDown, ChevronRight,
  Microscope, Sparkles, Heart, Leaf, Moon, Stethoscope, CalendarDays,
  MessageSquare, ArrowRight, CheckCircle2, Loader2, Info, FlaskConical
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

const STATUS_ICON_STYLE: Record<string, { bg: string; border: string; dot: string; badge: string; badgeText: string }> = {
  in_range:    { bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500', badge: 'bg-emerald-100', badgeText: 'text-emerald-700' },
  out_of_range:{ bg: 'bg-red-50',     border: 'border-red-200',     dot: 'bg-red-500',     badge: 'bg-red-100',     badgeText: 'text-red-700' },
  borderline:  { bg: 'bg-amber-50',   border: 'border-amber-200',   dot: 'bg-amber-400',   badge: 'bg-amber-100',   badgeText: 'text-amber-700' },
  unknown:     { bg: 'bg-gray-50',    border: 'border-gray-200',    dot: 'bg-gray-400',    badge: 'bg-gray-100',    badgeText: 'text-gray-500' },
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
        <div className="flex items-center gap-2 mt-0.5">
          {analyte.raw_reference_range && (
            <p className="text-xs text-gray-400">Ref: {analyte.raw_reference_range}</p>
          )}
          {analyte.parse_status === 'unmapped' && (
            <span className="text-xs text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">needs review</span>
          )}
        </div>
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

function SummaryBullet({ text, index }: { text: string; index: number }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="w-6 h-6 rounded-full bg-[#C97C8B]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-xs font-bold text-[#C97C8B]">{index + 1}</span>
      </div>
      <p className="text-gray-700 leading-relaxed text-sm">{text}</p>
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="w-9 h-9 rounded-xl bg-[#C97C8B]/10 flex items-center justify-center flex-shrink-0">
        <div className="text-[#C97C8B]">{icon}</div>
      </div>
      <div>
        <h2 className="text-base font-semibold text-[#2A1F23]">{title}</h2>
        {subtitle && <p className="text-xs text-[#7A6570] mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function CycleContextCard({ ctx }: { ctx: AIInterpretation['cycle_context'] }) {
  const confColor = ctx.confidence === 'high' ? 'text-emerald-600 bg-emerald-50' :
    ctx.confidence === 'medium' ? 'text-amber-600 bg-amber-50' : 'text-gray-500 bg-gray-100';

  const phaseColors: Record<string, string> = {
    menstrual: 'from-red-50 to-rose-50 border-red-100',
    follicular: 'from-sky-50 to-blue-50 border-sky-100',
    ovulatory: 'from-yellow-50 to-amber-50 border-yellow-100',
    luteal: 'from-violet-50 to-purple-50 border-[#e0d5f5]',
    unknown: 'from-gray-50 to-slate-50 border-gray-100',
  };
  const gradClass = phaseColors[ctx.estimated_cycle_phase] ?? phaseColors.unknown;

  return (
    <Card>
      <SectionHeader icon={<CalendarDays className="w-4 h-4" />} title="Cycle Context" subtitle="How your cycle may influence these results" />
      <div className={`rounded-xl bg-gradient-to-br ${gradClass} border p-4 mb-4`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Phase</p>
            <p className="font-semibold text-gray-800 capitalize">{ctx.estimated_cycle_phase.replace(/_/g, ' ')}</p>
          </div>
          {ctx.estimated_cycle_day && (
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Cycle Day</p>
              <p className="font-semibold text-gray-800">{ctx.estimated_cycle_day}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Confidence</p>
            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${confColor}`}>
              {ctx.confidence}
            </span>
          </div>
        </div>
      </div>
      <p className="text-sm text-gray-600 leading-relaxed">{ctx.explanation}</p>
    </Card>
  );
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
  const [showExtended, setShowExtended] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchReport();
  }, [reportId]);

  useEffect(() => {
    if (!report || report.status !== 'processing') return;
    let elapsed = 0;
    const POLL_INTERVAL = 3000;
    const TIMEOUT_MS = 120000;

    const interval = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      const { data } = await supabase
        .from('lab_reports')
        .select('status')
        .eq('id', reportId)
        .maybeSingle();
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
      .from('lab_reports')
      .select('*')
      .eq('id', reportId)
      .maybeSingle();

    if (reportError) {
      setError(`Failed to load report: ${reportError.message}`);
      setLoading(false);
      return;
    }
    if (!reportData) {
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
    if (interpretationData) setInterpretation(interpretationData.json_output as AIInterpretation);

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

  const interpMap = useMemo(() => {
    if (!interpretation) return new Map<string, AIInterpretation['biomarkers'][number]>();
    return new Map(interpretation.biomarkers.map(b => [b.name, b]));
  }, [interpretation]);

  const filteredCategories = useMemo(() => {
    if (activeCategory) {
      const items = groupedBiomarkers[activeCategory];
      if (!items) return [];
      return [{ category: activeCategory, items }];
    }
    return CATEGORY_ORDER
      .map(cat => ({ category: cat, items: groupedBiomarkers[cat] ?? [] }))
      .filter(g => g.items.length > 0);
  }, [groupedBiomarkers, activeCategory]);

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
      supabase.functions.invoke('generate-interpretation', { body: { reportId } })
        .then(({ data: interpData, error: interpError }) => {
          if (interpError) {
            console.error('[ReportView] edge function returned error', interpError, interpData);
          }
          fetchReport();
        })
        .catch((err) => {
          console.error('[ReportView] generate-interpretation network error:', err);
          fetchReport();
        });
      await fetchReport();
      setRegenerating(false);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to regenerate report');
      setRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this report? This cannot be undone.')) return;
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
      const daysSinceStart = Math.floor((Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
      return daysSinceStart < 7;
    }
    return false;
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#C97C8B]" />
        </div>
      </Layout>
    );
  }

  if (!report) {
    return (
      <Layout>
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Report not found</h1>
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
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#2A1F23] mb-1">
              Lab Report — {formatDate(report.report_date)}
            </h1>
            <p className="text-sm text-[#7A6570]">Uploaded {formatDate(report.upload_date)}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {cyclePhase && (
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 capitalize">
                  {cyclePhase.replace(/_/g, ' ')} phase
                </span>
              )}
              <span className="text-xs text-gray-500">{biomarkers.length} core biomarkers</span>
              {reportAnalytes.length > 0 && (
                <span className="text-xs text-blue-500">{reportAnalytes.length} total analytes</span>
              )}
              {reportAnalytes.filter(a => a.parse_status === 'unmapped').length > 0 && (
                <span className="text-xs text-amber-500">
                  {reportAnalytes.filter(a => a.parse_status === 'unmapped').length} need review
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {canRegenerate && (
              <Button variant="secondary" size="sm" onClick={handleRegenerate} disabled={regenerating}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Regenerate ({3 - report.regeneration_count} left)
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={handleDelete}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6">
            {error}
          </div>
        )}

        <div className="space-y-6">

          {/* AI Summary — processing state */}
          {isProcessing && (
            <Card>
              <div className="flex items-center gap-4 py-2">
                <div className="w-10 h-10 rounded-xl bg-[#C97C8B]/10 flex items-center justify-center flex-shrink-0">
                  <Loader2 className="w-5 h-5 text-[#C97C8B] animate-spin" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#2A1F23]">Generating your AI analysis</h2>
                  <p className="text-sm text-[#7A6570] mt-0.5">This usually takes 15–30 seconds. Your lab data is shown below.</p>
                </div>
              </div>
              <div className="mt-4 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#C97C8B] rounded-full animate-pulse" style={{ width: '60%' }} />
              </div>
            </Card>
          )}

          {/* AI Summary — error state (no interpretation) */}
          {hasError && !interpretation && (() => {
            const hasData = biomarkers.length > 0 || reportAnalytes.length > 0;
            const likelyReason = !hasData
              ? { label: 'No lab values were extracted from this file', detail: 'The PDF may be image-based or scanned. Text-based PDFs work best. You can delete this report and re-upload a cleaner copy, or enter values manually.' }
              : { label: 'The AI analysis timed out or hit an error', detail: 'Your lab data was parsed successfully — this was a server-side issue with the summary generation. Retrying usually fixes it.' };
            return (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-red-900">AI summary failed</p>
                    <p className="text-sm text-red-700 mt-0.5">{likelyReason.label}</p>
                    <p className="text-xs text-red-600 mt-1.5 leading-relaxed">{likelyReason.detail}</p>
                  </div>
                </div>
                {hasData && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-100/60 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <span>{reportAnalytes.length > 0 ? reportAnalytes.length : biomarkers.length} lab values detected — your data is intact below</span>
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
                  <p className="text-xs text-red-600">All 3 retry attempts used. Your lab data is fully visible below.</p>
                )}
              </div>
            );
          })()}

          {/* AI Summary — ready */}
          {interpretation && !isProcessing && (
            <div className="rounded-2xl overflow-hidden border border-[#e8dce0] shadow-sm">
              {/* Summary header */}
              <div className="bg-gradient-to-r from-[#2A1F23] to-[#4a3040] px-6 py-5">
                <div className="flex items-center gap-3 mb-1">
                  <Sparkles className="w-5 h-5 text-[#E8B4BD]" />
                  <h2 className="text-lg font-semibold text-white">AI Summary</h2>
                </div>
                <p className="text-[#c4adb2] text-xs">Educational interpretation — not medical advice</p>
              </div>

              {/* Summary bullets */}
              <div className="bg-white px-6 py-5">
                <div className="space-y-3">
                  {interpretation.summary_bullets.map((bullet, i) => (
                    <SummaryBullet key={i} text={bullet} index={i} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quick highlights + System dashboard */}
          {biomarkers.length > 0 && (
            <QuickHighlights
              biomarkers={biomarkers.map(b => ({
                name: b.name,
                value: b.value,
                unit: b.unit,
                labRefMin: b.reference_min,
                labRefMax: b.reference_max,
              }))}
              cyclePhase={cyclePhase}
            />
          )}

          {biomarkers.length > 0 && (
            <BiomarkerSystemDashboard
              biomarkers={biomarkers}
              cyclePhase={cyclePhase}
              onCategoryClick={cat => setActiveCategory(prev => prev === cat ? null : cat)}
              activeCategory={activeCategory}
            />
          )}

          {insightFlags.length > 0 && <InsightFlagsPanel flags={insightFlags} />}
          {derivedMetrics.length > 0 && <DerivedMetricsPanel metrics={derivedMetrics} />}

          {/* Core Biomarkers */}
          {biomarkers.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[#2A1F23]">
                  Core Biomarkers
                  {activeCategory && (
                    <span className="ml-2 text-sm font-normal text-[#C97C8B]">
                      — {CATEGORY_DISPLAY[activeCategory].label}
                      <button onClick={() => setActiveCategory(null)} className="ml-2 underline text-xs">
                        clear filter
                      </button>
                    </span>
                  )}
                </h2>
                <span className="text-sm text-[#7A6570]">
                  {filteredCategories.reduce((a, g) => a + g.items.length, 0)} shown
                </span>
              </div>
              <div className="space-y-8">
                {filteredCategories.map(({ category, items }) => (
                  <div key={category}>
                    <h3 className="text-xs font-bold text-[#7A6570] uppercase tracking-widest mb-3">
                      {CATEGORY_DISPLAY[category].label}
                    </h3>
                    <div className="space-y-3">
                      {items.map(b => {
                        const interp = interpMap.get(b.name);
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

          {/* Full Lab Panel */}
          {totalAnalyteCount > 0 && (
            <Card>
              <button
                className="flex items-center justify-between w-full text-left"
                onClick={() => setShowExtended(v => !v)}
              >
                <div className="flex items-center gap-2">
                  <Microscope className="w-5 h-5 text-blue-500" />
                  <h2 className="text-lg font-semibold text-[#2A1F23]">Full Lab Panel</h2>
                  <span className="text-sm text-blue-500 font-normal">({totalAnalyteCount} items)</span>
                </div>
                {showExtended ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
              </button>
              {showExtended && (
                <div className="mt-4 space-y-6">
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
            </Card>
          )}

          <RecommendedLabs presentBiomarkers={presentBiomarkerNames} activeCategory={activeCategory} />

          {/* AI deep-dive sections — only when interpretation is available */}
          {interpretation && (
            <>
              {/* Cycle Context */}
              <CycleContextCard ctx={interpretation.cycle_context} />

              {/* Lifestyle Considerations */}
              {(interpretation.supportive_considerations.nutrition.length > 0 ||
                interpretation.supportive_considerations.sleep_stress.length > 0 ||
                interpretation.supportive_considerations.lifestyle.length > 0) && (
                <Card>
                  <SectionHeader
                    icon={<Leaf className="w-4 h-4" />}
                    title="Supportive Considerations"
                    subtitle="General lifestyle topics that often come up alongside these results"
                  />
                  <div className="grid gap-4 sm:grid-cols-3">
                    {interpretation.supportive_considerations.nutrition.length > 0 && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Heart className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Nutrition</span>
                        </div>
                        <ul className="space-y-2">
                          {interpretation.supportive_considerations.nutrition.map((item, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <ArrowRight className="w-3 h-3 text-emerald-500 mt-1 flex-shrink-0" />
                              <span className="text-xs text-gray-700 leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {interpretation.supportive_considerations.sleep_stress.length > 0 && (
                      <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Moon className="w-3.5 h-3.5 text-blue-600" />
                          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Sleep & Stress</span>
                        </div>
                        <ul className="space-y-2">
                          {interpretation.supportive_considerations.sleep_stress.map((item, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <ArrowRight className="w-3 h-3 text-blue-500 mt-1 flex-shrink-0" />
                              <span className="text-xs text-gray-700 leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {interpretation.supportive_considerations.lifestyle.length > 0 && (
                      <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                          <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Lifestyle</span>
                        </div>
                        <ul className="space-y-2">
                          {interpretation.supportive_considerations.lifestyle.map((item, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <ArrowRight className="w-3 h-3 text-amber-500 mt-1 flex-shrink-0" />
                              <span className="text-xs text-gray-700 leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {/* Nutrient topics */}
              {interpretation.nutrient_topics_to_discuss?.filter(t => t.nutrient).length > 0 && (
                <Card>
                  <SectionHeader
                    icon={<FlaskConical className="w-4 h-4" />}
                    title="Nutrient Topics to Discuss"
                    subtitle="Conversation starters only — your clinician can advise what's appropriate for you"
                  />
                  <div className="space-y-4">
                    {interpretation.nutrient_topics_to_discuss.filter(t => t.nutrient).map((topic, i) => (
                      <div key={i} className="rounded-xl border border-[#e8dce0] bg-rose-50/30 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 rounded-full bg-[#C97C8B]" />
                          <h3 className="font-semibold text-[#2A1F23] capitalize text-sm">
                            {topic.nutrient.replace(/_/g, ' ')}
                          </h3>
                        </div>
                        <p className="text-xs text-gray-500 mb-2 leading-relaxed">
                          <span className="font-medium text-gray-700">Why this came up: </span>
                          {topic.why_it_came_up}
                        </p>
                        <p className="text-sm text-gray-700 leading-relaxed italic">{topic.discussion_prompt}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Questions for Doctor */}
              <Card>
                <div className="flex items-start justify-between mb-5">
                  <SectionHeader
                    icon={<MessageSquare className="w-4 h-4" />}
                    title="Questions to Ask Your Doctor"
                    subtitle="Copy and bring to your next appointment"
                  />
                  <button
                    onClick={() => copyToClipboard(interpretation.questions_for_doctor.join('\n'))}
                    className="flex items-center gap-1.5 text-xs text-[#C97C8B] hover:text-[#a05a6a] font-medium transition-colors mt-1"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy all
                      </>
                    )}
                  </button>
                </div>
                <div className="space-y-2">
                  {interpretation.questions_for_doctor.map((q, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                      <span className="text-xs font-bold text-[#C97C8B] bg-[#C97C8B]/10 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <p className="text-sm text-gray-700 leading-relaxed">{q}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Suggested Follow-ups */}
              {interpretation.suggested_followups_to_discuss.length > 0 && (
                <Card>
                  <SectionHeader
                    icon={<Stethoscope className="w-4 h-4" />}
                    title="Suggested Follow-ups to Discuss"
                  />
                  <div className="space-y-2">
                    {interpretation.suggested_followups_to_discuss.map((item, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <CheckCircle2 className="w-4 h-4 text-[#C97C8B] flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-gray-700 leading-relaxed">{item}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* When to Seek Care */}
              <Card className="bg-amber-50 border-amber-200">
                <SectionHeader
                  icon={<AlertCircle className="w-4 h-4" />}
                  title="When to Seek Care"
                  subtitle="Signs that warrant contacting a provider promptly"
                />
                <ul className="space-y-2">
                  {interpretation.safety_notes.map((note, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="text-amber-500 mt-1 flex-shrink-0">•</span>
                      <span className="text-sm text-gray-700 leading-relaxed">{note}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Disclaimer */}
              <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-4">
                <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-500 leading-relaxed italic">{interpretation.disclaimer}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
