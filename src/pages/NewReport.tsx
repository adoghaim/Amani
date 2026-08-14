import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ReviewBiomarkers } from '../components/ReviewBiomarkers';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { useAuth } from '../contexts/AuthContext';
import { checkSubscriptionLive, handle402 } from '../utils/subscription';
import type { Symptom, LabReportContext, BiomarkerName, LabSource, ImportMethod } from '../types';
import type { ReportItem, ParserDebugOutput } from '../utils/biomarkerParser';
import { extractTextFromPDF, convertPDFToImages } from '../utils/pdfExtractor';
import { parseAllReportItemsWithDebug } from '../utils/biomarkerParser';
import { extractCycleContextFromText, type ExtractedCycleContext } from '../utils/parser/cycleContext';
import { normalizeReportItems } from '../lib/biomarkers/normalizeReportItems';
import { computeAmaniStatus } from '../lib/scoring/scoreBiomarker';
import { detectLabSource } from '../utils/detectLabSource';
import { isNative, captureLabPhoto, getNetworkStatus, onNetworkChange } from '../lib/native';
import {
  Upload, ArrowRight, ArrowLeft, Loader2, AlertTriangle, CheckCircle,
  ExternalLink, FlaskConical, ChevronRight, ChevronDown, ChevronUp,
  Calendar, Activity, Shield, Camera, WifiOff,
} from 'lucide-react';

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

type GuidedStep = 'choose' | 'instructions' | 'upload';

