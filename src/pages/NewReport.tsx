import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { ReviewBiomarkers } from '../components/ReviewBiomarkers';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useBiomarkerCatalog } from '../hooks/useBiomarkerCatalog';
import type { Symptom, LabReportContext } from '../types';
import type { ExtractedBiomarker } from '../utils/biomarkerParser';
import { extractTextFromPDF } from '../utils/pdfExtractor';
import { parseBiomarkersFromText, validateExtractedBiomarkers } from '../utils/biomarkerParser';
import { Upload, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';

interface BiomarkerEntry {
  name: string;
  value: number;
  unit: string;
  reference_min?: number;
  reference_max?: number;
}

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
  const { catalog } = useBiomarkerCatalog();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [reportDate, setReportDate] = useState('');
  const [lastPeriodDate, setLastPeriodDate] = useState('');
  const [cycleLength, setCycleLength] = useState('28');
  const [birthControl, setBirthControl] = useState<'yes' | 'no' | 'unsure'>('unsure');
  const [pregnant, setPregnant] = useState<'yes' | 'no' | 'unsure'>('unsure');
  const [postpartum, setPostpartum] = useState<'yes' | 'no' | 'unsure'>('unsure');
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [extractedBiomarkers, setExtractedBiomarkers] = useState<ExtractedBiomarker[]>([]);
  const [biomarkers, setBiomarkers] = useState<BiomarkerEntry[]>([]);

  const defaultSlug = catalog.length > 0 ? catalog[0].slug : 'estradiol';
  const defaultUnit = catalog.length > 0 ? catalog[0].unit : '';

  useEffect(() => {
    const fetchMostRecentCycleEvent = async () => {
      if (!user || !reportDate) return;

      try {
        const { data: events, error } = await supabase
          .from('cycle_events')
          .select('*')
          .eq('user_id', user.id)
          .eq('event_type', 'period_start')
          .lte('event_date', reportDate)
          .order('event_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('Error fetching cycle events:', error);
          return;
        }

        if (events && !lastPeriodDate) {
          setLastPeriodDate(events.event_date);
        }
      } catch (error) {
        console.error('Error in fetchMostRecentCycleEvent:', error);
      }
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
        console.log('Extracted text from PDF (first 1000 chars):', text.substring(0, 1000));
        console.log('Total text length:', text.length);

        if (text.trim().length > 0) {
          const { data: { session: extractSession } } = await supabase.auth.getSession();
          if (!extractSession) {
            window.location.href = '/login';
            return;
          }
          const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-biomarkers`;
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${extractSession.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text }),
          });

          if (response.ok) {
            const data = await response.json();
            console.log('Extracted biomarkers from AI:', data.biomarkers);

            if (data.biomarkers && data.biomarkers.length > 0) {
              setExtractedBiomarkers(data.biomarkers);
            } else {
              console.warn('No biomarkers found by AI extraction, falling back to local parser');
              const parsed = parseBiomarkersFromText(text);
              const validated = validateExtractedBiomarkers(parsed);
              console.log('Local parser results:', validated);
              if (validated.length > 0) {
                setExtractedBiomarkers(validated);
              }
            }
          } else {
            console.error('AI extraction failed, falling back to local parser');
            const parsed = parseBiomarkersFromText(text);
            const validated = validateExtractedBiomarkers(parsed);
            if (validated.length > 0) {
              setExtractedBiomarkers(validated);
            }
          }
        }
      } catch (err) {
        console.error('PDF extraction failed:', err);
        setError('Failed to extract biomarkers from PDF. You can enter them manually.');
      } finally {
        setExtracting(false);
      }
    }

    setStep(2);
  };

  const toggleSymptom = (symptom: Symptom) => {
    if (symptoms.includes(symptom)) {
      setSymptoms(symptoms.filter((s) => s !== symptom));
    } else if (symptoms.length < 5) {
      setSymptoms([...symptoms, symptom]);
    }
  };

  const handleProceedToStep3 = () => {
    if (extractedBiomarkers.length > 0) {
      const convertedBiomarkers: BiomarkerEntry[] = extractedBiomarkers.map((eb) => ({
        name: eb.name,
        value: eb.value,
        unit: eb.unit ?? '',
        reference_min: eb.reference_min,
        reference_max: eb.reference_max,
      }));
      setBiomarkers(convertedBiomarkers);
    }
    setStep(3);
  };

  const updateExtractedBiomarker = (index: number, field: keyof ExtractedBiomarker, value: string | number) => {
    const updated = [...extractedBiomarkers];
    updated[index] = { ...updated[index], [field]: value } as ExtractedBiomarker;
    setExtractedBiomarkers(updated);
  };

  const removeExtractedBiomarker = (index: number) => {
    setExtractedBiomarkers(extractedBiomarkers.filter((_, i) => i !== index));
  };

  const addExtractedBiomarker = () => {
    setExtractedBiomarkers([
      ...extractedBiomarkers,
      { name: defaultSlug, value: 0, unit: defaultUnit, confidence: 'low' },
    ]);
  };

  const addBiomarker = () => {
    setBiomarkers([
      ...biomarkers,
      { name: defaultSlug, value: 0, unit: defaultUnit },
    ]);
  };

  const removeBiomarker = (index: number) => {
    setBiomarkers(biomarkers.filter((_, i) => i !== index));
  };

  const updateBiomarker = (index: number, field: keyof BiomarkerEntry, value: string | number) => {
    const updated = [...biomarkers];
    if (field === 'name') {
      const entry = catalog.find(b => b.slug === value);
      updated[index] = { ...updated[index], name: value as string, unit: entry?.unit ?? updated[index].unit };
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setBiomarkers(updated);
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

      if (biomarkers.length > 0) {
        const biomarkerInserts = biomarkers.map((b) => ({
          lab_report_id: reportData.id,
          name: b.name,
          value: b.value,
          unit: b.unit,
          reference_min: b.reference_min || null,
          reference_max: b.reference_max || null,
        }));

        const { error: biomarkerError } = await supabase
          .from('biomarkers')
          .insert(biomarkerInserts);

        if (biomarkerError) throw biomarkerError;
      }

      const { data: { session: interpSession } } = await supabase.auth.getSession();
      const interpToken = interpSession?.access_token;
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-interpretation`;
      await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${interpToken ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reportId: reportData.id }),
      });

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
  const canProceedStep2 = true;
  const canSubmit = biomarkers.length > 0;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          New Lab Report
        </h1>

        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-theme-primary text-white' : 'bg-gray-300 text-gray-600'}`}>
              1
            </div>
            <div className={`w-16 h-1 ${step >= 2 ? 'bg-theme-primary' : 'bg-gray-300'}`} />
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-theme-primary text-white' : 'bg-gray-300 text-gray-600'}`}>
              2
            </div>
            <div className={`w-16 h-1 ${step >= 3 ? 'bg-theme-primary' : 'bg-gray-300'}`} />
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 3 ? 'bg-theme-primary text-white' : 'bg-gray-300 text-gray-600'}`}>
              3
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {step === 1 && (
          <Card>
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">
              Upload Lab Results
            </h2>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lab file (PDF or image)
                </label>
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
                    <span className="text-theme-primary hover:text-theme-primary-dark font-medium">
                      Choose a file
                    </span>
                    <span className="text-gray-600"> or drag and drop</span>
                  </label>
                  <p className="text-sm text-gray-500 mt-2">
                    PDF, JPG, or PNG up to 10MB
                  </p>
                  {file && (
                    <p className="text-sm text-gray-900 mt-4 font-medium">
                      Selected: {file.name}
                    </p>
                  )}
                </div>
              </div>

              <Input
                label="Report date (required)"
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                required
              />

              <div className="flex justify-end">
                <Button
                  onClick={handleProceedFromStep1}
                  disabled={!canProceedStep1 || extracting}
                >
                  {extracting ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">
              Add Context
            </h2>

            <div className="space-y-6">
              <Input
                label="Last period start date (optional)"
                type="date"
                value={lastPeriodDate}
                onChange={(e) => setLastPeriodDate(e.target.value)}
              />

              <Input
                label="Average cycle length (days)"
                type="number"
                value={cycleLength}
                onChange={(e) => setCycleLength(e.target.value)}
                min="21"
                max="45"
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Are you currently using birth control?
                </label>
                <div className="flex gap-4">
                  {['yes', 'no', 'unsure'].map((option) => (
                    <button
                      key={option}
                      onClick={() => setBirthControl(option as typeof birthControl)}
                      className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                        birthControl === option
                          ? 'border-teal-600 bg-theme-surface-2 text-theme-text'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Are you currently pregnant?
                </label>
                <div className="flex gap-4">
                  {['yes', 'no', 'unsure'].map((option) => (
                    <button
                      key={option}
                      onClick={() => setPregnant(option as typeof pregnant)}
                      className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                        pregnant === option
                          ? 'border-teal-600 bg-theme-surface-2 text-theme-text'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Are you postpartum?
                </label>
                <div className="flex gap-4">
                  {['yes', 'no', 'unsure'].map((option) => (
                    <button
                      key={option}
                      onClick={() => setPostpartum(option as typeof postpartum)}
                      className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                        postpartum === option
                          ? 'border-teal-600 bg-theme-surface-2 text-theme-text'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Top symptoms (select up to 5)
                </label>
                <div className="flex flex-wrap gap-2">
                  {SYMPTOMS.map((symptom) => (
                    <button
                      key={symptom.value}
                      onClick={() => toggleSymptom(symptom.value)}
                      className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                        symptoms.includes(symptom.value)
                          ? 'border-teal-600 bg-theme-surface-2 text-theme-text'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                      disabled={!symptoms.includes(symptom.value) && symptoms.length >= 5}
                    >
                      {symptom.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-between">
                <Button
                  variant="secondary"
                  onClick={() => setStep(1)}
                >
                  <ArrowLeft className="w-5 h-5 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={handleProceedToStep3}
                  disabled={!canProceedStep2}
                >
                  Next
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {step === 3 && extractedBiomarkers.length > 0 && biomarkers.length === 0 && (
          <Card>
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">
              Review Extracted Biomarkers
            </h2>

            <ReviewBiomarkers
              extractedBiomarkers={extractedBiomarkers}
              onUpdate={updateExtractedBiomarker}
              onRemove={removeExtractedBiomarker}
              onAddNew={addExtractedBiomarker}
            />

            <div className="flex justify-between pt-4">
              <Button
                variant="secondary"
                onClick={() => setStep(2)}
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleProceedToStep3}
                disabled={extractedBiomarkers.length === 0}
              >
                Continue to Submit
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </Card>
        )}

        {step === 3 && (extractedBiomarkers.length === 0 || biomarkers.length > 0) && (
          <Card>
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">
              {biomarkers.length > 0 ? 'Review and Submit' : 'Enter Biomarkers'}
            </h2>

            {extractedBiomarkers.length === 0 && biomarkers.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-amber-700">
                  We couldn't automatically extract biomarkers from your file. Please enter them manually below.
                </p>
              </div>
            )}

            <div className="space-y-6">
              {biomarkers.map((biomarker, index) => {
                const catalogEntry = catalog.find(b => b.slug === biomarker.name);
                return (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Biomarker
                        </label>
                        <select
                          value={biomarker.name}
                          onChange={(e) => updateBiomarker(index, 'name', e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-theme-primary"
                        >
                          {!catalogEntry && (
                            <option value={biomarker.name}>{biomarker.name} (unknown)</option>
                          )}
                          {catalog.map((b) => (
                            <option key={b.slug} value={b.slug}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Value
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          value={biomarker.value}
                          onChange={(e) => updateBiomarker(index, 'value', parseFloat(e.target.value))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-theme-primary"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Unit
                        </label>
                        <input
                          type="text"
                          value={biomarker.unit}
                          onChange={(e) => updateBiomarker(index, 'unit', e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-theme-primary"
                          placeholder={catalogEntry?.unit ?? ''}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Reference Min (optional)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={biomarker.reference_min || ''}
                          onChange={(e) => updateBiomarker(index, 'reference_min', parseFloat(e.target.value))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-theme-primary"
                          placeholder="Optional"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Reference Max (optional)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={biomarker.reference_max || ''}
                          onChange={(e) => updateBiomarker(index, 'reference_max', parseFloat(e.target.value))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-theme-primary"
                          placeholder="Optional"
                        />
                      </div>

                      <div className="flex items-end">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => removeBiomarker(index)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <Button variant="secondary" onClick={addBiomarker}>
                Add Biomarker
              </Button>

              <div className="flex justify-between pt-4">
                <Button
                  variant="secondary"
                  onClick={() => setStep(2)}
                >
                  <ArrowLeft className="w-5 h-5 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit || loading}
                >
                  {loading ? 'Processing...' : 'Create Report'}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}
