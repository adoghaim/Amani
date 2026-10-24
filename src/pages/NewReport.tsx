import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { ReviewBiomarkers } from '../components/ReviewBiomarkers';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { useAuth } from '../contexts/AuthContext';
import { checkSubscriptionLive, handle402 } from '../utils/subscription';
import { clientFreemiumActive } from '../lib/tier';
import { uploadRequiresSubscription } from '../lib/freemium/gates';
import { generateFailureKind } from '../lib/freemium/reportAccess';
import { isAiPausedResponse, noteAiPaused } from '../lib/aiPause';
import { OcrPausedNotice } from '../components/OcrPausedNotice';
import type { Symptom, LabReportContext, BiomarkerName, LabSource, ImportMethod } from '../types';
import type { ReportItem, ParserDebugOutput } from '../utils/biomarkerParser';
import { extractTextFromPDF, convertPDFToImages } from '../utils/pdfExtractor';
import { parseAllReportItemsWithDebug } from '../utils/biomarkerParser';
import { decideAiRefinement } from '../utils/parser/aiRefinementGate';
import { extractCycleContextFromText, type ExtractedCycleContext } from '../utils/parser/cycleContext';
import {
  cycleContextAtDraw, cycleContextToStore, knownCycleLength, parseCycleLengthDays, CYCLE_LENGTH_INPUT_ERROR, CYCLE_LENGTH_INPUT_HINT,
} from '../lib/drawCycleContext';
import { normalizeReportItems, reportItemDisplayName } from '../lib/biomarkers/normalizeReportItems';
import { computeAmaniStatus } from '../lib/scoring/scoreBiomarker';
import { detectLabSource } from '../utils/detectLabSource';
import { extractDateFromText } from '../utils/extractDateFromText';
import { isNative, captureLabPhoto, getNetworkStatus, onNetworkChange } from '../lib/native';
import { firstPartyEvents } from '../lib/firstPartyEventsClient';
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

/*
  Mark a report as terminally failed.

  Two things were wrong with the inline writes this replaces.

  1. They never ran. A PostgREST builder only issues its request when something
     calls `.then()` on it, so a bare `supabase.from(...).update(...).eq(...)`
     statement is dead code. Every un-awaited status write in this file silently
     did nothing, which is why a failed upload sat at 'processing' until
     ReportView's 90s poll timeout gave up and flipped it to 'ready'.

  2. The interpretation failure path wrote 'ready'. The server's catch writes
     'error' for the same event, so the two writers disagreed about one column
     and a failed interpretation could display as a finished report.

  So: write 'error', matching the server, and make it a compare-and-set on
  status = 'processing'. Whatever the edge function wrote always wins — including
  a successful 'ready' the client never saw because the invoke timed out after
  the function had already finished. This only fills in a terminal status when
  the server never got to write one at all.
*/
async function markReportFailed(reportId: string | null): Promise<void> {
  if (!reportId) return;
  const { error } = await supabase
    .from('lab_reports')
    .update({ status: 'error' })
    .eq('id', reportId)
    .eq('status', 'processing');
  if (error) console.error('[NewReport] Failed to mark report as errored:', error);
}

