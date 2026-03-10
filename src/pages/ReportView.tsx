import { useState, useEffect, useMemo } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BiomarkerSystemDashboard } from '../components/BiomarkerSystemDashboard';
import { DerivedMetricsPanel } from '../components/DerivedMetricsPanel';
import { InsightFlagsPanel } from '../components/InsightFlagsPanel';
import { computeDerivedMetrics, evaluateInsightRules } from '../utils/derivedMetrics';
import type { LabReport, Biomarker, AIInterpretation, BiomarkerCategory } from '../types';
import { RefreshCw, Trash2, Copy, Clock, AlertCircle } from 'lucide-react';

const BIOMARKER_CATEGORIES: Record<string, BiomarkerCategory> = {
  estradiol: 'hormones', progesterone: 'hormones', lh: 'hormones', fsh: 'hormones',
  amh: 'hormones', testosterone_total: 'hormones', testosterone_free: 'hormones',
  dhea_s: 'hormones', cortisol: 'hormones', prolactin: 'hormones', insulin: 'hormones', shbg: 'hormones',
  tsh: 'thyroid', free_t4: 'thyroid', free_t3: 'thyroid', reverse_t3: 'thyroid',
  tpo_antibodies: 'thyroid', tgab: 'thyroid',
  glucose_fasting: 'metabolic', hba1c: 'metabolic',
  total_cholesterol: 'lipids', ldl: 'lipids', hdl: 'lipids', triglycerides: 'lipids',
  apob: 'lipids', lpA: 'lipids',
  alt: 'liver', ast: 'liver', ggt: 'liver', total_bilirubin: 'liver', albumin: 'liver',
  creatinine: 'kidney', egfr: 'kidney', bun: 'kidney', uric_acid: 'kidney',
  ferritin: 'nutrients', vitamin_d: 'nutrients', b12: 'nutrients', folate: 'nutrients',
  magnesium: 'nutrients', zinc: 'nutrients', iron: 'nutrients',
  hscrp: 'inflammation', homocysteine: 'inflammation',
};

const CATEGORY_SECTION_LABELS: Record<BiomarkerCategory, string> = {
  hormones: 'Hormones',
  thyroid: 'Thyroid',
  metabolic: 'Metabolic',
  lipids: 'Cardiovascular',
  liver: 'Liver',
  kidney: 'Kidney',
  nutrients: 'Nutrients',
  inflammation: 'Inflammation',
};

interface ReportViewProps {
  reportId: string;
}

