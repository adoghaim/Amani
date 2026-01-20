import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { LabReport, Biomarker, AIInterpretation } from '../types';
import { RefreshCw, Trash2, Copy, Clock, AlertCircle } from 'lucide-react';

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

  const handleRegenerate = async () => {
    if (!report || report.regeneration_count >= 3) return;
    if (userProfile?.subscription_status !== 'active' && !isTrialActive()) return;

    setRegenerating(true);
    setError('');

    try {
      await supabase
        .from('interpretations')
        .delete()
        .eq('lab_report_id', reportId);

      await supabase
        .from('lab_reports')
        .update({
          status: 'processing',
          regeneration_count: report.regeneration_count + 1
        })
        .eq('id', reportId);

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-interpretation`;
      await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reportId }),
      });

      setTimeout(() => {
        fetchReport();
        setRegenerating(false);
      }, 3000);
    } catch (err) {
      setError('Failed to regenerate report');
      setRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this report? This cannot be undone.')) {
      return;
    }

    const { error } = await supabase
      .from('lab_reports')
      .delete()
      .eq('id', reportId);

    if (!error) {
      window.location.href = '/app';
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const isTrialActive = () => {
    if (!userProfile) return false;
    if (userProfile.subscription_status === 'active') return true;
    if (userProfile.subscription_status === 'trial') {
      const trialStart = new Date(userProfile.trial_start_date);
      const now = new Date();
      const daysSinceStart = Math.floor((now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
      return daysSinceStart < 30;
    }
    return false;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
        </div>
      </Layout>
    );
  }

  if (!report) {
    return (
      <Layout>
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Report not found</h1>
          <a href="/app">
            <Button>Back to Dashboard</Button>
          </a>
        </div>
      </Layout>
    );
  }

  if (report.status === 'processing' || regenerating) {
    return (
      <Layout>
        <Card>
          <div className="text-center py-12">
            <Clock className="w-16 h-16 text-teal-600 mx-auto mb-4 animate-pulse" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Processing your report
            </h2>
            <p className="text-gray-600">
              This usually takes 30-60 seconds. You can refresh this page to check status.
            </p>
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
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Unable to generate report
            </h2>
            <p className="text-gray-600 mb-6">
              There was an issue processing your lab results. Please try again or contact support.
            </p>
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
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Lab Report - {formatDate(report.report_date)}
            </h1>
            <p className="text-gray-600">
              Generated on {formatDate(report.upload_date)}
            </p>
          </div>
          <div className="flex gap-2">
            {canRegenerate && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRegenerate}
                disabled={regenerating}
              >
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
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="space-y-6">
          <Card>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Summary</h2>
            <ul className="space-y-2">
              {interpretation.summary_bullets.map((bullet, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-teal-600 mt-1">•</span>
                  <span className="text-gray-700">{bullet}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Cycle Context</h2>
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
              <p className="text-gray-700 mt-4">
                {interpretation.cycle_context.explanation}
              </p>
            </div>
          </Card>

          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Biomarkers</h2>
            <div className="space-y-4">
              {interpretation.biomarkers.map((biomarker, index) => (
                <Card key={index}>
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-semibold text-gray-900 capitalize">
                      {biomarker.name}
                    </h3>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      biomarker.status_label === 'in_range' ? 'bg-green-100 text-green-800' :
                      biomarker.status_label === 'borderline' ? 'bg-yellow-100 text-yellow-800' :
                      biomarker.status_label === 'out_of_range' ? 'bg-orange-100 text-orange-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {biomarker.status_label.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div className="text-gray-700">
                      <span className="font-medium">Your Value:</span> {biomarker.user_value} {biomarker.unit}
                    </div>
                    <div className="text-gray-700">
                      <span className="font-medium">Reference Range:</span> {biomarker.reference_range}
                    </div>
                    <div className="border-t border-gray-200 pt-3">
                      <p className="text-gray-700 mb-3">{biomarker.plain_english_meaning}</p>
                      {biomarker.timing_notes && (
                        <p className="text-gray-600 text-sm mb-3 italic">{biomarker.timing_notes}</p>
                      )}
                    </div>
                    {biomarker.common_non_alarm_reasons.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Common reasons for this result:</h4>
                        <ul className="space-y-1">
                          {biomarker.common_non_alarm_reasons.map((reason, i) => (
                            <li key={i} className="flex items-start gap-2 text-gray-700">
                              <span className="text-teal-600 mt-1">•</span>
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {biomarker.when_clinicians_follow_up.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">When clinicians may follow up:</h4>
                        <ul className="space-y-1">
                          {biomarker.when_clinicians_follow_up.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-gray-700">
                              <span className="text-teal-600 mt-1">•</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {interpretation.nutrient_topics_to_discuss && interpretation.nutrient_topics_to_discuss.length > 0 && (
            <Card>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Nutrient topics to discuss with your clinician
              </h2>
              <p className="text-sm text-gray-600 mb-4 italic">
                Conversation starters only — your clinician can advise what's appropriate for you.
              </p>
              <div className="space-y-4">
                {interpretation.nutrient_topics_to_discuss
                  .filter(topic => topic.nutrient)
                  .map((topic, index) => (
                    <div key={index} className="border-l-4 border-teal-500 pl-4 py-2">
                      <h3 className="font-medium text-gray-900 mb-2 capitalize">
                        {topic.nutrient.replace(/_/g, ' ')}
                      </h3>
                      <p className="text-sm text-gray-700 mb-2">
                        <span className="font-medium">Why this came up:</span> {topic.why_it_came_up}
                      </p>
                      <p className="text-gray-700">
                        {topic.discussion_prompt}
                      </p>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          <Card>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Supportive Considerations</h2>
            <div className="space-y-4">
              {interpretation.supportive_considerations.nutrition.length > 0 && (
                <div>
                  <h3 className="font-medium text-gray-900 mb-2">Nutrition</h3>
                  <ul className="space-y-1">
                    {interpretation.supportive_considerations.nutrition.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-gray-700">
                        <span className="text-teal-600 mt-1">•</span>
                        <span>{item}</span>
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
                        <span className="text-teal-600 mt-1">•</span>
                        <span>{item}</span>
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
                        <span className="text-teal-600 mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Questions to Ask Your Doctor</h2>
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
              {interpretation.questions_for_doctor.map((question, index) => (
                <li key={index} className="flex items-start gap-2 text-gray-700">
                  <span className="text-teal-600 mt-1">•</span>
                  <span>{question}</span>
                </li>
              ))}
            </ul>
          </Card>

          {interpretation.suggested_followups_to_discuss.length > 0 && (
            <Card>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Suggested Follow-ups to Discuss</h2>
              <ul className="space-y-2">
                {interpretation.suggested_followups_to_discuss.map((item, index) => (
                  <li key={index} className="flex items-start gap-2 text-gray-700">
                    <span className="text-teal-600 mt-1">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="bg-amber-50 border-amber-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">When to Seek Care</h2>
            <ul className="space-y-2">
              {interpretation.safety_notes.map((note, index) => (
                <li key={index} className="flex items-start gap-2 text-gray-700">
                  <span className="text-amber-600 mt-1">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="bg-gray-50">
            <p className="text-sm text-gray-700 italic">
              {interpretation.disclaimer}
            </p>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
