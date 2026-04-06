import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { ReviewBiomarkers } from '../components/ReviewBiomarkers';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Symptom, LabReportContext, ReportAnalyte, BiomarkerName } from '../types';
import type { ReportItem, ParserDebugOutput } from '../utils/biomarkerParser';
import { extractTextFromPDF, convertPDFToImages } from '../utils/pdfExtractor';
import { parseAllReportItemsWithDebug } from '../utils/biomarkerParser';
import { normalizeReportItems } from '../lib/biomarkers/normalizeReportItems';
import { computeAmaniStatus } from '../lib/scoring/scoreBiomarker';
import { Upload, ArrowRight, ArrowLeft, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';

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
  const [reportAnalytes, setReportAnalytes] = useState<ReportAnalyte[]>([]);
  const [coverage, setCoverage] = useState<{ total_detected: number; total_core: number; total_extended: number; needs_review: number } | null>(null);
  const [parserDebug, setParserDebug] = useState<ParserDebugOutput | null>(null);
  const [periodAutoFilled, setPeriodAutoFilled] = useState(false);
  const [fetchingPeriod, setFetchingPeriod] = useState(false);
  const [submitStep, setSubmitStep] = useState<'uploading' | 'creating' | 'saving' | 'interpreting' | 'complete' | null>(null);

  useEffect(() => {
    const fetchMostRecentCycleEvent = async () => {
      if (!user || !reportDate) return;
      setFetchingPeriod(true);
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
          setPeriodAutoFilled(true);
        }
      } catch {}
      setFetchingPeriod(false);
    };
    fetchMostRecentCycleEvent();
  }, [reportDate, user]);

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

    setExtracting(true);
    setError('');

    try {
      if (file.type === 'application/pdf') {
        const text = await extractTextFromPDF(file);
        console.log('[NewReport] Extracted PDF text length:', text.length);

        const { items: localItems, debug: debugOut, heuristics } = parseAllReportItemsWithDebug(text, file.name);
        setParserDebug(debugOut);
        
        // ORCHESTRATION LOGIC: Check if extraction is "weak"
        if (text.trim().length === 0 || heuristics.isWeak) {
          console.log('[NewReport] Text extraction weak, triggering OCR fallback. Reason:', heuristics.reason);
          const images = await convertPDFToImages(file);
          await callOcrFallback(images);
        } else {
          // Normal flow: Use local results and trigger background "refinement"
          setReportItems(localItems);
          setCoverage({
            total_detected: localItems.length,
            total_core: localItems.filter(i => i.is_core_biomarker).length,
            total_extended: localItems.filter(i => !i.is_core_biomarker).length,
            needs_review: localItems.filter(i => i.needs_review).length,
          });
          
          await triggerAiRefinement(text);
        }
      } else if (file.type.startsWith('image/')) {
        // IMAGE FLOW: Direct OCR Fallback
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        await callOcrFallback([base64]);
      }
    } catch (err) {
      console.error('[NewReport] Extraction failed:', err);
      setError('Failed to extract data. You can enter items manually.');
    } finally {
      setExtracting(false);
      setStep(2);
    }
  };

  const callOcrFallback = async (base64Images: string[]) => {
    setAiRefining(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error: invokeError } = await supabase.functions.invoke('parse-lab-report-ocr', {
        body: { base64Images },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (invokeError) throw new Error(`OCR fallback failed: ${invokeError.message}`);
      
      if (data.items && data.items.length > 0) {
        setReportItems(data.items);
        const cov = {
          total_detected: data.items.length,
          total_core: data.items.filter((i: ReportItem) => i.is_core_biomarker).length,
          total_extended: data.items.filter((i: ReportItem) => !i.is_core_biomarker).length,
          needs_review: data.items.filter((i: ReportItem) => i.needs_review).length,
        };
        setCoverage(cov);
      }
    } catch (err) {
      console.error('[NewReport] OCR fallback error:', err);
      setError('OCR extraction failed. Falling back to manual entry.');
    } finally {
      setAiRefining(false);
    }
  };

  const triggerAiRefinement = async (text: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!user || !session) return;

    setAiRefining(true);
    supabase.functions.invoke('extract-biomarkers', {
      body: { text },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    }).then(({ data, error: invokeError }) => {
      if (invokeError) {
        console.warn('[NewReport] AI extraction background warning:', invokeError.message);
        return;
      }
      if (data.items && data.items.length > 0) {
        setReportItems(data.items);
        const cov = {
          total_detected: data.items.length,
          total_core: data.items.filter((i: ReportItem) => i.is_core_biomarker).length,
          total_extended: data.items.filter((i: ReportItem) => !i.is_core_biomarker).length,
          needs_review: data.items.filter((i: ReportItem) => i.needs_review).length,
        };
        setCoverage(cov);
      }
      if (data.analytes && data.analytes.length > 0) {
        setReportAnalytes(data.analytes);
      }
    }).catch(err => {
      console.error('[NewReport] AI extraction background network error:', err);
    }).finally(() => {
      setAiRefining(false);
    });
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
    const { data: { session } } = await supabase.auth.getSession();
    if (!user || !session) return;
    
    setLoading(true);
    setError('');
    
    let createdReportId: string | null = null;

    try {
      // 0. Check for existing reports for logic later
      const { data: existingReports } = await supabase
        .from('lab_reports')
        .select('id')
        .eq('user_id', user.id);
      const isSecondReport = existingReports?.length === 1;

      // 1. Uploading
      console.log('[NewReport] Step: Uploading started');
      setSubmitStep('uploading');
      let fileUrl = null;
      if (file) {
        const fileExt = file.name.split('.').pop();
        const storagePath = `${user.id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('lab-files')
          .upload(storagePath, file);
        if (uploadError) {
          console.error('[NewReport] Upload failed:', uploadError);
          throw new Error(`File upload failed: ${uploadError.message}`);
        }
        fileUrl = storagePath;
        console.log('[NewReport] Step: Uploading success');
      }

      // 2. Creating Report Record
      console.log('[NewReport] Step: Creating report record started');
      setSubmitStep('creating');
      const { cycleDay, cyclePhase } = calculateCycleInfo();
      const context: LabReportContext = {
        birth_control: birthControl,
        pregnant,
        postpartum,
        top_symptoms: symptoms,
        submission_mode: 'standard', // Default to current Phase 4A target
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

      if (reportError) {
        console.error('[NewReport] Report creation failed:', reportError);
        throw new Error(`Failed to create report record: ${reportError.message}`);
      }
      createdReportId = reportData.id;
      setStep(4); // Move to dedicated processing screen UI
      console.log('[NewReport] Step: Creating report record success (ID:', createdReportId, ')');

      // 3. Saving parser debug (Non-blocking)
      if (parserDebug) {
        console.log('[NewReport] Step: Saving parser debug (async)');
        supabase.from('parser_debug').insert({
          report_id: createdReportId,
          user_id: user.id,
          raw_text: parserDebug.rawText,
          page_count: parserDebug.pageCount,
          file_name: file?.name ?? null,
          analyte_blocks_json: parserDebug.analyteBlocks as unknown as never,
          parsed_candidates_json: [] as unknown as never,
          mapping_debug_json: [] as unknown as never,
          ai_input_json: [] as unknown as never,
        }).then(({ error: dbgErr }) => {
          if (dbgErr) console.warn('[NewReport] parser_debug save failed:', dbgErr.message);
        });
      }

      // 4. Saving Data (Analytes & Biomarkers)
      console.log('[NewReport] Step: Saving analytes started');
      setSubmitStep('saving');
      const normalized = normalizeReportItems(reportItems);
      const mappedCount = normalized.filter(i => i.normalization_status === 'mapped').length;
      const unmappedCount = normalized.filter(i => i.normalization_status === 'unmapped').length;
      console.log(`[NewReport] Normalization: ${mappedCount} mapped, ${unmappedCount} unmapped out of ${normalized.length} total`);
      const itemsToSave = normalized.filter(i => i.value_numeric != null && i.value_numeric >= 0 && i.value_numeric <= 100000);

      if (itemsToSave.length > 0) {
        // A. Core biomarkers (scoring table — keyed by canonical_slug)
        const coreItems = itemsToSave.filter(i => i.is_core_biomarker && i.canonical_slug);
        if (coreItems.length > 0) {
          const biomarkerInserts = coreItems.map(item => {
            const slug = item.canonical_slug! as BiomarkerName;
            const status = computeAmaniStatus(slug, item.value_numeric!, cyclePhase);
            let flagged: 'in_range' | 'borderline' | 'out_of_range' | 'unknown' = 'in_range';
            if (status === 'borderline_low' || status === 'borderline_high') flagged = 'borderline';
            else if (status === 'out_of_range_low' || status === 'out_of_range_high') flagged = 'out_of_range';
            else if (status === 'unknown') flagged = 'unknown';
            return {
              lab_report_id: createdReportId!,
              name: slug,
              value: item.value_numeric,
              raw_value_text: item.value_text ?? null,
              unit: item._normalized_unit ?? item.unit ?? '',
              reference_min: item.normalized_reference_min ?? null,
              reference_max: item.normalized_reference_max ?? null,
              flagged,
            };
          });

          const { error: biomarkerError } = await supabase
            .from('biomarkers')
            .insert(biomarkerInserts);

          if (biomarkerError) {
            console.error('[NewReport] Biomarkers save failed:', biomarkerError);
          }
        }
        console.log(`[NewReport] Core biomarkers to save: ${coreItems.length}`);

        // B. Resolving Analyte IDs
        const analyteIdBySlug = new Map<string, string>();
        for (const a of reportAnalytes) {
          if (a.canonical_slug && a.canonical_analyte_id) {
            analyteIdBySlug.set(a.canonical_slug, a.canonical_analyte_id);
          }
        }
        const missingSlugs = [...new Set(itemsToSave.map(i => i.canonical_slug).filter((s): s is string => !!s && !analyteIdBySlug.has(s)))];
        if (missingSlugs.length > 0) {
          const { data: caRows } = await supabase.from('canonical_analytes' as any).select('id, slug').in('slug', missingSlugs);
          if (caRows) caRows.forEach((row: any) => analyteIdBySlug.set(row.slug, row.id));
        }

        // C. Bulk Analyte Insert (traceability table — preserves both raw and canonical)
        const analyteInserts = itemsToSave.map(item => {
          const slug = item.canonical_slug ?? null;
          const canonicalAnalyteId = slug ? (analyteIdBySlug.get(slug) ?? null) : null;
          const isMapped = item.normalization_status === 'mapped';
          return {
            lab_report_id: createdReportId!,
            raw_name: item.raw_biomarker_name ?? item.raw_name,
            raw_value_text: item.value_text ?? null,
            value_numeric: item.value_numeric,
            unit: item._normalized_unit ?? item.unit ?? null,
            raw_reference_range: item.raw_reference_range ?? null,
            normalized_min: item.normalized_reference_min ?? null,
            normalized_max: item.normalized_reference_max ?? null,
            normalized_operator: item.reference_operator ?? null,
            normalized_operator_value: item.reference_operator_value ?? null,
            source_snippet: item.source_snippet ?? null,
            confidence_score: item.confidence_score ?? 'low',
            canonical_analyte_id: canonicalAnalyteId,
            canonical_slug: slug,
            parse_status: isMapped ? (canonicalAnalyteId ? 'mapped' : 'partial') : 'unmapped',
            needs_review: item.needs_review ?? false,
            is_core: item.is_core_biomarker ?? false,
            display_name: item._display_name ?? null,
            system_category: item._system_category ?? null,
            normalization_status: item.normalization_status ?? 'unmapped',
            source_format: item.source_format ?? 'unknown',
            parser_version: item.parser_version ?? 'v1_manual',
            unit_original: item.unit_original ?? item.unit,
            unit_normalized: item._normalized_unit ?? item.unit_normalized ?? item.unit,
            review_status: item.review_status ?? 'pending',
            reviewed_by_user: item.reviewed_by_user ?? false,
          };
        });

        const { error: analyteError } = await supabase.from('report_analytes').insert(analyteInserts);
        
        if (analyteError) {
          // Narrow detection: PGRST104 / 42703 (undefined_column) suggests the DB hasn't been migrated yet
          const isMissingColumn = 
            analyteError.code === '42703' || 
            analyteError.message.includes('column') || 
            analyteError.message.includes('schema cache');
          
          if (isMissingColumn) {
            // Update report record to reflect Compatibility Mode
            console.warn('[NewReport] Submission Compatibility Mode Triggered:');
            console.warn('  - Reason: Missing telemetry columns in report_analytes (requires SQL migration).');
            console.warn('  - Omitted fields: source_format, parser_version, unit_original, unit_normalized, review_status, reviewed_by_user, display_name, system_category, normalization_status');

            await supabase.from('lab_reports').update({
              context: { ...context, submission_mode: 'compatibility' }
            }).eq('id', createdReportId);

            // Retry with ONLY the original, mature columns
            const safeInserts = analyteInserts.map(item => {
              const {
                source_format, parser_version, unit_original,
                unit_normalized, review_status, reviewed_by_user,
                display_name, system_category, normalization_status,
                ...safeData
              } = item as any;
              return safeData;
            });

            const { error: retryError } = await supabase.from('report_analytes').insert(safeInserts);
            if (retryError) {
              console.error('[NewReport] Submission failed even in Compatibility Mode:', retryError);
              throw new Error(`Report creation failed: ${retryError.message}`);
            }
            console.log('[NewReport] Submission success (Compatibility Mode). All core data saved.');
          } else {
            // If it's a different error (RLS, validation, etc.), do NOT fallback. 
            // We want to see the real failure.
            console.error('[NewReport] Analyte save failed (primary path):', analyteError);
            throw new Error(`Failed to save lab items: ${analyteError.message}`);
          }
        } else {
          console.log('[NewReport] Step: Saving analytes success (Primary Path)');
        }
      }

      // 5. Interpretation (Non-blocking)
      console.log('[NewReport] Step: Triggering interpretation (async)');
      setSubmitStep('interpreting');
      supabase.functions.invoke('generate-interpretation', {
        body: { reportId: createdReportId },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }).then(({ error: interpError }) => {
        if (interpError) console.warn('[NewReport] Interpretation failed background:', interpError.message);
      }).catch(e => console.error('[NewReport] Interpretation error background:', e));

      // FINAL REDIRECT
      console.log('[NewReport] Submission complete. Redirecting...');
      setSubmitStep('complete');
      
      // Update report status to ready (since interpreting is background)
      await supabase.from('lab_reports').update({ status: 'ready' }).eq('id', createdReportId);

      setTimeout(() => {
        if (isSecondReport) {
          sessionStorage.setItem('showSecondLabComparison', 'true');
          window.location.href = '/app/tracker';
        } else {
          window.location.href = `/app/reports/${createdReportId}`;
        }
      }, 500);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      console.error('[NewReport] Submission failed at step:', submitStep, '-', msg);
      setError(msg);
      setLoading(false);
      setStep(3); // Go back to review so they can try again or fix
      setSubmitStep(null);
      
      // OPTIONAL: If report row was created but everything else failed, mark as error
      if (createdReportId) {
        supabase.from('lab_reports').update({ status: 'error' }).eq('id', createdReportId);
      }
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
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Last period start date <span className="text-gray-400 font-normal">(optional)</span></label>
                  {fetchingPeriod && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Loader2 className="w-3 h-3 animate-spin" /> Looking up tracker...
                    </span>
                  )}
                  {periodAutoFilled && !fetchingPeriod && (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <CheckCircle className="w-3 h-3" /> Auto-filled from tracker
                    </span>
                  )}
                </div>
                <input
                  type="date"
                  value={lastPeriodDate}
                  onChange={e => { setLastPeriodDate(e.target.value); setPeriodAutoFilled(false); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C97C8B]/30 focus:border-[#C97C8B] text-gray-900"
                />
                {!lastPeriodDate && !fetchingPeriod && (
                  <p className="mt-1 text-xs text-gray-400">No period start logged in your tracker — you can enter it manually above</p>
                )}
              </div>

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
                  setReportItems(prev => {
                    const updated = [...prev];
                    updated[index] = { ...updated[index], [field]: value } as ReportItem;
                    return updated;
                  });
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
                  source_snippet: 'Manually added',
                  source_format: 'manual',
                  review_status: 'pending',
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

        {step === 4 && (
          <Card className="py-16 text-center">
            <div className="flex flex-col items-center justify-center space-y-6">
              <div className="relative">
                <div className="w-20 h-20 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <CheckCircle className={`w-10 h-10 transition-all duration-1000 ${submitStep === 'complete' ? 'text-teal-600 opacity-100 scale-100' : 'text-gray-200 opacity-0 scale-50'}`} />
                </div>
              </div>
              
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-gray-900">
                  {submitStep === 'complete' ? 'All Done!' : 'Processing Your Report'}
                </h2>
                <p className="text-gray-500 max-w-sm mx-auto">
                  {submitStep === 'uploading' && 'Uploading your files...'}
                  {submitStep === 'creating' && 'Creating your report record...'}
                  {submitStep === 'saving' && 'Standardizing your biomarkers...'}
                  {submitStep === 'interpreting' && 'Generating your insights...'}
                  {submitStep === 'complete' && 'Taking you to your results...'}
                </p>
              </div>

              <div className="w-full max-w-xs bg-gray-100 h-1.5 rounded-full overflow-hidden mt-8">
                <div 
                  className="bg-teal-600 h-full transition-all duration-1000 ease-out" 
                  style={{ 
                    width: 
                      submitStep === 'uploading' ? '25%' : 
                      submitStep === 'creating' ? '50%' : 
                      submitStep === 'saving' ? '75%' : 
                      submitStep === 'interpreting' ? '90%' : 
                      submitStep === 'complete' ? '100%' : '5%' 
                  }} 
                />
              </div>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}