/*
  A 429 is not a failed report, so it must not reach `markReportFailed`.

  `generate-interpretation` returns 429 for "over your daily quota" and
  deliberately leaves `lab_reports.status` untouched: the analytes are parsed
  and saved, only today's AI budget is spent, and the condition clears at
  midnight. Stamping 'error' here would undo that choice on the client and tell
  a user her upload was corrupted.

  Returns the server's message on a 429 and null on anything else. The
  FunctionsHttpError unwrapping mirrors `handle402` in utils/subscription.ts —
  which every call site runs first, and which returns without reading the body
  unless the status is 402, so the response is still unconsumed here.
*/
async function rateLimitMessage(err: unknown): Promise<string | null> {
  if (!(err instanceof FunctionsHttpError)) return null;
  if (err.context?.status !== 429) return null;
  try {
    const body = await (err.context as Response).json() as { error?: string };
    if (typeof body.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    // ignore parse failure
  }
  return 'Daily analysis limit reached. Please try again tomorrow.';
}

/*
  Hand the quota message to ReportView. This page navigates to the report the
  moment the interpretation request is fired, so the 429 lands after it is gone
  and it can no longer render anything. ReportView reads the same key and shows
  the quota notice instead of a generic "AI summary failed".
*/
function noteInterpRateLimit(reportId: string, message: string): void {
  try {
    sessionStorage.setItem(`interpRateLimit:${reportId}`, message);
  } catch {
    // Storage unavailable (private mode) — the notice is a nicety, not a gate.
  }
}

export function NewReport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const submittingRef = useRef(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [aiRefining, setAiRefining] = useState(false);
  /*
    Set when the gate decided the local parse was good enough to skip the model.
    Surfaced in the parser debugger so a skipped refinement is visible rather
    than silent — a silent skip is indistinguishable from a broken call.
  */
  const [aiSkipReason, setAiSkipReason] = useState<string | null>(null);
  const [error, setError] = useState('');
  // PK-FIX-01b (D12, D7): photo reading answered that the AI is paused.
  const [ocrPaused, setOcrPaused] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [cameraCapturing, setCameraCapturing] = useState(false);

  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const [file, setFile] = useState<File | null>(null);
  const [reportDate, setReportDate] = useState(todayIso);
  const [lastPeriodDate, setLastPeriodDate] = useState('');
  // PK-FIX-06: optional typical cycle length. Empty means unknown, which is
  // stored as null rather than as a silent 28. It is auto-filled from the
  // tracker's logged periods when they establish an average, and she can
  // change or clear it.
  const [cycleLengthInput, setCycleLengthInput] = useState('');
  const [cycleLengthAutoFilled, setCycleLengthAutoFilled] = useState(false);
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
  const userEditedCycleLengthRef = useRef(false);
  const extractionRunRef = useRef(0);
  // Cycle metadata printed on the report (her labelled line, or OCR metadata).
  // It fills in only when her dates give no cycle day (F010, cycleContextToStore).
  const parsedCycleRef = useRef<ExtractedCycleContext | null>(null);
  // Flag on, uploading is part of Free and there is nothing to re-check here.
  const [subChecked, setSubChecked] = useState(() => !uploadRequiresSubscription());

  // Defense-in-depth: re-check subscription before rendering the upload UI.
  // SubscriptionGate in App.tsx is the primary guard; this is the fallback.
  useEffect(() => {
    if (!uploadRequiresSubscription()) return;
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
    setAiSkipReason(null);
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

  // PK-FIX-06: pre-fill the typical cycle length only when the tracker's logged
  // periods establish one, by cyclePredictor's averaging rule. Otherwise the
  // field stays empty and the length stays unknown.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const prefillCycleLength = async () => {
      try {
        const { data: logs } = await supabase
          .from('period_logs')
          .select('start_date')
          .eq('user_id', user.id);
        if (cancelled || userEditedCycleLengthRef.current) return;
        // V2-04-C: pass the profile's typical cycle length as `profile` here.
        const known = knownCycleLength({ periodLogs: (logs ?? []) as { start_date: string }[] });
        if (known) {
          setCycleLengthInput(String(known.days));
          setCycleLengthAutoFilled(true);
        }
      } catch (err) {
        console.warn('[NewReport] Failed to fetch period logs for cycle length:', err);
      }
    };
    void prefillCycleLength();
    return () => { cancelled = true; };
  }, [user]);

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

  const handleProceedFromStep1 = async () => {
    if (!file) return;
    // PK-EXP5 funnel step: not awaited; off unless first_party_events is on.
    void firstPartyEvents.track('upload_started');

    const runId = extractionRunRef.current;
    setStep(2);
    setExtracting(true);
    setError('');
    setOcrPaused(false);

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
            /*
              The parser is the primary path and the model is the safety net, so
              only pay for `extract-biomarkers` when the local parse actually
              shows a problem. decideAiRefinement fails open: anything ambiguous
              still refines.
            */
            const decision = decideAiRefinement({
              items: localItems,
              heuristics,
              detectedSource: debugOut.detectedSource,
            });
            if (decision.refine) {
              void triggerAiRefinement(text, runId);
            } else {
              setAiSkipReason(decision.reason);
            }
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

      if (isAiPausedResponse(data)) {
        // Not an error: the owner paused AI processing. Say so calmly; manual entry still works.
        if (runId === extractionRunRef.current) setOcrPaused(true);
        return;
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

  // A typed length that is not a whole number of days within the bounds.
  const cycleLengthInvalid = cycleLengthInput.trim() !== '' && parseCycleLengthDays(cycleLengthInput) === null;

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
      // PK-FIX-06 (owner decision D13): the cycle day for any cycle length. The
      // phase comes from the fixed day map only for an unknown or 28-day
      // typical length, exactly as before; see drawCycleContext.
      const drawCycle = cycleContextAtDraw({
        drawDate: reportDate,
        lastPeriodStart: lastPeriodDate,
        cycleLengthDays: cycleLengthInput,
      });
      // F010: her dates win. A cycle day or phase printed on the report fills in
      // only when her dates give no cycle day, and never overrides D13 (b).
      const { cycleDay, phase: cyclePhase } = cycleContextToStore(drawCycle, parsedCycleRef.current);
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
          // Her known typical length, or null. Never a silent 28.
          average_cycle_length: drawCycle.cycleLengthDays,
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
        // Count only. The names are lifted verbatim off the user's report, so
        // logging them writes biomarker data to the console and, on Capacitor,
        // to the Android device log. The count is what tells you a parse
        // regressed; `/dev/parser/:id` is where you look at which rows.
        console.warn(
          `[NewReport] Dropped ${droppedRows.length} malformed parsed row(s) from save`
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
            // Must throw, like the report_analytes insert below. Swallowing
            // this used to let the upload continue: the report landed in
            // history looking complete, got an AI interpretation over an empty
            // panel, and showed nothing flagged — a user would read that as
            // "my results are normal". Fail loudly so she can retry instead.
            throw new Error(`Failed to save biomarkers: ${biomarkerError.message}`);
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
      void firstPartyEvents.track('report_parsed');
      supabase.functions.invoke('generate-interpretation', {
        body: { reportId: createdReportId },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }).then(async ({ data: interpData, error: interpError }) => {
        // The report screen is usually open by now; it shows the pause notice (DT9).
        if (!interpError && createdReportId) noteAiPaused(createdReportId, isAiPausedResponse(interpData));
        if (interpError) {
          /*
            Flag on, upload completion is never a paywall. But the server has
            refused, so nothing is coming: settle the row now (compare-and-set,
            as below) rather than leave it 'processing' for the report view's
            90 s poll. The report view then reads get-interpretation and, when
            generating is refused again, shows the Premium entry point in place.
          */
          if (clientFreemiumActive() && interpError instanceof FunctionsHttpError
            && generateFailureKind(interpError.context?.status) === 'premium_required') {
            void markReportFailed(createdReportId);
            return;
          }
          const redirect = await handle402(interpError);
          if (redirect) { navigate(redirect, { replace: true }); return; }
          const limitMessage = await rateLimitMessage(interpError);
          if (limitMessage) {
            if (createdReportId) noteInterpRateLimit(createdReportId, limitMessage);
            return;
          }
          void markReportFailed(createdReportId);
        }
      }).catch(() => {
        void markReportFailed(createdReportId);
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

      void markReportFailed(createdReportId);
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
    High: 'text-theme-flag-ok bg-theme-flag-ok-bg border-theme-flag-ok-border',
    Medium: 'text-theme-flag-watch bg-theme-flag-watch-bg border-theme-flag-watch-border',
    Low: 'text-theme-flag-low bg-theme-flag-low-bg border-theme-flag-low-border',
  };

  if (!subChecked) return null;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <PageHeader title="New panel" description="Upload a PDF or a photo. We read it, then place it against your cycle." />

        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="flex items-center">
            {[1, 2, 3].map((s, idx) => (
              <div key={s} className="flex items-center">
                {idx > 0 && <div className={`w-16 h-1 ${step >= s ? 'bg-theme-primary' : 'bg-theme-neutral-300'}`} />}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= s ? 'bg-theme-primary text-white' : 'bg-theme-neutral-200 text-theme-neutral-600'}`}>
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
          <div className="bg-theme-flag-low-bg border border-theme-flag-low-border text-theme-flag-low px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {ocrPaused && <OcrPausedNotice className="mb-6" />}

        {/* ── STEP 1: Upload ─────────────────────────────────────────────── */}
        {step === 1 && !guidedStep && (
          <Card>
            <h2 className="text-2xl text-theme-neutral-900 mb-1">Upload your official report</h2>
            <p className="text-sm text-theme-neutral-500 mb-6">Import directly from your lab portal, or upload any PDF or image.</p>

            {/* Offline banner */}
            {isOffline && (
              <div className="flex items-center gap-3 bg-theme-flag-watch-bg border border-theme-flag-watch-border text-theme-flag-watch px-4 py-3 rounded-xl mb-4 text-sm">
                <WifiOff className="w-4 h-4 shrink-0" />
                <span>You're offline. Connect to the internet before uploading your report.</span>
              </div>
            )}

            <div className="space-y-6">

              {/* Lab portal import options */}
              <div>
                <p className="text-xs font-semibold text-theme-neutral-400 uppercase tracking-wide mb-3">Import from a lab portal</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => startGuidedImport('quest')}
                    className="group relative flex items-center gap-4 p-4 rounded-xl border-2 border-theme-neutral-200 hover:border-theme-flag-ok-border hover:bg-theme-flag-ok-bg/50 transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-lg bg-theme-flag-ok-bg flex items-center justify-center flex-shrink-0 group-hover:bg-theme-flag-ok-bg transition-colors">
                      <FlaskConical className="w-5 h-5 text-theme-flag-ok" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-theme-neutral-900">Import from Quest</p>
                      <p className="text-xs text-theme-neutral-500 mt-0.5 truncate">Upload an official report from MyQuest</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-theme-neutral-400 group-hover:text-theme-flag-ok flex-shrink-0" />
                  </button>

                  <button
                    onClick={() => startGuidedImport('labcorp')}
                    className="group relative flex items-center gap-4 p-4 rounded-xl border-2 border-theme-neutral-200 hover:border-theme-info-border hover:bg-theme-info-bg/50 transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-lg bg-theme-info-bg flex items-center justify-center flex-shrink-0 group-hover:bg-theme-info-bg transition-colors">
                      <FlaskConical className="w-5 h-5 text-theme-info" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-theme-neutral-900">Import from Labcorp</p>
                      <p className="text-xs text-theme-neutral-500 mt-0.5 truncate">Upload an official report from Labcorp Patient</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-theme-neutral-400 group-hover:text-theme-info flex-shrink-0" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-theme-neutral-200" />
                <span className="text-xs text-theme-neutral-400 font-medium">or upload any file</span>
                <div className="flex-1 h-px bg-theme-neutral-200" />
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
                      ? 'border-theme-flag-ok-border bg-theme-flag-ok-bg/60'
                      : 'border-theme-neutral-300 hover:border-theme-primary hover:bg-theme-background/60'
                    }`}
                >
                  {file ? (
                    <>
                      <CheckCircle className="w-9 h-9 text-theme-flag-ok" />
                      <span className="text-sm font-semibold text-theme-flag-ok text-center px-4 break-all line-clamp-2">{file.name}</span>
                      <span className="text-xs text-theme-flag-ok">Tap to choose a different file</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-9 h-9 text-theme-neutral-400" />
                      <div className="text-center px-4">
                        <p className="text-sm font-medium text-theme-neutral-700">
                          <span className="text-theme-primary">Choose a file</span>
                          <span className="hidden sm:inline"> or drag and drop</span>
                        </p>
                        <p className="text-xs text-theme-neutral-400 mt-1">PDF, JPG, or PNG</p>
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
                    className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-theme-neutral-200 bg-theme-neutral-50 hover:bg-theme-neutral-100 active:scale-[0.98] transition-all text-sm font-medium text-theme-neutral-700 disabled:opacity-50"
                  >
                    {cameraCapturing
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Opening camera…</>
                      : <><Camera className="w-4 h-4 text-theme-neutral-500" />Scan with Camera</>
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
              <h2 className="text-2xl text-theme-neutral-900 mb-1">Import your lab results</h2>
              <p className="text-sm text-theme-neutral-500">Bring in an official report from your lab portal.</p>
            </div>

            <div className="space-y-3 mb-8">
              <button
                onClick={() => startGuidedImport('quest')}
                className="group w-full flex items-center gap-4 p-5 rounded-xl border-2 border-theme-neutral-200 hover:border-theme-flag-ok-border hover:bg-theme-flag-ok-bg/50 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-theme-flag-ok-bg flex items-center justify-center flex-shrink-0">
                  <FlaskConical className="w-6 h-6 text-theme-flag-ok" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-theme-neutral-900">Quest Diagnostics</p>
                  <p className="text-sm text-theme-neutral-500 mt-0.5">Import from MyQuest portal</p>
                </div>
                <ChevronRight className="w-5 h-5 text-theme-neutral-400 group-hover:text-theme-flag-ok transition-colors" />
              </button>

              <button
                onClick={() => startGuidedImport('labcorp')}
                className="group w-full flex items-center gap-4 p-5 rounded-xl border-2 border-theme-neutral-200 hover:border-theme-info-border hover:bg-theme-info-bg/50 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-theme-info-bg flex items-center justify-center flex-shrink-0">
                  <FlaskConical className="w-6 h-6 text-theme-info" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-theme-neutral-900">Labcorp</p>
                  <p className="text-sm text-theme-neutral-500 mt-0.5">Import from Labcorp Patient portal</p>
                </div>
                <ChevronRight className="w-5 h-5 text-theme-neutral-400 group-hover:text-theme-info transition-colors" />
              </button>
            </div>

            <button
              onClick={() => setGuidedStep(null)}
              className="flex items-center gap-1.5 text-sm text-theme-neutral-500 hover:text-theme-neutral-700 transition-colors"
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
                  <div className="w-12 h-12 rounded-xl bg-theme-flag-ok-bg flex items-center justify-center flex-shrink-0">
                    <FlaskConical className="w-6 h-6 text-theme-flag-ok" />
                  </div>
                  <div>
                    <h2 className="text-xl text-theme-neutral-900">Import from Quest</h2>
                    <p className="text-sm text-theme-neutral-500 mt-0.5">Follow the steps below, then upload your PDF here</p>
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
                      <span className="w-7 h-7 rounded-full bg-theme-flag-ok-bg text-theme-flag-ok text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step.num}</span>
                      <span className="text-sm text-theme-neutral-700 pt-1">{step.text}</span>
                    </li>
                  ))}
                </ol>

                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href={questPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border-2 border-theme-flag-ok-border text-theme-flag-ok text-sm font-semibold hover:bg-theme-flag-ok-bg transition-colors"
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
                  <div className="w-12 h-12 rounded-xl bg-theme-info-bg flex items-center justify-center flex-shrink-0">
                    <FlaskConical className="w-6 h-6 text-theme-info" />
                  </div>
                  <div>
                    <h2 className="text-xl text-theme-neutral-900">Import from Labcorp</h2>
                    <p className="text-sm text-theme-neutral-500 mt-0.5">Follow the steps below, then upload your PDF here</p>
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
                      <span className="w-7 h-7 rounded-full bg-theme-info-bg text-theme-info text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step.num}</span>
                      <span className="text-sm text-theme-neutral-700 pt-1">{step.text}</span>
                    </li>
                  ))}
                </ol>

                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href={labcorpPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border-2 border-theme-info-border text-theme-info text-sm font-semibold hover:bg-theme-info-bg transition-colors"
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

            <div className="mt-6 pt-5 border-t border-theme-neutral-100">
              <button
                onClick={() => setGuidedStep('choose')}
                className="flex items-center gap-1.5 text-sm text-theme-neutral-500 hover:text-theme-neutral-700 transition-colors"
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
                <h2 className="text-2xl text-theme-neutral-900 mb-1">Review your report</h2>
                <p className="text-sm text-theme-neutral-500">
                  We extracted your report details automatically — review anything below before saving.
                </p>
              </div>

              {/* Source + detection message */}
              {effectiveSource !== 'unknown' ? (
                <div className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border mb-5 ${
                  effectiveSource === 'quest' ? 'bg-theme-flag-ok-bg border-theme-flag-ok-border' : 'bg-theme-info-bg border-theme-info-border'
                }`}>
                  <FlaskConical className={`w-4 h-4 flex-shrink-0 mt-0.5 ${effectiveSource === 'quest' ? 'text-theme-flag-ok' : 'text-theme-info'}`} />
                  <div>
                    <p className={`text-sm font-semibold ${effectiveSource === 'quest' ? 'text-theme-flag-ok' : 'text-theme-info'}`}>
                      {detectedLabSource !== 'unknown' && labSource === detectedLabSource
                        ? `We detected this as a ${effectiveSource === 'quest' ? 'Quest' : 'Labcorp'} report and extracted your results automatically`
                        : `Imported from ${effectiveSource === 'quest' ? 'Quest' : 'Labcorp'}`}
                    </p>
                    <p className={`text-xs mt-0.5 ${effectiveSource === 'quest' ? 'text-theme-flag-ok' : 'text-theme-info'}`}>
                      {detectedLabSource !== 'unknown' ? 'Detected from report' : 'Selected by you'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-theme-neutral-200 bg-theme-neutral-50 mb-5">
                  <CheckCircle className="w-4 h-4 text-theme-neutral-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-theme-neutral-600 font-medium">We extracted your report details automatically — review anything below before saving</p>
                </div>
              )}

              {/* The draw date (stored as report_date). PK-FIX-02: it is the day the cycle
                  day is counted to, so it is labelled as the blood draw, not the report. */}
              <div className="mb-5">
                <label htmlFor="blood-draw-date" className="flex items-center gap-1.5 text-sm font-semibold text-theme-neutral-700 mb-1.5">
                  <Calendar className="w-3.5 h-3.5 text-theme-neutral-400" />
                  Date your blood was drawn
                </label>
                <input
                  id="blood-draw-date"
                  type="date"
                  value={reportDate}
                  onChange={e => setReportDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-theme-neutral-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-neutral-900"
                />
                <p className="mt-1 text-xs text-theme-neutral-400">Change this if you're backlogging an older report — last period start will re-sync from your tracker</p>
              </div>

              {/* Marker count + confidence row */}
              {coverage && (
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-theme-neutral-200 bg-theme-neutral-50">
                    <Activity className="w-4 h-4 text-theme-neutral-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-theme-neutral-900">
                        {coverage.total_detected} marker{coverage.total_detected !== 1 ? 's' : ''} detected
                      </p>
                      {coverage.needs_review > 0 && (
                        <p className="text-xs text-theme-flag-watch mt-0.5">{coverage.needs_review} may need review</p>
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
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-theme-flag-watch-border bg-theme-flag-watch-bg mb-5">
                  <AlertTriangle className="w-4 h-4 text-theme-flag-watch flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-theme-flag-watch">
                    We couldn't fully read {coverage.needs_review} item{coverage.needs_review !== 1 ? 's' : ''} — you can still continue, Amani will use what it understood
                  </p>
                </div>
              )}

              {/* Expandable marker preview */}
              {reportItems.length > 0 && (
                <div className="border border-theme-neutral-200 rounded-xl overflow-hidden mb-2">
                  <button
                    onClick={() => setMarkerPreviewOpen(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-theme-neutral-50 hover:bg-theme-neutral-100 transition-colors text-left"
                  >
                    <span className="text-sm font-semibold text-theme-neutral-700">View detected markers</span>
                    <span className="flex items-center gap-1.5 text-xs text-theme-neutral-400">
                      {reportItems.length} markers
                      {markerPreviewOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                  {markerPreviewOpen && (
                    <div className="divide-y divide-theme-neutral-100 max-h-64 overflow-y-auto">
                      {reportItems.map((item, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-theme-neutral-50">
                          <span className="text-sm text-theme-neutral-800 font-medium truncate max-w-[60%]">{reportItemDisplayName(item)}</span>
                          <span className="text-sm text-theme-neutral-500 ml-2 flex-shrink-0">
                            {item.value_text && (item.value_numeric == null || item.value_numeric === 0)
                              ? item.value_text
                              : item.value_numeric != null
                                ? `${item.value_numeric}${item.unit ? ' ' + item.unit : ''}`
                                : item.value_text || '—'}
                            {item.needs_review && (
                              <span className="ml-1.5 text-xs text-theme-flag-watch font-medium">review</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {aiRefining && (
                <div className="flex items-center gap-2 text-xs text-theme-neutral-400 mt-2">
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
                    <h3 className="text-base text-theme-neutral-900 mb-0.5">
                      Cycle context <span className="text-theme-neutral-400 font-normal text-sm">(optional)</span>
                    </h3>
                    <p className="text-xs text-theme-neutral-500">Amani counts the cycle day of your test from the day your last period started.</p>
                  </div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-theme-neutral-700">Last period start</label>
                    {fetchingPeriod && (
                      <span className="flex items-center gap-1 text-xs text-theme-neutral-400">
                        <Loader2 className="w-3 h-3 animate-spin" /> Looking up tracker...
                      </span>
                    )}
                    {periodAutoFilled && !fetchingPeriod && (
                      <span className="flex items-center gap-1 text-xs font-medium text-theme-flag-ok bg-theme-flag-ok-bg px-2 py-0.5 rounded-full border border-theme-flag-ok-border">
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
                    className="w-full px-3 py-2.5 border border-theme-neutral-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-neutral-900"
                  />
                  {!lastPeriodDate && !fetchingPeriod && (
                    <p className="mt-1 text-xs text-theme-neutral-400">Add the day your last period started, if you know it.</p>
                  )}

                  {/* PK-FIX-06: typical cycle length (optional; empty means unknown). */}
                  <div className="flex items-center justify-between mt-4 mb-1.5">
                    <label htmlFor="typical-cycle-length" className="text-sm font-medium text-theme-neutral-700">
                      Typical cycle length
                    </label>
                    {cycleLengthAutoFilled && (
                      <span className="flex items-center gap-1 text-xs font-medium text-theme-flag-ok bg-theme-flag-ok-bg px-2 py-0.5 rounded-full border border-theme-flag-ok-border">
                        <CheckCircle className="w-3 h-3" /> Auto-filled from your tracker
                      </span>
                    )}
                  </div>
                  <Input
                    id="typical-cycle-length"
                    numeric
                    inputMode="numeric"
                    autoComplete="off"
                    value={cycleLengthInput}
                    onChange={e => {
                      setCycleLengthInput(e.target.value);
                      setCycleLengthAutoFilled(false);
                      userEditedCycleLengthRef.current = true;
                    }}
                    hint={CYCLE_LENGTH_INPUT_HINT}
                    error={cycleLengthInvalid ? CYCLE_LENGTH_INPUT_ERROR : undefined}
                  />
                </div>

                {/* Divider */}
                <div className="border-t border-theme-neutral-100" />

                {/* Symptoms */}
                <div>
                  <div className="mb-3">
                    <h3 className="text-base text-theme-neutral-900 mb-0.5">
                      Any symptoms? <span className="text-theme-neutral-400 font-normal text-sm">(optional)</span>
                    </h3>
                    <p className="text-xs text-theme-neutral-500">Select up to 5 — helps personalize your insights</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SYMPTOMS.map(symptom => (
                      <button
                        key={symptom.value}
                        onClick={() => toggleSymptom(symptom.value)}
                        className={`px-3.5 py-1.5 rounded-full border-2 text-sm transition-all ${
                          symptoms.includes(symptom.value)
                            ? 'border-theme-primary bg-theme-primary/10 text-theme-primary font-medium'
                            : 'border-theme-neutral-200 text-theme-neutral-600 hover:border-theme-neutral-300'
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
                <Button onClick={handleProceedToStep3} disabled={extracting || cycleLengthInvalid}>
                  {extracting ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Reading...</>
                  ) : (
                    <>Next <ArrowRight className="w-5 h-5 ml-2" /></>
                  )}
                </Button>
              </div>
              <p className="text-xs text-center text-theme-neutral-400">You can always edit this later</p>
            </div>
          </div>
        )}

        {/* ── STEP 3: Review & Submit ─────────────────────────────────────── */}
        {step === 3 && (
          <Card>
            <div className="mb-5">
              <h2 className="text-2xl text-theme-neutral-900 mb-1">Confirm your markers</h2>
              <p className="text-sm text-theme-neutral-500">Review what Amani found — edit, remove, or add anything before saving.</p>
            </div>

            {aiRefining && (
              <div className="flex items-center gap-2 bg-theme-info-bg border border-theme-info-border text-theme-info px-4 py-2.5 rounded-lg mb-4 text-sm">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>AI is refining extracted values in the background — results will update automatically.</span>
              </div>
            )}

            {/* Dev-only: a skipped refinement should be visible, not silent. */}
            {import.meta.env.DEV && aiSkipReason && (
              <div className="flex items-center gap-2 bg-theme-neutral-50 border border-theme-neutral-200 text-theme-neutral-600 px-4 py-2.5 rounded-lg mb-4 text-xs font-mono">
                <span>AI refinement skipped — {aiSkipReason}</span>
              </div>
            )}

            {coverage && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 mt-2">
                {[
                  { label: 'Detected', value: coverage.total_detected, color: 'bg-theme-neutral-50 border-theme-neutral-200 text-theme-neutral-700' },
                  { label: 'Core panel', value: coverage.total_core, color: 'bg-theme-flag-ok-bg border-theme-flag-ok-border text-theme-flag-ok' },
                  { label: 'Extended', value: coverage.total_extended, color: 'bg-theme-info-bg border-theme-info-border text-theme-info' },
                  { label: 'Needs review', value: coverage.needs_review, color: 'bg-theme-flag-watch-bg border-theme-flag-watch-border text-theme-flag-watch' },
                ].map(stat => (
                  <div key={stat.label} className={`rounded-lg border px-3 py-2 text-center ${stat.color}`}>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-xs font-medium mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            )}

            {reportItems.length === 0 && (
              <div className="bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-theme-flag-watch flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-theme-flag-watch">
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
                <div className="w-20 h-20 border-4 border-theme-flag-ok-border border-t-teal-600 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <CheckCircle className={`w-10 h-10 transition-all duration-1000 ${submitStep === 'complete' ? 'text-theme-flag-ok opacity-100 scale-100' : 'text-theme-neutral-500 opacity-0 scale-50'}`} />
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl text-theme-neutral-900">
                  {submitStep === 'complete' ? 'Report imported' : "We're reading your report"}
                </h2>
                <p className="text-theme-neutral-500 max-w-sm mx-auto">
                  {submitStep === 'uploading' && 'Uploading your file...'}
                  {submitStep === 'creating' && 'Detecting report date...'}
                  {submitStep === 'saving' && 'Extracting lab markers...'}
                  {submitStep === 'interpreting' && 'Organizing your results...'}
                  {submitStep === 'complete' && 'Your results have been added to Amani and are ready to compare with your past reports.'}
                </p>
              </div>

              <div className="w-full max-w-xs bg-theme-neutral-100 h-1.5 rounded-full overflow-hidden mt-8">
                <div
                  className="bg-theme-flag-ok h-full transition-all duration-1000 ease-out"
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
