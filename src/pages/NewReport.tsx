import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { ReviewBiomarkers } from '../components/ReviewBiomarkers';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Symptom, LabReportContext } from '../types';
import type { ReportItem } from '../utils/biomarkerParser';
import { extractTextFromPDF } from '../utils/pdfExtractor';
import { parseAllReportItems } from '../utils/biomarkerParser';
import { Upload, ArrowRight, ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';

const SYMPTOMS: { value: Symptom; label: string }[] = [
  { value: 'fatigue', label: 'Fatigue' },
  { value: 'acne', label: 'Acne' },
  { value: 'mood_changes', label: 'Mood changes' },
  { value: 'irregular_cycles', label: 'Irregular cycles' },
  { value: 'hair_loss', label: 'Hair loss' },
  { value: 'sleep_issues', label: 'Sleep issues' },
  { value: 'weight_changes', label: 'Weight changes' },
  { value: 'cramps', label: 'Cramps' },
  { value: 'low_libido', label: 'Low libido' },
  { value: 'hot_flashes', label: 'Hot flashes' },
];

export function NewReport() {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [aiRefining, setAiRefining] = useState(false);
  const [error, setError] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [reportDate, setReportDate] = useState('');
  const [lastPeriodDate, setLastPeriodDate] = useState('');
  const [cycleLength, setCycleLength] = useState('28');
  const [birthControl, setBirthControl] = useState<'yes' | 'no' | 'unsure'>('unsure');
  const [pregnant, setPregnant] = useState<'yes' | 'no' | 'unsure'>('unsure');
  const [postpartum, setPostpartum] = useState<'yes' | 'no' | 'unsure'>('unsure');
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);
  const [coverage, setCoverage] = useState<{ total_detected: number; total_core: number; total_extended: number; needs_review: number } | null>(null);

  useEffect(() => {
    const fetchMostRecentCycleEvent = async () => {
      if (!user || !reportDate) return;
      try {
        const { data: events } = await supabase
          .from('cycle_events')
          .select('*')
          .eq('user_id', user.id)
          .eq('event_type', 'period_start')
          .lte('event_date', reportDate)
          .order('event_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (events && !lastPeriodDate) {
          setLastPeriodDate(events.event_date);
        }
      } catch {}
    };
    fetchMostRecentCycleEvent();
  }, [reportDate, user, lastPeriodDate]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (validTypes.includes(selectedFile.type)) {
        setFile(selectedFile);
        setError('');
      } else {
        setError('Please upload a PDF or image file (JPG, PNG)');
      }
    }
  };

  const handleProceedFromStep1 = async () => {
    if (!file || !reportDate) return;

    if (file.type === 'application/pdf') {
      setExtracting(true);
      setError('');

      try {
        const text = await extractTextFromPDF(file);
        console.log('[NewReport] Extracted PDF text length:', text.length);

        if (text.trim().length > 0) {
          const localItems = parseAllReportItems(text, true);
          const localCov = {
            total_detected: localItems.length,
            total_core: localItems.filter(i => i.is_core_biomarker).length,
            total_extended: localItems.filter(i => !i.is_core_biomarker).length,
            needs_review: localItems.filter(i => i.needs_review).length,
          };
          setReportItems(localItems);
          setCoverage(localCov);

          const { data: { session: extractSession } } = await supabase.auth.getSession();
          if (extractSession) {
            setAiRefining(true);
            const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-biomarkers`;
            fetch(apiUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${extractSession.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ text }),
            }).then(async response => {
              if (!response.ok) return;
              const data = await response.json();
              console.log('[NewReport] AI extraction result:', data.coverage, data.items?.length, 'items');
              if (data.items && data.items.length > 0) {
                setReportItems(data.items);
                setCoverage(data.coverage ?? null);
              }
            }).catch(err => {
              console.error('[NewReport] AI extraction background error:', err);
            }).finally(() => {
              setAiRefining(false);
            });
          }
        }
      } catch (err) {
        console.error('[NewReport] PDF extraction failed:', err);
        setError('Failed to extract data from PDF. You can enter items manually.');
      } finally {
        setExtracting(false);
      }
    }

    setStep(2);
  };

  const toggleSymptom = (symptom: Symptom) => {
    if (symptoms.includes(symptom)) {
      setSymptoms(symptoms.filter(s => s !== symptom));
    } else if (symptoms.length < 5) {
      setSymptoms([...symptoms, symptom]);
    }
  };

  const handleProceedToStep3 = () => {
    setStep(3);
  };

  const calculateCycleInfo = () => {
    if (!reportDate || !lastPeriodDate) {
      return { cycleDay: null, cyclePhase: 'unknown' as const };
    }
    const reportDateObj = new Date(reportDate);
    const lastPeriodDateObj = new Date(lastPeriodDate);
    const daysDiff = Math.floor(
      (reportDateObj.getTime() - lastPeriodDateObj.getTime()) / (1000 * 60 * 60 * 24)
    );
    const cycleDay = daysDiff + 1;
    let cyclePhase: 'menstrual' | 'follicular' | 'ovulatory' | 'luteal' | 'unknown' = 'unknown';
    if (cycleDay >= 1 && cycleDay <= 5) cyclePhase = 'menstrual';
    else if (cycleDay >= 6 && cycleDay <= 12) cyclePhase = 'follicular';
    else if (cycleDay >= 13 && cycleDay <= 16) cyclePhase = 'ovulatory';
    else if (cycleDay >= 17 && cycleDay <= 35) cyclePhase = 'luteal';
    return { cycleDay, cyclePhase };
  };

  const handleSubmit = async () => {
    if (!user) return;
    setLoading(true);
    setError('');

    try {
      const { data: existingReports } = await supabase
        .from('lab_reports')
        .select('id')
        .eq('user_id', user.id);

      const isSecondReport = existingReports?.length === 1;

      let fileUrl = null;
      if (file) {
        const fileExt = file.name.split('.').pop();
        const storagePath = `${user.id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('lab-files')
          .upload(storagePath, file);
        if (uploadError) throw uploadError;
        fileUrl = storagePath;
      }

      const { cycleDay, cyclePhase } = calculateCycleInfo();
      const context: LabReportContext = {
        birth_control: birthControl,
        pregnant,
        postpartum,
        top_symptoms: symptoms,
      };

      const { data: reportData, error: reportError } = await supabase
        .from('lab_reports')
        .insert({
          user_id: user.id,
          report_date: reportDate,
          file_url: fileUrl,
          last_period_start_date: lastPeriodDate || null,
          average_cycle_length: parseInt(cycleLength) || 28,
          estimated_cycle_day: cycleDay,
          estimated_cycle_phase: cyclePhase,
          context,
          status: 'processing',
        })
        .select()
        .single();

      if (reportError) throw reportError;

      const itemsToSave = reportItems.filter(i => i.value_numeric > 0 && i.value_numeric <= 100000);

      if (itemsToSave.length > 0) {
        const reportItemInserts = itemsToSave.map(item => ({
          lab_report_id: reportData.id,
          raw_name: item.raw_name,
          canonical_slug: item.canonical_slug,
          category: item.category,
          value_numeric: item.value_numeric,
          value_text: item.value_text,
          unit: item.unit,
          raw_reference_range: item.raw_reference_range,
          normalized_reference_min: item.normalized_reference_min,
          normalized_reference_max: item.normalized_reference_max,
          reference_operator: item.reference_operator,
          reference_operator_value: item.reference_operator_value,
          confidence_score: item.confidence_score,
          needs_review: item.needs_review,
          is_core_biomarker: item.is_core_biomarker,
          source_snippet: item.source_snippet,
        }));

        const { error: itemsError } = await supabase
          .from('report_items')
          .insert(reportItemInserts);

        if (itemsError) {
          console.error('[NewReport] Failed to save report_items:', itemsError);
        }

        const coreItems = itemsToSave.filter(i => i.is_core_biomarker && i.canonical_slug);
        if (coreItems.length > 0) {
          const biomarkerInserts = coreItems.map(item => ({
            lab_report_id: reportData.id,
            name: item.canonical_slug!,
            value: item.value_numeric,
            unit: item.unit ?? '',
            reference_min: item.normalized_reference_min ?? null,
            reference_max: item.normalized_reference_max ?? null,
          }));

          const { error: biomarkerError } = await supabase
            .from('biomarkers')
            .insert(biomarkerInserts);

          if (biomarkerError) {
            console.error('[NewReport] Failed to save core biomarkers:', biomarkerError);
          }
        }
      }

      const { data: { session: interpSession } } = await supabase.auth.getSession();
      const interpToken = interpSession?.access_token;
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-interpretation`;

      try {
        const interpResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${interpToken ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reportId: reportData.id }),
        });
        if (!interpResponse.ok) {
          const errText = await interpResponse.text().catch(() => '');
          console.error('[NewReport] generate-interpretation returned error:', interpResponse.status, errText);
          await supabase.from('lab_reports').update({ status: 'error' }).eq('id', reportData.id);
        }
      } catch (interpErr) {
        console.error('[NewReport] generate-interpretation network error:', interpErr);
        await supabase.from('lab_reports').update({ status: 'error' }).eq('id', reportData.id);
      }

      if (isSecondReport) {
        sessionStorage.setItem('showSecondLabComparison', 'true');
        window.location.href = '/app/tracker';
      } else {
        window.location.href = `/app/reports/${reportData.id}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
    }
  };

  const canProceedStep1 = file && reportDate;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">New Lab Report</h1>

        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center">
            {[1, 2, 3].map((s, idx) => (
              <div key={s} className="flex items-center">
                {idx > 0 && <div className={`w-16 h-1 ${step >= s ? 'bg-theme-primary' : 'bg-gray-300'}`} />}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= s ? 'bg-theme-primary text-white' : 'bg-gray-200 text-gray-600'}`}>
                  {s}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {step === 1 && (
          <Card>
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Upload Lab Results</h2>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Lab file (PDF or image)</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-theme-primary transition-colors">
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileChange}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <span className="text-theme-primary hover:text-theme-primary-dark font-medium">Choose a file</span>
                    <span className="text-gray-600"> or drag and drop</span>
                  </label>
                  <p className="text-sm text-gray-500 mt-2">PDF, JPG, or PNG up to 10MB</p>
                  {file && <p className="text-sm text-gray-900 mt-4 font-medium">Selected: {file.name}</p>}
                </div>
              </div>

              <Input
                label="Report date (required)"
                type="date"
                value={reportDate}
                onChange={e => setReportDate(e.target.value)}
                required
              />

              <div className="flex justify-end">
                <Button onClick={handleProceedFromStep1} disabled={!canProceedStep1 || extracting}>
                  {extracting ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Extracting...</>
                  ) : (
                    <>Next<ArrowRight className="w-5 h-5 ml-2" /></>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Add Context</h2>
            <div className="space-y-6">
              <Input
                label="Last period start date (optional)"
                type="date"
                value={lastPeriodDate}
                onChange={e => setLastPeriodDate(e.target.value)}
              />

              <Input
                label="Average cycle length (days)"
                type="number"
                value={cycleLength}
                onChange={e => setCycleLength(e.target.value)}
                min="21"
                max="45"
              />

              {(['birth_control', 'pregnant', 'postpartum'] as const).map(field => {
                const labels: Record<string, string> = {
                  birth_control: 'Are you currently using birth control?',
                  pregnant: 'Are you currently pregnant?',
                  postpartum: 'Are you postpartum?',
                };
                const setters: Record<string, (v: 'yes' | 'no' | 'unsure') => void> = {
                  birth_control: setBirthControl,
                  pregnant: setPregnant,
                  postpartum: setPostpartum,
                };
                const values: Record<string, string> = {
                  birth_control: birthControl,
                  pregnant,
                  postpartum,
                };
                return (
                  <div key={field}>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{labels[field]}</label>
                    <div className="flex gap-4">
                      {['yes', 'no', 'unsure'].map(opt => (
                        <button
                          key={opt}
                          onClick={() => setters[field](opt as 'yes' | 'no' | 'unsure')}
                          className={`px-4 py-2 rounded-lg border-2 transition-colors ${values[field] === opt ? 'border-teal-600 bg-theme-surface-2 text-theme-text' : 'border-gray-300 hover:border-gray-400'}`}
                        >
                          {opt.charAt(0).toUpperCase() + opt.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Top symptoms (select up to 5)</label>
                <div className="flex flex-wrap gap-2">
                  {SYMPTOMS.map(symptom => (
                    <button
                      key={symptom.value}
                      onClick={() => toggleSymptom(symptom.value)}
                      className={`px-4 py-2 rounded-lg border-2 transition-colors ${symptoms.includes(symptom.value) ? 'border-teal-600 bg-theme-surface-2 text-theme-text' : 'border-gray-300 hover:border-gray-400'}`}
                      disabled={!symptoms.includes(symptom.value) && symptoms.length >= 5}
                    >
                      {symptom.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-5 h-5 mr-2" />Back
                </Button>
                <Button onClick={handleProceedToStep3}>
                  Next<ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Review & Submit</h2>

            {aiRefining && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2.5 rounded-lg mb-4 text-sm">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>AI is refining extracted values in the background — results will update automatically.</span>
              </div>
            )}

            {coverage && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 mt-2">
                {[
                  { label: 'Detected', value: coverage.total_detected, color: 'bg-gray-50 border-gray-200 text-gray-700' },
                  { label: 'Core panel', value: coverage.total_core, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                  { label: 'Extended', value: coverage.total_extended, color: 'bg-blue-50 border-blue-200 text-blue-700' },
                  { label: 'Needs review', value: coverage.needs_review, color: 'bg-amber-50 border-amber-200 text-amber-700' },
                ].map(stat => (
                  <div key={stat.label} className={`rounded-lg border px-3 py-2 text-center ${stat.color}`}>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-xs font-medium mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            )}

            {reportItems.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-700">
                    We couldn't automatically extract lab data from your file. You can still submit the report — it will be saved and you can add results manually.
                  </p>
                </div>
              </div>
            )}

            {reportItems.length > 0 && (
              <ReviewBiomarkers
                items={reportItems}
                onUpdate={(index, field, value) => {
                  const updated = [...reportItems];
                  updated[index] = { ...updated[index], [field]: value } as ReportItem;
                  setReportItems(updated);
                }}
                onRemove={index => setReportItems(reportItems.filter((_, i) => i !== index))}
                onAddNew={() => setReportItems([...reportItems, {
                  raw_name: '',
                  canonical_slug: null,
                  category: null,
                  value_numeric: 0,
                  value_text: null,
                  unit: null,
                  raw_reference_range: null,
                  normalized_reference_min: null,
                  normalized_reference_max: null,
                  reference_operator: null,
                  reference_operator_value: null,
                  confidence_score: 'low',
                  is_core_biomarker: false,
                  needs_review: true,
                  source_snippet: null,
                }])}
              />
            )}

            <div className="flex justify-between pt-6">
              <Button variant="secondary" onClick={() => setStep(2)}>
                <ArrowLeft className="w-5 h-5 mr-2" />Back
              </Button>
              <Button onClick={handleSubmit} disabled={loading}>
                {loading ? 'Processing...' : 'Create Report'}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}
