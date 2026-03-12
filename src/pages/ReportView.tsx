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
import { CATEGORY_DISPLAY } from '../types';
import type { LabReport, Biomarker, AIInterpretation, BiomarkerCategory, BiomarkerName } from '../types';
import { RefreshCw, Trash2, Copy, Clock, AlertCircle, ChevronDown, ChevronRight, Microscope } from 'lucide-react';

interface ReportItem {
  id: string;
  lab_report_id: string;
  raw_name: string;
  canonical_slug: string | null;
  category: string | null;
  value_numeric: number;
  value_text: string | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_reference_min: number | null;
  normalized_reference_max: number | null;
  reference_operator: string | null;
  reference_operator_value: number | null;
  confidence_score: 'high' | 'medium' | 'low';
  needs_review: boolean;
  is_core_biomarker: boolean;
  created_at: string;
}

const CATEGORY_ORDER: BiomarkerCategory[] = [
  'hormones', 'thyroid', 'metabolic', 'lipids', 'liver', 'kidney', 'inflammation', 'nutrients',
];

function formatRefRange(item: ReportItem): string {
  if (item.raw_reference_range) return item.raw_reference_range;
  if (item.normalized_reference_min != null && item.normalized_reference_max != null) {
    return `${item.normalized_reference_min} – ${item.normalized_reference_max}`;
  }
  if (item.reference_operator && item.reference_operator_value != null) {
    return `${item.reference_operator} ${item.reference_operator_value}`;
  }
  return '—';
}

function labStatusFromItem(item: ReportItem): 'in_range' | 'out_of_range' | 'borderline' | 'unknown' {
  const v = item.value_numeric;
  if (item.normalized_reference_min != null && item.normalized_reference_max != null) {
    const range = item.normalized_reference_max - item.normalized_reference_min;
    const buf = range * 0.08;
    if (v < item.normalized_reference_min - buf || v > item.normalized_reference_max + buf) return 'out_of_range';
    if (v < item.normalized_reference_min || v > item.normalized_reference_max) return 'borderline';
    return 'in_range';
  }
  if (item.reference_operator && item.reference_operator_value != null) {
    const val = item.reference_operator_value;
    if (item.reference_operator === '<' || item.reference_operator === '<=' || item.reference_operator === '< OR =') {
      return v <= val ? 'in_range' : 'out_of_range';
    }
    if (item.reference_operator === '>' || item.reference_operator === '>=' || item.reference_operator === '> OR =') {
      return v >= val ? 'in_range' : 'out_of_range';
    }
  }
  return 'unknown';
}