export function NewReport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const submittingRef = useRef(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [aiRefining, setAiRefining] = useState(false);
  const [error, setError] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [cameraCapturing, setCameraCapturing] = useState(false);

  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const [file, setFile] = useState<File | null>(null);
  const [reportDate, setReportDate] = useState(todayIso);
  const [lastPeriodDate, setLastPeriodDate] = useState('');
  const cycleLength = '28';
  const birthControl = 'unsure' as const;
  const pregnant = 'unsure' as const;
  const postpartum = 'unsure' as const;
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);
  const [coverage, setCoverage] = useState<{ total_detected: number; total_core: number; total_extended: number; needs_review: number } | null>(null);
  const [parserDebug, setParserDebug] = useState<ParserDebugOutput | null>(null);
  const [periodAutoFilled, setPeriodAutoFilled] = useState(false);
  const [fetchingPeriod, setFetchingPeriod] = useState(false);
  const [submitStep, setSubmitStep] = useState<'uploading' | 'creating' | 'saving' | 'interpreting' | 'complete' | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const navigationDoneRef = useRef(false);

  const [labSource, setLabSource] = useState<LabSource>('unknown');
  const [detectedLabSource, setDetectedLabSource] = useState<LabSource>('unknown');
  const [importMethod, setImportMethod] = useState<ImportMethod>('direct_upload');
  const [guidedStep, setGuidedStep] = useState<GuidedStep | null>(null);
  const [chosenLab, setChosenLab] = useState<'quest' | 'labcorp' | null>(null);
  const [markerPreviewOpen, setMarkerPreviewOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const userEditedReportItemsRef = useRef(false);
  const userEditedPeriodRef = useRef(false);
  const extractionRunRef = useRef(0);
  // Cycle metadata extracted from the PDF/OCR itself. When non-null, it wins
  // over the calculated fallback derived from reportDate + lastPeriodDate.
  const parsedCycleRef = useRef<ExtractedCycleContext | null>(null);
  const [subChecked, setSubChecked] = useState(false);

  // Defense-in-depth: re-check subscription before rendering the upload UI.
  // SubscriptionGate in App.tsx is the primary guard; this is the fallback.
  useEffect(() => {
    let cancelled = false;
    checkSubscriptionLive().then(result => {
      if (cancelled) return;
      if (!result.allowed) navigate(result.redirectTo, { replace: true });
      else setSubChecked(true);
    }).catch(() => {
      if (!cancelled) navigate('/pricing', { replace: true });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetExtractionState = () => {
    extractionRunRef.current += 1;
    userEditedReportItemsRef.current = false;
    parsedCycleRef.current = null;
    setReportItems([]);
    setCoverage(null);
    setParserDebug(null);
    setDetectedLabSource('unknown');
    setAiRefining(false);
    setExtracting(false);
  };

  const applyExtractedItems = (items: ReportItem[], runId: number) => {
    if (runId !== extractionRunRef.current || !items || items.length === 0 || userEditedReportItemsRef.current) return;

    setReportItems(items);
    setCoverage({
      total_detected: items.length,
      total_core: items.filter(i => i.is_core_biomarker).length,
      total_extended: items.filter(i => !i.is_core_biomarker).length,
      needs_review: items.filter(i => i.needs_review).length,
    });
  };

  useEffect(() => {
    if (pendingNavigation && !navigationDoneRef.current) {
      navigationDoneRef.current = true;
      navigate(pendingNavigation);
    }
  }, [pendingNavigation]);

  // Network awareness — show offline banner to prevent confusing upload failures
  useEffect(() => {
    getNetworkStatus().then(s => setIsOffline(!s.connected));
    return onNetworkChange(s => setIsOffline(!s.connected));
  }, []);

  useEffect(() => {
    const fetchMostRecentPeriodStart = async () => {
      if (!user || !reportDate) return;
      if (userEditedPeriodRef.current) return;
      setFetchingPeriod(true);
      try {
        const { data: log } = await supabase
          .from('period_logs')
          .select('start_date')
          .eq('user_id', user.id)
          .lte('start_date', reportDate)
          .order('start_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (log?.start_date) {
          setLastPeriodDate(log.start_date);
          setPeriodAutoFilled(true);
        } else {
          setLastPeriodDate('');
          setPeriodAutoFilled(false);
        }
      } catch (err) {
        console.warn('[NewReport] Failed to fetch recent period log:', err);
      }
      setFetchingPeriod(false);
    };
    fetchMostRecentPeriodStart();
  }, [reportDate, user]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (validTypes.includes(selectedFile.type)) {
        resetExtractionState();
        setFile(selectedFile);
        setError('');
      } else {
        setError('Please upload a PDF or image file (JPG, PNG)');
      }
    }
  };

  const handleCameraCapture = async () => {
    setCameraCapturing(true);
    setError('');
    try {
      const result = await captureLabPhoto();
      if (!result.ok) {
        if (!result.cancelled) setError(result.error || 'Camera capture failed');
        return;
      }
      // Convert data-URL to a File so it flows through the existing pipeline
      const res = await fetch(result.base64);
      const blob = await res.blob();
      const captured = new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
      resetExtractionState();
      setFile(captured);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Camera capture failed'));
    } finally {
      setCameraCapturing(false);
    }
  };

  const extractDateFromText = (text: string): string | null => {
    const patterns = [
      /(?:collection|collected|report|specimen|date of service|test date|draw date|lab date)[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /(?:collection|collected|report|specimen|date of service|test date|draw date|lab date)[:\s]+(\d{4}-\d{2}-\d{2})/i,
      /(?:collection|collected|report|specimen|date of service|test date|draw date|lab date)[:\s]+([A-Z][a-z]+ \d{1,2},? \d{4})/i,
      /(?:collection|collected|report|specimen|date of service|test date|draw date|lab date)[:\s]+(\d{1,2}-[A-Z][a-z]+-\d{4})/i,
      /\bDate(?:\s+of(?:\s+Service)?)?[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /\bDate[:\s]+(\d{4}-\d{2}-\d{2})/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] !== undefined) {
        const raw = match[1];
        const parsed = new Date(raw);
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2000 && parsed.getFullYear() <= new Date().getFullYear() + 1) {
          const y = parsed.getFullYear();
          const m = String(parsed.getMonth() + 1).padStart(2, '0');
          const d = String(parsed.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
      }
    }
    return null;
  };

  const handleProceedFromStep1 = async () => {
    if (!file) return;

    const runId = extractionRunRef.current;
    setStep(2);
    setExtracting(true);
    setError('');

    try {
      if (file.type === 'application/pdf') {
        const text = await extractTextFromPDF(file);

        if (text.trim().length > 0) {
          const detected = extractDateFromText(text);
          if (detected) {
            setReportDate(detected);
          }
          const parsedCycle = extractCycleContextFromText(text);
          if (parsedCycle.cycleDay !== null || parsedCycle.cyclePhase !== null) {
            parsedCycleRef.current = parsedCycle;
          }
        }

        const src = detectLabSource(text);
        setDetectedLabSource(src);
        if (labSource === 'unknown' && src !== 'unknown') {
          setLabSource(src);
        }

        const { items: localItems, debug: debugOut, heuristics } = parseAllReportItemsWithDebug(text, file.name);
        setParserDebug(debugOut);

        if (text.trim().length === 0 || localItems.length === 0) {
          void startPdfOcrFallback(file, runId);
        } else {
          applyExtractedItems(localItems, runId);

          if (heuristics.isWeak) {
            void startPdfOcrFallback(file, runId);
          } else {
            const gate = shouldRefineWithAI(localItems, src);
            console.log('[NewReport] AI refinement gate:', { ...gate, itemCount: localItems.length, detectedSource: src });
            if (gate.call) {
              void triggerAiRefinement(text, runId);
            }
            // else: pure client parser result — no AI call, no cost, no failure surface
          }
        }
      } else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        void callOcrFallback([base64], runId);
      }
    } catch (err) {
      console.error('[NewReport] Extraction failed:', err);
      setError('Failed to extract data. You can enter items manually.');
    } finally {
      if (runId === extractionRunRef.current) setExtracting(false);
    }
  };

  const startPdfOcrFallback = async (pdfFile: File, runId: number) => {
    if (runId !== extractionRunRef.current) return;
    setAiRefining(true);
    try {
      const images = await convertPDFToImages(pdfFile);
      await callOcrFallback(images, runId);
    } catch (err) {
      console.warn('[NewReport] Background OCR fallback failed:', err);
      if (runId === extractionRunRef.current) {
        setError('OCR extraction failed. You can enter items manually.');
      }
    } finally {
      if (runId === extractionRunRef.current) setAiRefining(false);
    }
  };

  const callOcrFallback = async (base64Images: string[], runId: number) => {
    if (runId !== extractionRunRef.current) return;
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

      if (invokeError) {
        const redirect = await handle402(invokeError);
        if (redirect) { navigate(redirect, { replace: true }); return; }
        throw new Error(`OCR fallback failed: ${invokeError.message}`);
      }

      if (data.items && data.items.length > 0) applyExtractedItems(data.items, runId);

      // Capture cycle metadata from OCR if the text-path didn't already find any.
      // OCR returns metadata.cycle_day / metadata.cycle_phase per the edge function contract.
      if (data?.metadata && parsedCycleRef.current === null && runId === extractionRunRef.current) {
        const rawDay = data.metadata.cycle_day;
        const rawPhase = data.metadata.cycle_phase;
        const cycleDay =
          typeof rawDay === 'number' && Number.isFinite(rawDay) && rawDay >= 1 && rawDay <= 45
            ? Math.trunc(rawDay)
            : null;
        const cyclePhase =
          rawPhase === 'follicular' || rawPhase === 'luteal' ||
          rawPhase === 'ovulatory' || rawPhase === 'menstrual'
            ? rawPhase
            : null;
        if (cycleDay !== null || cyclePhase !== null) {
          parsedCycleRef.current = { cycleDay, cyclePhase };
        }
      }
    } catch (err) {
      console.error('[NewReport] OCR fallback error:', err);
      if (runId === extractionRunRef.current) {
        setError('OCR extraction failed. Falling back to manual entry.');
      }
    } finally {
      if (runId === extractionRunRef.current) setAiRefining(false);
    }
  };

  // Decide whether the AI refinement pass is worth calling. AI is a net for
  // reports the client parser struggles with; when everything parsed cleanly,
  // skip it to save cost/latency and avoid the extract-biomarkers 500 pattern
  // triggered by slow OpenAI calls hitting Supabase runtime limits.
  const shouldRefineWithAI = (
    items: Array<{ confidence_score?: string; needs_review?: boolean; parse_status?: string }>,
    detectedSource: string,
  ): { call: boolean; reason: string } => {
    if (items.length < 10) return { call: true, reason: 'low_item_count' };
    if (items.some(i => i.needs_review === true)) return { call: true, reason: 'needs_review' };
    if (items.some(i => i.confidence_score === 'low')) return { call: true, reason: 'low_confidence' };
    if (items.some(i => i.parse_status === 'parse_error')) return { call: true, reason: 'parse_error' };
    if (items.some(i => i.parse_status === 'unmapped')) return { call: true, reason: 'unmapped' };
    if (detectedSource === 'unknown') return { call: true, reason: 'unknown_lab_source' };
    return { call: false, reason: 'all_good' };
  };

  const triggerAiRefinement = async (text: string, runId: number) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!user || !session) return;

    if (runId !== extractionRunRef.current) return;
    setAiRefining(true);

    supabase.functions.invoke('extract-biomarkers', {
      body: { text },
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).then(async ({ data, error: invokeError }) => {
      if (invokeError) {
        const redirect = await handle402(invokeError);
        if (redirect) { navigate(redirect, { replace: true }); return; }
        console.warn('[NewReport] AI extraction background warning:', invokeError.message);
        return;
      }
      if (runId === extractionRunRef.current && data?.items && data.items.length > 0) {
        applyExtractedItems(data.items, runId);
      }
    }).catch(err => {
      console.error('[NewReport] AI extraction background network error:', err);
    }).finally(() => {
      if (runId === extractionRunRef.current) setAiRefining(false);
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
    setError('');
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
    if (submittingRef.current) return;
    submittingRef.current = true;

    const { data: { session } } = await supabase.auth.getSession();
    if (!user || !session) {
      submittingRef.current = false;
      return;
    }

    setLoading(true);
    setError('');

    let createdReportId: string | null = null;

    try {
      const { data: existingReports } = await supabase
        .from('lab_reports')
        .select('id')
        .eq('user_id', user.id);
      const hasExistingReports = (existingReports ?? []).length >= 1;

      setSubmitStep('uploading');
      let fileUrl = null;
      if (file) {
        const fileExt = file.name.split('.').pop();
        const storagePath = `${user.id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('lab-files')
          .upload(storagePath, file);
        if (uploadError) {
          throw new Error(`File upload failed: ${uploadError.message}`);
        }
        fileUrl = storagePath;
      }

      setSubmitStep('creating');
      const calculatedCycleInfo = calculateCycleInfo();
      const parsedCycle = parsedCycleRef.current;
      // Parser-extracted cycle metadata wins per-field; fall back to the
      // calculated value when the PDF/OCR didn't expose explicit cycle context.
      const cycleDay = parsedCycle?.cycleDay ?? calculatedCycleInfo.cycleDay;
      const cyclePhase = parsedCycle?.cyclePhase ?? calculatedCycleInfo.cyclePhase;
      const context: LabReportContext = {
        birth_control: birthControl,
        pregnant,
        postpartum,
        top_symptoms: symptoms,
        submission_mode: 'standard',
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
          lab_source: labSource,
          import_method: importMethod,
        })
        .select()
        .single();

      if (reportError) {
        throw new Error(`Failed to create report record: ${reportError.message}`);
      }
      createdReportId = reportData.id;

      if (import.meta.env.DEV && parserDebug) {
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

      setSubmitStep('saving');
      const normalized = normalizeReportItems(reportItems);
      const allItemsToSave = normalized.filter(i => {
        const rawName = (i.raw_biomarker_name ?? i.raw_name ?? '').trim();
        const rawValue = (i.value_text ?? '').trim();
        const hasNumeric = i.value_numeric != null;
        return rawName.length > 0 && (hasNumeric || rawValue.length > 0);
      });
      const droppedRows = normalized.filter(i => !allItemsToSave.includes(i));
      if (droppedRows.length > 0) {
        console.warn(
          `[NewReport] Dropped ${droppedRows.length} malformed parsed row(s) from save:`,
          droppedRows.map(r => r.raw_biomarker_name ?? r.raw_name ?? '<missing raw_name>')
        );
      }
      const scorableItemsToSave = allItemsToSave.filter(
        i => i.value_numeric != null && i.value_numeric >= 0 && i.value_numeric <= 100000
      );

      if (allItemsToSave.length > 0) {
        const coreItems = scorableItemsToSave.filter(i => i.is_core_biomarker && i.canonical_slug);
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

        const analyteIdBySlug = new Map<string, string>();
        const slugsToResolve = [...new Set(allItemsToSave.map(i => i.canonical_slug).filter((s): s is string => !!s))];
        if (slugsToResolve.length > 0) {
          const { data: caRows } = await supabase.from('canonical_analytes').select('id, slug').in('slug', slugsToResolve);
          if (caRows) caRows.forEach((row: { id: string; slug: string }) => analyteIdBySlug.set(row.slug, row.id));
        }

        const analyteInserts = allItemsToSave.map(item => {
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
          const isMissingColumn =
            analyteError.code === '42703' ||
            analyteError.message.includes('column') ||
            analyteError.message.includes('schema cache');

          if (isMissingColumn) {
            console.warn('[NewReport] Compatibility Mode triggered');
            await supabase.from('lab_reports').update({
              context: { ...context, submission_mode: 'compatibility' }
            }).eq('id', createdReportId);

            const safeInserts = analyteInserts.map(item => ({
              lab_report_id: item.lab_report_id,
              raw_name: item.raw_name,
              raw_value_text: item.raw_value_text,
              value_numeric: item.value_numeric,
              unit: item.unit,
              raw_reference_range: item.raw_reference_range,
              normalized_min: item.normalized_min,
              normalized_max: item.normalized_max,
              normalized_operator: item.normalized_operator,
              normalized_operator_value: item.normalized_operator_value,
              source_snippet: item.source_snippet,
              confidence_score: item.confidence_score,
              canonical_analyte_id: item.canonical_analyte_id,
              canonical_slug: item.canonical_slug,
              parse_status: item.parse_status,
              needs_review: item.needs_review,
              is_core: item.is_core,
            }));

            const { error: retryError } = await supabase.from('report_analytes').insert(safeInserts);
            if (retryError) {
              throw new Error(`Report creation failed: ${retryError.message}`);
            }
          } else {
            throw new Error(`Failed to save lab items: ${analyteError.message}`);
          }
        }
      }

      setStep(4);
      setSubmitStep('interpreting');
      supabase.functions.invoke('generate-interpretation', {
        body: { reportId: createdReportId },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }).then(async ({ error: interpError }) => {
        if (interpError) {
          const redirect = await handle402(interpError);
          if (redirect) { navigate(redirect, { replace: true }); return; }
          supabase.from('lab_reports').update({ status: 'ready' }).eq('id', createdReportId);
        }
      }).catch(() => {
        supabase.from('lab_reports').update({ status: 'ready' }).eq('id', createdReportId);
      });

      setSubmitStep('complete');

      if (hasExistingReports) {
        sessionStorage.setItem('showSecondLabComparison', 'true');
      }
      setPendingNavigation(`/app/reports/${createdReportId}`);

    } catch (err) {
      const msg = errorMessage(err, 'An error occurred');
      setError(msg);
      setLoading(false);
      setStep(3);
      setSubmitStep(null);
      submittingRef.current = false;

      if (createdReportId) {
        supabase.from('lab_reports').update({ status: 'error' }).eq('id', createdReportId);
      }
    }
  };

  const startGuidedImport = (lab: 'quest' | 'labcorp') => {
    setChosenLab(lab);
    setLabSource(lab);
    setImportMethod('guided_portal_pdf');
    setGuidedStep('instructions');
  };

  const handleGuidedUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (validTypes.includes(selectedFile.type)) {
        resetExtractionState();
        setFile(selectedFile);
        setError('');
        setGuidedStep(null);
      } else {
        setError('Please upload a PDF or image file (JPG, PNG)');
      }
    }
  };

  const canProceedStep1 = !!file;

  const questPortalUrl = 'https://myquest.questdiagnostics.com/';
  const labcorpPortalUrl = 'https://patient.labcorp.com/';

  const effectiveSource = labSource !== 'unknown' ? labSource : detectedLabSource;

  const analysisConfidence = (() => {
    if (!coverage) return null;
    const { total_detected, needs_review } = coverage;
    if (total_detected === 0) return null;
    const reviewRatio = needs_review / total_detected;
    if (reviewRatio < 0.1) return 'High';
    if (reviewRatio < 0.3) return 'Medium';
    return 'Low';
  })();

  const confidenceColors = {
    High: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    Medium: 'text-amber-700 bg-amber-50 border-amber-200',
    Low: 'text-red-700 bg-red-50 border-red-200',
  };

  if (!subChecked) return null;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">New Lab Report</h1>

        <div className="flex flex-col items-center mb-8 gap-3">
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
          {(extracting || aiRefining) && (
            <div className="flex items-center gap-2 text-sm text-theme-primary font-medium animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" />
              {extracting ? 'Reading your report…' : 'Refining with AI…'}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* ── STEP 1: Upload ─────────────────────────────────────────────── */}
        {step === 1 && !guidedStep && (
          <Card>
            <h2 className="text-2xl font-semibold text-gray-900 mb-1">Upload your official report</h2>
            <p className="text-sm text-gray-500 mb-6">Import directly from your lab portal, or upload any PDF or image.</p>

            {/* Offline banner */}
            {isOffline && (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl mb-4 text-sm">
                <WifiOff className="w-4 h-4 shrink-0" />
                <span>You're offline. Connect to the internet before uploading your report.</span>
              </div>
            )}

            <div className="space-y-6">

              {/* Lab portal import options */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Import from a lab portal</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => startGuidedImport('quest')}
                    className="group relative flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/50 transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-100 transition-colors">
                      <FlaskConical className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">Import from Quest</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">Upload an official report from MyQuest</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-emerald-500 flex-shrink-0" />
                  </button>

                  <button
                    onClick={() => startGuidedImport('labcorp')}
                    className="group relative flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-sky-400 hover:bg-sky-50/50 transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0 group-hover:bg-sky-100 transition-colors">
                      <FlaskConical className="w-5 h-5 text-sky-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">Import from Labcorp</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">Upload an official report from Labcorp Patient</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-sky-500 flex-shrink-0" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">or upload any file</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              {/* Generic file upload */}
              <div>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileChange}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className={`flex flex-col items-center justify-center gap-3 w-full min-h-[140px] rounded-xl border-2 border-dashed cursor-pointer transition-all active:scale-[0.98] select-none
                    ${file
                      ? 'border-emerald-400 bg-emerald-50/60'
                      : 'border-gray-300 hover:border-theme-primary hover:bg-theme-background/60'
                    }`}
                >
                  {file ? (
                    <>
                      <CheckCircle className="w-9 h-9 text-emerald-500" />
                      <span className="text-sm font-semibold text-emerald-700 text-center px-4 break-all line-clamp-2">{file.name}</span>
                      <span className="text-xs text-emerald-600">Tap to choose a different file</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-9 h-9 text-gray-400" />
                      <div className="text-center px-4">
                        <p className="text-sm font-medium text-gray-700">
                          <span className="text-theme-primary">Choose a file</span>
                          <span className="hidden sm:inline"> or drag and drop</span>
                        </p>
                        <p className="text-xs text-gray-400 mt-1">PDF, JPG, or PNG</p>
                      </div>
                    </>
                  )}
                </label>

                {/* Camera capture — native only */}
                {isNative() && (
                  <button
                    type="button"
                    onClick={handleCameraCapture}
                    disabled={cameraCapturing}
                    className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 active:scale-[0.98] transition-all text-sm font-medium text-gray-700 disabled:opacity-50"
                  >
                    {cameraCapturing
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Opening camera…</>
                      : <><Camera className="w-4 h-4 text-gray-500" />Scan with Camera</>
                    }
                  </button>
                )}
              </div>

              <div className="flex justify-end">
                <Button onClick={handleProceedFromStep1} disabled={!canProceedStep1 || extracting || isOffline}>
                  {extracting ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Reading your report...</>
                  ) : (
                    <>Next<ArrowRight className="w-5 h-5 ml-2" /></>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ── GUIDED: Choose source ───────────────────────────────────────── */}
        {step === 1 && guidedStep === 'choose' && (
          <Card>
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-gray-900 mb-1">Import your lab results</h2>
              <p className="text-sm text-gray-500">Bring in an official report from your lab portal.</p>
            </div>

            <div className="space-y-3 mb-8">
              <button
                onClick={() => startGuidedImport('quest')}
                className="group w-full flex items-center gap-4 p-5 rounded-xl border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/50 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <FlaskConical className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">Quest Diagnostics</p>
                  <p className="text-sm text-gray-500 mt-0.5">Import from MyQuest portal</p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-emerald-500 transition-colors" />
              </button>

              <button
                onClick={() => startGuidedImport('labcorp')}
                className="group w-full flex items-center gap-4 p-5 rounded-xl border-2 border-gray-200 hover:border-sky-400 hover:bg-sky-50/50 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <FlaskConical className="w-6 h-6 text-sky-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">Labcorp</p>
                  <p className="text-sm text-gray-500 mt-0.5">Import from Labcorp Patient portal</p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-sky-500 transition-colors" />
              </button>
            </div>

            <button
              onClick={() => setGuidedStep(null)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </Card>
        )}

        {/* ── GUIDED: Instructions ────────────────────────────────────────── */}
        {step === 1 && guidedStep === 'instructions' && chosenLab && (
          <Card>
            {chosenLab === 'quest' ? (
              <>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <FlaskConical className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Import from Quest</h2>
                    <p className="text-sm text-gray-500 mt-0.5">Follow the steps below, then upload your PDF here</p>
                  </div>
                </div>

                <ol className="space-y-4 mb-8">
                  {[
                    { num: 1, text: 'Open MyQuest in your browser or app' },
                    { num: 2, text: 'Find the report you want to import' },
                    { num: 3, text: 'Download the official PDF report' },
                    { num: 4, text: 'Come back here and upload it below' },
                  ].map(step => (
                    <li key={step.num} className="flex items-start gap-4">
                      <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step.num}</span>
                      <span className="text-sm text-gray-700 pt-1">{step.text}</span>
                    </li>
                  ))}
                </ol>

                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href={questPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border-2 border-emerald-300 text-emerald-700 text-sm font-semibold hover:bg-emerald-50 transition-colors"
                  >
                    Open MyQuest <ExternalLink className="w-4 h-4" />
                  </a>

                  <label className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-theme-primary text-white text-sm font-semibold hover:bg-theme-primary-dark transition-colors cursor-pointer">
                    <Upload className="w-4 h-4" />
                    Upload Quest PDF
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={handleGuidedUploadFile}
                      className="hidden"
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                    <FlaskConical className="w-6 h-6 text-sky-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Import from Labcorp</h2>
                    <p className="text-sm text-gray-500 mt-0.5">Follow the steps below, then upload your PDF here</p>
                  </div>
                </div>

                <ol className="space-y-4 mb-8">
                  {[
                    { num: 1, text: 'Open Labcorp Patient in your browser or app' },
                    { num: 2, text: 'Find the report you want to import' },
                    { num: 3, text: 'Download the official report PDF' },
                    { num: 4, text: 'Return here and upload it below' },
                  ].map(step => (
                    <li key={step.num} className="flex items-start gap-4">
                      <span className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step.num}</span>
                      <span className="text-sm text-gray-700 pt-1">{step.text}</span>
                    </li>
                  ))}
                </ol>

                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href={labcorpPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border-2 border-sky-300 text-sky-700 text-sm font-semibold hover:bg-sky-50 transition-colors"
                  >
                    Open Labcorp <ExternalLink className="w-4 h-4" />
                  </a>

                  <label className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-theme-primary text-white text-sm font-semibold hover:bg-theme-primary-dark transition-colors cursor-pointer">
                    <Upload className="w-4 h-4" />
                    Upload Labcorp PDF
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={handleGuidedUploadFile}
                      className="hidden"
                    />
                  </label>
                </div>
              </>
            )}

            <div className="mt-6 pt-5 border-t border-gray-100">
              <button
                onClick={() => setGuidedStep('choose')}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            </div>
          </Card>
        )}

        {/* Show selected file + proceed button after guided upload */}
        {step === 1 && guidedStep === null && file && chosenLab && (
          <div className="mt-4">
          </div>
        )}

        {/* ── STEP 2: Amani Understanding (Smart Review) ──────────────────── */}
        {step === 2 && (
          <div className="space-y-4">

            {/* ── Section 1: Amani Understanding ─────────────────────────── */}
            <Card>
              <div className="mb-5">
                <h2 className="text-2xl font-semibold text-gray-900 mb-1">Review your report</h2>
                <p className="text-sm text-gray-500">
                  We extracted your report details automatically — review anything below before saving.
                </p>
              </div>

              {/* Source + detection message */}
              {effectiveSource !== 'unknown' ? (
                <div className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border mb-5 ${
                  effectiveSource === 'quest' ? 'bg-emerald-50 border-emerald-200' : 'bg-sky-50 border-sky-200'
                }`}>
                  <FlaskConical className={`w-4 h-4 flex-shrink-0 mt-0.5 ${effectiveSource === 'quest' ? 'text-emerald-600' : 'text-sky-600'}`} />
                  <div>
                    <p className={`text-sm font-semibold ${effectiveSource === 'quest' ? 'text-emerald-800' : 'text-sky-800'}`}>
                      {detectedLabSource !== 'unknown' && labSource === detectedLabSource
                        ? `We detected this as a ${effectiveSource === 'quest' ? 'Quest' : 'Labcorp'} report and extracted your results automatically`
                        : `Imported from ${effectiveSource === 'quest' ? 'Quest' : 'Labcorp'}`}
                    </p>
                    <p className={`text-xs mt-0.5 ${effectiveSource === 'quest' ? 'text-emerald-600' : 'text-sky-600'}`}>
                      {detectedLabSource !== 'unknown' ? 'Detected from report' : 'Selected by you'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-gray-50 mb-5">
                  <CheckCircle className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-600 font-medium">We extracted your report details automatically — review anything below before saving</p>
                </div>
              )}

              {/* Report date */}
              <div className="mb-5">
                <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 mb-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  Report date
                </label>
                <input
                  type="date"
                  value={reportDate}
                  onChange={e => setReportDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C97C8B]/30 focus:border-[#C97C8B] text-gray-900"
                />
                <p className="mt-1 text-xs text-gray-400">Change this if you're backlogging an older report — last period start will re-sync from your tracker</p>
              </div>

              {/* Marker count + confidence row */}
              {coverage && (
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 bg-gray-50">
                    <Activity className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-gray-900">
                        {coverage.total_detected} marker{coverage.total_detected !== 1 ? 's' : ''} detected
                      </p>
                      {coverage.needs_review > 0 && (
                        <p className="text-xs text-amber-600 mt-0.5">{coverage.needs_review} may need review</p>
                      )}
                    </div>
                  </div>
                  {analysisConfidence && (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${confidenceColors[analysisConfidence as keyof typeof confidenceColors]}`}>
                      <Shield className="w-4 h-4 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-bold">Confidence: {analysisConfidence}</p>
                        <p className="text-xs mt-0.5 opacity-75">Based on report clarity</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Partial parse warning */}
              {coverage && coverage.needs_review > 0 && (
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 mb-5">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    We couldn't fully read {coverage.needs_review} item{coverage.needs_review !== 1 ? 's' : ''} — you can still continue, Amani will use what it understood
                  </p>
                </div>
              )}

              {/* Expandable marker preview */}
              {reportItems.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden mb-2">
                  <button
                    onClick={() => setMarkerPreviewOpen(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                  >
                    <span className="text-sm font-semibold text-gray-700">View detected markers</span>
                    <span className="flex items-center gap-1.5 text-xs text-gray-400">
                      {reportItems.length} markers
                      {markerPreviewOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                  {markerPreviewOpen && (
                    <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                      {reportItems.map((item, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                          <span className="text-sm text-gray-800 font-medium truncate max-w-[60%]">{item.raw_name}</span>
                          <span className="text-sm text-gray-500 ml-2 flex-shrink-0">
                            {item.value_text && (item.value_numeric == null || item.value_numeric === 0)
                              ? item.value_text
                              : item.value_numeric != null
                                ? `${item.value_numeric}${item.unit ? ' ' + item.unit : ''}`
                                : item.value_text || '—'}
                            {item.needs_review && (
                              <span className="ml-1.5 text-xs text-amber-500 font-medium">review</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {aiRefining && (
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  AI is refining extracted values in the background...
                </div>
              )}
            </Card>

            {/* ── Section 2: Cycle context + symptoms ──────────────────────── */}
            <Card>
              <div className="space-y-6">
                {/* Cycle context */}
                <div>
                  <div className="mb-3">
                    <h3 className="text-base font-semibold text-gray-900 mb-0.5">
                      Cycle context <span className="text-gray-400 font-normal text-sm">(optional)</span>
                    </h3>
                    <p className="text-xs text-gray-500">This helps Amani interpret your results more accurately</p>
                  </div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700">Last period start</label>
                    {fetchingPeriod && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Loader2 className="w-3 h-3 animate-spin" /> Looking up tracker...
                      </span>
                    )}
                    {periodAutoFilled && !fetchingPeriod && (
                      <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle className="w-3 h-3" /> Auto-filled from your tracker
                      </span>
                    )}
                  </div>
                  <input
                    type="date"
                    value={lastPeriodDate}
                    onChange={e => {
                      setLastPeriodDate(e.target.value);
                      setPeriodAutoFilled(false);
                      userEditedPeriodRef.current = true;
                    }}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C97C8B]/30 focus:border-[#C97C8B] text-gray-900"
                  />
                  {!lastPeriodDate && !fetchingPeriod && (
                    <p className="mt-1 text-xs text-gray-400">Add your last period start date for more accurate insights</p>
                  )}
                </div>

                {/* Divider */}
                <div className="border-t border-gray-100" />

                {/* Symptoms */}
                <div>
                  <div className="mb-3">
                    <h3 className="text-base font-semibold text-gray-900 mb-0.5">
                      Any symptoms? <span className="text-gray-400 font-normal text-sm">(optional)</span>
                    </h3>
                    <p className="text-xs text-gray-500">Select up to 5 — helps personalize your insights</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SYMPTOMS.map(symptom => (
                      <button
                        key={symptom.value}
                        onClick={() => toggleSymptom(symptom.value)}
                        className={`px-3.5 py-1.5 rounded-full border-2 text-sm transition-all ${
                          symptoms.includes(symptom.value)
                            ? 'border-[#C97C8B] bg-[#C97C8B]/10 text-[#C97C8B] font-medium'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                        disabled={!symptoms.includes(symptom.value) && symptoms.length >= 5}
                      >
                        {symptom.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            {/* ── Navigation ───────────────────────────────────────────────── */}
            <div className="flex flex-col gap-3 pb-4">
              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-5 h-5 mr-2" />Back
                </Button>
                <Button onClick={handleProceedToStep3} disabled={extracting}>
                  {extracting ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Reading...</>
                  ) : (
                    <>Next <ArrowRight className="w-5 h-5 ml-2" /></>
                  )}
                </Button>
              </div>
              <p className="text-xs text-center text-gray-400">You can always edit this later</p>
            </div>
          </div>
        )}

        {/* ── STEP 3: Review & Submit ─────────────────────────────────────── */}
        {step === 3 && (
          <Card>
            <div className="mb-5">
              <h2 className="text-2xl font-semibold text-gray-900 mb-1">Confirm your markers</h2>
              <p className="text-sm text-gray-500">Review what Amani found — edit, remove, or add anything before saving.</p>
            </div>

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
                  userEditedReportItemsRef.current = true;
                  setReportItems(prev => {
                    const updated = [...prev];
                    updated[index] = { ...updated[index], [field]: value } as ReportItem;
                    return updated;
                  });
                }}
                onRemove={index => {
                  userEditedReportItemsRef.current = true;
                  setReportItems(reportItems.filter((_, i) => i !== index));
                }}
                onAddNew={() => {
                  userEditedReportItemsRef.current = true;
                  setReportItems([...reportItems, {
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
                  }]);
                }}
              />
            )}

            <div className="flex justify-between pt-6">
              <Button variant="secondary" onClick={() => setStep(2)}>
                <ArrowLeft className="w-5 h-5 mr-2" />Back
              </Button>
              <Button onClick={handleSubmit} disabled={loading || extracting}>
                {loading ? 'Processing...' : extracting ? 'Reading report...' : 'Save and analyze'}
              </Button>
            </div>
          </Card>
        )}

        {/* ── STEP 4: Processing ──────────────────────────────────────────── */}
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
                  {submitStep === 'complete' ? 'Report imported' : "We're reading your report"}
                </h2>
                <p className="text-gray-500 max-w-sm mx-auto">
                  {submitStep === 'uploading' && 'Uploading your file...'}
                  {submitStep === 'creating' && 'Detecting report date...'}
                  {submitStep === 'saving' && 'Extracting lab markers...'}
                  {submitStep === 'interpreting' && 'Organizing your results...'}
                  {submitStep === 'complete' && 'Your results have been added to Amani and are ready to compare with your past reports.'}
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