export function ReportView({ reportId }: ReportViewProps) {
  const { userProfile } = useAuth();
  const [report, setReport] = useState<LabReport | null>(null);
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>([]);
  const [interpretation, setInterpretation] = useState<AIInterpretation | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState<BiomarkerCategory | null>(null);

  useEffect(() => {
    fetchReport();
  }, [reportId]);

  const fetchReport = async () => {
    const { data: reportData, error: reportError } = await supabase
      .from('lab_reports')
      .select('*')
      .eq('id', reportId)
      .single();

    if (reportError || !reportData) {
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
  const insightFlags = useMemo(() => evaluateInsightRules(biomarkers), [biomarkers]);

  const groupedBiomarkers = useMemo(() => {
    if (!interpretation) return {};
    const groups: Partial<Record<BiomarkerCategory, typeof interpretation.biomarkers>> = {};
    for (const b of interpretation.biomarkers) {
      const cat = BIOMARKER_CATEGORIES[b.name] ?? 'hormones';
      if (!groups[cat]) groups[cat] = [];
      groups[cat]!.push(b);
    }
    return groups;
  }, [interpretation]);

  const categoryOrder: BiomarkerCategory[] = ['hormones','thyroid','metabolic','lipids','liver','kidney','nutrients','inflammation'];

  const filteredBiomarkers = useMemo(() => {
    if (!interpretation) return [];
    if (!activeCategory) return interpretation.biomarkers;
    return interpretation.biomarkers.filter(b => BIOMARKER_CATEGORIES[b.name] === activeCategory);
  }, [interpretation, activeCategory]);

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

      const { data: { session: regenSession } } = await supabase.auth.getSession();
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-interpretation`;
      await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${regenSession?.access_token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reportId }),
      });

      setTimeout(() => { fetchReport(); setRegenerating(false); }, 3000);
    } catch {
      setError('Failed to regenerate report');
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
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Processing your report</h2>
            <p className="text-gray-600">This usually takes 30–60 seconds. You can refresh this page to check status.</p>
          </div>
        </Card>
      </Layout>
    );
  }

  if (report.status === 'error' || !interpretation) {
    return (
      <Layout>
        <Card>
          <div className="text-center py-12">
            <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Unable to generate report</h2>
            <p className="text-gray-600 mb-6">There was an issue processing your lab results. Please try again.</p>
            <Button onClick={handleRegenerate}>Try Again</Button>
          </div>
        </Card>
      </Layout>
    );
  }

  const canRegenerate = report.regeneration_count < 3 && (userProfile?.subscription_status === 'active' || isTrialActive());

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#2A1F23] mb-1">
              Lab Report — {formatDate(report.report_date)}
            </h1>
            <p className="text-sm text-[#7A6570]">Generated on {formatDate(report.upload_date)}</p>
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

          <BiomarkerSystemDashboard
            biomarkers={biomarkers}
            interpretationBiomarkers={interpretation.biomarkers}
            onCategoryClick={cat => setActiveCategory(prev => prev === cat ? null : cat)}
            activeCategory={activeCategory}
          />

          {insightFlags.length > 0 && <InsightFlagsPanel flags={insightFlags} />}

          {derivedMetrics.length > 0 && <DerivedMetricsPanel metrics={derivedMetrics} />}

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

          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#2A1F23]">
                Biomarkers
                {activeCategory && (
                  <span className="ml-2 text-sm font-normal text-[#C97C8B]">
                    — {CATEGORY_SECTION_LABELS[activeCategory]}
                    <button onClick={() => setActiveCategory(null)} className="ml-2 underline text-xs">
                      clear filter
                    </button>
                  </span>
                )}
              </h2>
              <span className="text-sm text-[#7A6570]">{filteredBiomarkers.length} shown</span>
            </div>

            {activeCategory ? (
              <div className="space-y-4">
                {filteredBiomarkers.map((biomarker, i) => (
                  <BiomarkerCard key={i} biomarker={biomarker} />
                ))}
              </div>
            ) : (
              <div className="space-y-8">
                {categoryOrder.map(cat => {
                  const items = groupedBiomarkers[cat];
                  if (!items?.length) return null;
                  return (
                    <div key={cat}>
                      <h3 className="text-sm font-semibold text-[#7A6570] uppercase tracking-wide mb-3">
                        {CATEGORY_SECTION_LABELS[cat]}
                      </h3>
                      <div className="space-y-4">
                        {items.map((biomarker, i) => (
                          <BiomarkerCard key={i} biomarker={biomarker} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
        </div>
      </div>
    </Layout>
  );
}

function BiomarkerCard({ biomarker }: { biomarker: AIInterpretation['biomarkers'][number] }) {
  const [expanded, setExpanded] = useState(false);

  const statusStyles = {
    in_range: 'bg-green-100 text-green-800',
    borderline: 'bg-yellow-100 text-yellow-800',
    out_of_range: 'bg-orange-100 text-orange-800',
    unknown: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-gray-900 capitalize">
              {biomarker.name.replace(/_/g, ' ')}
            </h3>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[biomarker.status_label]}`}>
              {biomarker.status_label.replace('_', ' ')}
            </span>
          </div>
          <p className="text-sm text-[#7A6570] mt-0.5">
            {biomarker.user_value} {biomarker.unit}
            {biomarker.reference_range && ` — ref: ${biomarker.reference_range}`}
          </p>
        </div>
        <span className="text-xs text-[#9A8A90]">{expanded ? 'less' : 'more'}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-3 border-t border-gray-100">
          <p className="text-gray-700 pt-3">{biomarker.plain_english_meaning}</p>
          {biomarker.timing_notes && (
            <p className="text-gray-600 text-sm italic">{biomarker.timing_notes}</p>
          )}
          {biomarker.common_non_alarm_reasons.length > 0 && (
            <div>
              <h4 className="font-medium text-gray-900 mb-1 text-sm">Common reasons for this result:</h4>
              <ul className="space-y-1">
                {biomarker.common_non_alarm_reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-[#C97C8B] mt-0.5">•</span><span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {biomarker.when_clinicians_follow_up.length > 0 && (
            <div>
              <h4 className="font-medium text-gray-900 mb-1 text-sm">When clinicians may follow up:</h4>
              <ul className="space-y-1">
                {biomarker.when_clinicians_follow_up.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-[#C97C8B] mt-0.5">•</span><span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