const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  in_range:    { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'In range' },
  out_of_range:{ bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500',     label: 'Out of range' },
  borderline:  { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400',   label: 'Borderline' },
  unknown:     { bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400',    label: 'No range' },
};

function ExtendedItemRow({ item }: { item: ReportItem }) {
  const status = labStatusFromItem(item);
  const style = STATUS_STYLE[status];
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{item.raw_name}</p>
        {item.raw_reference_range && (
          <p className="text-xs text-gray-400">Ref: {formatRefRange(item)}</p>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
        <span className="text-sm font-semibold text-gray-900 tabular-nums">
          {item.value_text ?? item.value_numeric}
          {item.unit && <span className="text-gray-500 font-normal ml-1 text-xs">{item.unit}</span>}
        </span>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
      </div>
    </div>
  );
}

export function ReportView() {
  const { id: reportId = '' } = useParams<{ id: string }>();
  const { userProfile } = useAuth();
  const [report, setReport] = useState<LabReport | null>(null);
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>([]);
  const [extendedItems, setExtendedItems] = useState<ReportItem[]>([]);
  const [interpretation, setInterpretation] = useState<AIInterpretation | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState<BiomarkerCategory | null>(null);
  const [showExtended, setShowExtended] = useState(false);

  useEffect(() => {
    fetchReport();
  }, [reportId]);

  useEffect(() => {
    if (!report || report.status !== 'processing') return;
    let elapsed = 0;
    const POLL_INTERVAL = 4000;
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

    const { data: biomarkersData } = await supabase
      .from('biomarkers')
      .select('*')
      .eq('lab_report_id', reportId);

    if (biomarkersData) {
      setBiomarkers(biomarkersData as Biomarker[]);
    }

    const { data: reportItemsData } = await supabase
      .from('report_items')
      .select('*')
      .eq('lab_report_id', reportId)
      .eq('is_core_biomarker', false)
      .order('raw_name');

    if (reportItemsData) {
      setExtendedItems(reportItemsData as ReportItem[]);
    }

    const { data: interpretationData } = await supabase
      .from('interpretations')
      .select('*')
      .eq('lab_report_id', reportId)
      .maybeSingle();

    if (interpretationData) {
      setInterpretation(interpretationData.json_output as AIInterpretation);
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

  const presentBiomarkerNames = useMemo(() =>
    biomarkers.map(b => b.name),
    [biomarkers]
  );

  const extendedByCategory = useMemo(() => {
    const groups: Record<string, ReportItem[]> = {};
    for (const item of extendedItems) {
      const key = item.category ?? 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [extendedItems]);

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

      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token ?? '';
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-interpretation`;
      const fnRes = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ reportId }),
      });

      if (!fnRes.ok) {
        const body = await fnRes.text();
        console.error('[ReportView] edge function error', fnRes.status, body);
        throw new Error(`Server error ${fnRes.status}: ${body}`);
      }

      await fetchReport();
      setRegenerating(false);
    } catch (err: any) {
      console.error('[ReportView] handleRegenerate error:', err?.message ?? err);
      setError(err?.message ?? 'Failed to regenerate report');
      setRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this report? This cannot be undone.')) return;
    const { error } = await supabase.from('lab_reports').delete().eq('id', reportId);
    if (!error) window.location.href = '/app';
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

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

  if (report.status === 'processing' || regenerating) {
    return (
      <Layout>
        <Card>
          <div className="text-center py-12">
            <Clock className="w-16 h-16 text-[#C97C8B] mx-auto mb-4 animate-pulse" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Generating your AI analysis</h2>
            <p className="text-gray-600">This usually takes 15–30 seconds. This page will update automatically.</p>
          </div>
        </Card>
      </Layout>
    );
  }

  const canRegenerate = report.regeneration_count < 3 && (userProfile?.subscription_status === 'active' || isTrialActive());
  const cyclePhase = report.estimated_cycle_phase !== 'unknown' ? report.estimated_cycle_phase : null;
  const hasError = report.status === 'error';

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#2A1F23] mb-1">
              Lab Report — {formatDate(report.report_date)}
            </h1>
            <p className="text-sm text-[#7A6570]">Generated on {formatDate(report.upload_date)}</p>
            {cyclePhase && (
              <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700 capitalize">
                {cyclePhase.replace(/_/g, ' ')} phase
              </span>
            )}
            <div className="flex gap-3 mt-2">
              <span className="text-xs text-gray-500">{biomarkers.length} core biomarkers</span>
              {extendedItems.length > 0 && (
                <span className="text-xs text-blue-500">{extendedItems.length} extended items</span>
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

        {!interpretation && !hasError && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl mb-6">
            <Clock className="w-5 h-5 shrink-0 text-amber-500 animate-pulse" />
            <p className="text-sm font-medium">
              AI summary is still generating — your lab data is shown below. Refresh in a moment to see the full interpretation.
            </p>
          </div>
        )}

        {hasError && !interpretation && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 px-4 py-4 rounded-xl mb-6">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium mb-1">AI summary could not be generated</p>
              <p className="text-sm text-red-700">Your lab data is shown below. {canRegenerate ? 'You can try regenerating above.' : ''}</p>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {interpretation && (
            <Card>
              <h2 className="text-lg font-semibold text-[#2A1F23] mb-4">Summary</h2>
              <ul className="space-y-2">
                {interpretation.summary_bullets.map((bullet, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-[#C97C8B] mt-1 shrink-0">•</span>
                    <span className="text-gray-700">{bullet}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

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

          {extendedItems.length > 0 && (
            <Card>
              <button
                className="flex items-center justify-between w-full text-left"
                onClick={() => setShowExtended(v => !v)}
              >
                <div className="flex items-center gap-2">
                  <Microscope className="w-5 h-5 text-blue-500" />
                  <h2 className="text-lg font-semibold text-[#2A1F23]">
                    Full Lab Panel
                  </h2>
                  <span className="text-sm text-blue-500 font-normal">({extendedItems.length} items)</span>
                </div>
                <div className="flex items-center gap-2">
                  {showExtended ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                </div>
              </button>

              {showExtended && (
                <div className="mt-4 space-y-6">
                  {Object.entries(extendedByCategory)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([cat, items]) => (
                      <div key={cat}>
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                          {cat}
                        </h3>
                        <div className="divide-y divide-gray-100">
                          {items.map(item => (
                            <ExtendedItemRow key={item.id} item={item} />
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </Card>
          )}

          <RecommendedLabs
            presentBiomarkers={presentBiomarkerNames}
            activeCategory={activeCategory}
          />

          {interpretation && (
            <>
              <Card>
                <h2 className="text-lg font-semibold text-[#2A1F23] mb-4">Cycle Context</h2>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="font-medium">Estimated Cycle Day:</span>
                    <span>{interpretation.cycle_context.estimated_cycle_day || 'Unknown'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="font-medium">Estimated Phase:</span>
                    <span className="capitalize">{interpretation.cycle_context.estimated_cycle_phase}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="font-medium">Confidence:</span>
                    <span className="capitalize">{interpretation.cycle_context.confidence}</span>
                  </div>
                  <p className="text-gray-700 mt-2">{interpretation.cycle_context.explanation}</p>
                </div>
              </Card>

              <Card>
                <h2 className="text-lg font-semibold text-[#2A1F23] mb-4">Lifestyle Considerations</h2>
                <div className="space-y-4">
                  {interpretation.supportive_considerations.nutrition.length > 0 && (
                    <div>
                      <h3 className="font-medium text-gray-900 mb-2">Nutrition</h3>
                      <ul className="space-y-1">
                        {interpretation.supportive_considerations.nutrition.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-gray-700">
                            <span className="text-[#C97C8B] mt-1">•</span><span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {interpretation.supportive_considerations.sleep_stress.length > 0 && (
                    <div>
                      <h3 className="font-medium text-gray-900 mb-2">Sleep & Stress</h3>
                      <ul className="space-y-1">
                        {interpretation.supportive_considerations.sleep_stress.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-gray-700">
                            <span className="text-[#C97C8B] mt-1">•</span><span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {interpretation.supportive_considerations.lifestyle.length > 0 && (
                    <div>
                      <h3 className="font-medium text-gray-900 mb-2">Lifestyle</h3>
                      <ul className="space-y-1">
                        {interpretation.supportive_considerations.lifestyle.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-gray-700">
                            <span className="text-[#C97C8B] mt-1">•</span><span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </Card>

              {interpretation.nutrient_topics_to_discuss?.length > 0 && (
                <Card>
                  <h2 className="text-lg font-semibold text-[#2A1F23] mb-2">
                    Nutrient topics to discuss with your clinician
                  </h2>
                  <p className="text-sm text-gray-600 mb-4 italic">
                    Conversation starters only — your clinician can advise what's appropriate for you.
                  </p>
                  <div className="space-y-4">
                    {interpretation.nutrient_topics_to_discuss
                      .filter(t => t.nutrient)
                      .map((topic, i) => (
                        <div key={i} className="border-l-4 border-[#C97C8B] pl-4 py-2">
                          <h3 className="font-medium text-gray-900 mb-1 capitalize">
                            {topic.nutrient.replace(/_/g, ' ')}
                          </h3>
                          <p className="text-sm text-gray-700 mb-1">
                            <span className="font-medium">Why this came up:</span> {topic.why_it_came_up}
                          </p>
                          <p className="text-gray-700 text-sm">{topic.discussion_prompt}</p>
                        </div>
                      ))}
                  </div>
                </Card>
              )}

              <Card>
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-lg font-semibold text-[#2A1F23]">Questions to Ask Your Doctor</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(interpretation.questions_for_doctor.join('\n'))}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </Button>
                </div>
                <ul className="space-y-2">
                  {interpretation.questions_for_doctor.map((q, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-700">
                      <span className="text-[#C97C8B] mt-1">•</span><span>{q}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {interpretation.suggested_followups_to_discuss.length > 0 && (
                <Card>
                  <h2 className="text-lg font-semibold text-[#2A1F23] mb-4">Suggested Follow-ups to Discuss</h2>
                  <ul className="space-y-2">
                    {interpretation.suggested_followups_to_discuss.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-gray-700">
                        <span className="text-[#C97C8B] mt-1">•</span><span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card className="bg-amber-50 border-amber-200">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">When to Seek Care</h2>
                <ul className="space-y-2">
                  {interpretation.safety_notes.map((note, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-700">
                      <span className="text-amber-600 mt-1">•</span><span>{note}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="bg-gray-50">
                <p className="text-sm text-gray-700 italic">{interpretation.disclaimer}</p>
              </Card>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
