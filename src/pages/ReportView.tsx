import { ArrowRightLeft } from 'lucide-react';
import { ClinicalObservation, ModelProse, ModelProseText } from '../components/ClinicalObservation';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { firstPartyEvents } from '../lib/firstPartyEventsClient';
import { Layout } from '../components/Layout';
import { Button } from '../components/Button';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAllRows';
import { BiomarkerCard } from '../components/BiomarkerCard';
import { ResultRow } from '../components/ResultRow';
import { DerivedMetricsPanel } from '../components/DerivedMetricsPanel';
import { InsightFlagsPanel } from '../components/InsightFlagsPanel';
import { YourHealthStory } from '../components/YourHealthStory';
import { FocusAreas } from '../components/FocusAreas';
import { GuidanceCards } from '../components/GuidanceCards';
import { buildCards } from '../lib/cards/buildCards';
import { buildHealthStory, type PrimaryContext } from '../lib/insights/buildHealthStory';
import { buildFocusAreas } from '../lib/insights/buildFocusAreas';
import { scoreBiomarker } from '../lib/scoring/scoreBiomarker';
import { SystemSummaryCards } from '../components/SystemSummaryCards';
import { DoctorQuestionsCard } from '../components/DoctorQuestionsCard';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { RecommendedLabs } from '../components/RecommendedLabs';
import { computeDerivedMetrics, evaluateInsightRules } from '../utils/derivedMetrics';
import { authorizeInsightMatches, gateInsightMatches } from '../lib/scoring/insightGate';
import { bandLanguageByKey } from '../lib/scoring/compareReports';
import {
  authorizedLanguage, authorizeModelProse, combineLanguage, CUE_STYLE, describeComparisonBand, describeMeasuredMovement, evaluateSafetyRules,
  markerBandPlacement, movementClaimsByKey, outsideBandCount, PRIMARY_FINDING_LABEL,
  primaryFindingSentence, PRODUCT_DISCLAIMERS, REPORT_TITLE, reportHeadline, systemDisplayLabel,
  type AuthorizedLanguage, type AuthorizedModelProse,
} from '../lib/scoring/insightCopy';
import { SafetyWarnings } from '../components/SafetyWarnings';
import { primaryTrajectory, withBandReview } from '../lib/scoring/healthStoryTrajectory';
import { assessAmaniContext, contextFromReport } from '../lib/scoring/amaniContext';
import { getCategory, getDisplayName } from '../lib/biomarkers/dictionary';
import { buildInsightSummary } from '../lib/insights/buildInsightSummary';
import { computeBaseline } from '../lib/personalization/baseline';
import { analyzeTrend } from '../lib/personalization/trendAnalysis';
import { PERSONALIZATION_THRESHOLDS } from '../types';
import { YourTrajectoryCard } from '../components/YourTrajectoryCard';
import type { BaselineStatus, BaselineStaleness, TrendDirection, TrendStrength } from '../types';
import type { InsightSummary, BiggestChange } from '../lib/insights/buildInsightSummary';
import type {
  LabReport, Biomarker, AIInterpretation, BiomarkerCategory,
  BiomarkerName, ReportAnalyte,
} from '../types';
import {
  RefreshCw, AlertCircle, ChevronDown, ChevronRight,
  Microscope, Sparkles, CalendarDays,
  CheckCircle2, Loader2, Info, Activity, FlaskConical,
} from 'lucide-react';
import { ReportHeaderActions } from '../features/report/header/ReportHeaderActions';
import type { ReportHeaderContext } from '../features/report/header';
import { ReportNotices } from '../features/report/notices/ReportNotices';
import { ReportProblemFlow } from '../features/report/problem/ReportProblemFlow';
import { INTERPRETATION_FEEDBACK_FLAG } from '../features/report/problem/problemReport';
import { isFeatureEnabled } from '../lib/runtimeConfig';
import { shownExplanationOf, UNIDENTIFIED_EXPLANATION, type ShownExplanation } from '../features/report/notices';
import { isAiPausedError, isAiPausedResponse, noteAiPaused, readAiPaused, subscribeAiPaused } from '../lib/aiPause';
import type { LabSource } from '../types';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { createRegenerationRequests } from '../lib/regenerationRequest';
import { requestReportDeletion } from '../lib/reportDeletion';
import { REGENERATION_COPY, regenerationFailureOf, type RegenerationNoticeKind } from '../lib/regenerationFailure';
import { handle402 } from '../utils/subscription';
import { useSubscription } from '../hooks/useSubscription';
import { clientFreemiumActive } from '../lib/tier';
import { cycleContextCard } from '../lib/cycleContextCard';
import { PHASE_ESTIMATE_LABEL } from '../lib/cycleDayRule';
import { CycleRule } from '../components/CycleRule';
import { ReportCycleLine } from '../components/ReportCycleLine';
import {
  fetchInterpretationAccess,
  type InterpretationAccessResult,
} from '../lib/freemium/interpretationAccess';
import {
  accessRequestKey,
  applyAccessResult,
  createAccessRequester,
  freemiumCanRegenerate,
  generateFailureKind,
} from '../lib/freemium/reportAccess';
import { AccessErrorNotice, FreemiumReportPanel } from '../components/freemium/FreemiumReportPanel';
import { PremiumPaywall } from '../components/freemium/PremiumPaywall';

/*
  A 429 from `generate-interpretation` means "over your daily AI quota", not
  "this report failed". The edge function returns it without touching
  `lab_reports.status` on purpose — the lab values are saved and intact, and the
  limit clears at midnight — so nothing on this page may mark the report errored
  or show the generic failure card for one.

  Returns the server's message on a 429, null on anything else. The
  FunctionsHttpError unwrapping mirrors `handle402` in utils/subscription.ts,
  which runs first at every call site and leaves the body unread unless the
  status is 402.
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

function httpStatus(err: unknown): number | undefined {
  return err instanceof FunctionsHttpError ? err.context?.status : undefined;
}

/* NewReport writes this key when the upload's interpretation request is
   rate-limited, because the 429 arrives after it has already navigated here. */
function readInterpRateLimit(reportId: string): string | null {
  try {
    return sessionStorage.getItem(`interpRateLimit:${reportId}`);
  } catch {
    return null;
  }
}

function writeInterpRateLimit(reportId: string, message: string | null): void {
  try {
    if (message) sessionStorage.setItem(`interpRateLimit:${reportId}`, message);
    else sessionStorage.removeItem(`interpRateLimit:${reportId}`);
  } catch {
    // Storage unavailable (private mode) — the notice degrades to no notice.
  }
}

const CATEGORY_ORDER: BiomarkerCategory[] = [
  'hormones', 'thyroid', 'metabolic', 'lipids', 'liver', 'kidney', 'inflammation', 'nutrients', 'blood',
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

const CONFIDENCE_STYLE: Record<string, string> = {
  high:   'text-theme-flag-ok bg-theme-flag-ok-bg border-theme-flag-ok-border',
  medium: 'text-theme-flag-watch bg-theme-flag-watch-bg border-theme-flag-watch-border',
  low:    'text-theme-neutral-500 bg-theme-neutral-100 border-theme-neutral-200',
};

/*
  V2-03b Stage 2, owner R1. The model's pattern signals carried a title naming
  a pattern, a free-text explanation and a red/amber "confidence" badge, none of
  it resting on an authorized rule. A signal now renders only the sentences that
  resolve to the report's own measured-change claims, in neutral ink; the
  title, the badge and the model's choice of related markers do not render.
*/

/** The columns the all-history read selects for baselines and trends. */
interface HistoricalBiomarkerRow {
  name: string;
  value: number;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  lab_report_id: string;
}

interface OpeningContext {
  primaryIsImproving: boolean;
  primaryImprovingChange: BiggestChange | null;
  primaryIsWorsening: boolean;
  primaryWorseningChange: BiggestChange | null;
  primaryIsStableAbnormal: boolean;
  primaryStableChange: BiggestChange | null;
  primaryHasDelta: boolean;
  anyWorsening: boolean;
  worseningChange: BiggestChange | null;
  anyBoundaryCrossImproved: boolean;
}

function getOpeningContext(summary: InsightSummary): OpeningContext {
  const primaryKey = summary.primaryFinding?.key ?? null;

  const primaryRawDelta = primaryKey ? summary.deltaMap.get(primaryKey) ?? null : null;

  const primaryImprovingChange: BiggestChange | null = (() => {
    if (!primaryKey) return null;
    const fromBiggest = summary.biggestChanges.find(
      c =>
        c.key === primaryKey &&
        (c.trajectoryStatus === 'improving_still_high' || c.trajectoryStatus === 'improving_still_low') &&
        c.significance !== 'minor',
    );
    if (fromBiggest) return fromBiggest;
    if (!primaryRawDelta) return null;
    if (
      primaryRawDelta.trajectoryStatus !== 'improving_still_high' &&
      primaryRawDelta.trajectoryStatus !== 'improving_still_low'
    ) return null;
    if (primaryRawDelta.previousValue === undefined || primaryRawDelta.currentValue === undefined) return null;
    return {
      key: primaryRawDelta.key,
      displayName: primaryRawDelta.displayName,
      previousValue: primaryRawDelta.previousValue,
      currentValue: primaryRawDelta.currentValue,
      unit: primaryRawDelta.unit,
      percentDelta: primaryRawDelta.percentDelta,
      trendDirection: primaryRawDelta.trendDirection,
      significance: primaryRawDelta.significance,
      boundaryCrossing: primaryRawDelta.boundaryCrossing,
      trajectoryStatus: primaryRawDelta.trajectoryStatus,
      distanceToNormalImprovement: primaryRawDelta.distanceToNormalImprovement,
      fact: '',
      priorReportDate: primaryRawDelta.priorReportDate,
      priorIsOlderThanImmediatePrior: false,
    };
  })();

  const primaryWorseningChange: BiggestChange | null = (() => {
    if (!primaryKey || !primaryRawDelta) return null;
    if (
      primaryRawDelta.trajectoryStatus !== 'worsening_still_high' &&
      primaryRawDelta.trajectoryStatus !== 'worsening_still_low'
    ) return null;
    const fromBiggest = summary.biggestChanges.find(c => c.key === primaryKey);
    if (fromBiggest) return fromBiggest;
    return {
      key: primaryRawDelta.key,
      displayName: primaryRawDelta.displayName,
      previousValue: primaryRawDelta.previousValue,
      currentValue: primaryRawDelta.currentValue,
      unit: primaryRawDelta.unit,
      percentDelta: primaryRawDelta.percentDelta,
      trendDirection: primaryRawDelta.trendDirection,
      significance: primaryRawDelta.significance,
      boundaryCrossing: primaryRawDelta.boundaryCrossing,
      trajectoryStatus: primaryRawDelta.trajectoryStatus,
      distanceToNormalImprovement: primaryRawDelta.distanceToNormalImprovement,
      fact: '',
      priorReportDate: primaryRawDelta.priorReportDate,
      priorIsOlderThanImmediatePrior: false,
    };
  })();

  const primaryStableChange: BiggestChange | null = (() => {
    if (!primaryKey || !primaryRawDelta) return null;
    if (primaryRawDelta.trajectoryStatus !== 'stable_abnormal') return null;
    if (primaryRawDelta.previousValue === undefined || primaryRawDelta.currentValue === undefined) return null;
    const fromBiggest = summary.biggestChanges.find(c => c.key === primaryKey);
    if (fromBiggest) return fromBiggest;
    return {
      key: primaryRawDelta.key,
      displayName: primaryRawDelta.displayName,
      previousValue: primaryRawDelta.previousValue,
      currentValue: primaryRawDelta.currentValue,
      unit: primaryRawDelta.unit,
      percentDelta: primaryRawDelta.percentDelta,
      trendDirection: primaryRawDelta.trendDirection,
      significance: primaryRawDelta.significance,
      boundaryCrossing: primaryRawDelta.boundaryCrossing,
      trajectoryStatus: primaryRawDelta.trajectoryStatus,
      distanceToNormalImprovement: primaryRawDelta.distanceToNormalImprovement,
      fact: '',
      priorReportDate: primaryRawDelta.priorReportDate,
      priorIsOlderThanImmediatePrior: false,
    };
  })();

  const worseningChange =
    summary.biggestChanges.find(
      c =>
        c.trajectoryStatus === 'worsening_still_high' ||
        c.trajectoryStatus === 'worsening_still_low' ||
        c.boundaryCrossing?.direction === 'worsened',
    ) ?? null;

  return {
    primaryIsImproving: primaryImprovingChange !== null,
    primaryImprovingChange,
    primaryIsWorsening: primaryWorseningChange !== null,
    primaryWorseningChange,
    primaryIsStableAbnormal: primaryStableChange !== null,
    primaryStableChange,
    primaryHasDelta: primaryImprovingChange !== null || primaryWorseningChange !== null || primaryStableChange !== null,
    anyWorsening: worseningChange !== null,
    worseningChange,
    anyBoundaryCrossImproved: summary.biggestChanges.some(c => c.boundaryCrossing?.direction === 'improved'),
  };
}

function normalizeInterpretation(raw: unknown): AIInterpretation {
  const data = raw && typeof raw === 'object'
    ? raw as Partial<AIInterpretation> & Record<string, unknown>
    : {};

  return {
    ...data,
    headline: typeof data.headline === 'string' ? data.headline : '',
    summary_bullets: Array.isArray(data.summary_bullets) ? data.summary_bullets : [],
    primary_concern: data.primary_concern && typeof data.primary_concern === 'object'
      ? data.primary_concern as AIInterpretation['primary_concern']
      : undefined,
    key_findings: Array.isArray(data.key_findings) ? data.key_findings : undefined,
    what_you_can_do_now: Array.isArray(data.what_you_can_do_now) ? data.what_you_can_do_now : undefined,
    what_to_do_next: Array.isArray(data.what_to_do_next) ? data.what_to_do_next : undefined,
    top_findings: Array.isArray(data.top_findings) ? data.top_findings : [],
    pattern_signals: Array.isArray(data.pattern_signals) ? data.pattern_signals : [],
    questions_for_doctor: Array.isArray(data.questions_for_doctor) ? data.questions_for_doctor : [],
    disclaimer: typeof data.disclaimer === 'string' ? data.disclaimer : '',
    cycle_context: data.cycle_context as AIInterpretation['cycle_context'] ?? {
      estimated_cycle_day: null,
      estimated_cycle_phase: 'unknown',
      confidence: 'low',
      explanation: '',
    },
    safety_notes: Array.isArray(data.safety_notes) ? data.safety_notes : [],
    suggested_followups_to_discuss: Array.isArray(data.suggested_followups_to_discuss)
      ? data.suggested_followups_to_discuss
      : data.suggested_followups_to_discuss
        ? [String(data.suggested_followups_to_discuss)]
        : [],
  };
}

export function ReportView() {
  const { id: reportId = '' } = useParams<{ id: string }>();
  // PK-EXP5 funnel step; off unless first_party_events is on, never blocks the report.
  useEffect(() => {
    if (reportId) void firstPartyEvents.track('report_viewed');
  }, [reportId]);
  /*
    `entitled` is the union of Stripe, StoreKit, Play Billing and the trial —
    the same decision the server's subscription-guard makes. The regeneration
    gate below used `userProfile.subscription_status === 'active'`, but nothing
    in the codebase ever writes that column: it is `DEFAULT 'trial'` in
    20260216193045 and no edge function, webhook or trigger updates it. So the
    gate collapsed to "is the 7-day trial still running", and every paying
    subscriber — Stripe, Apple and Google alike — silently lost the ability to
    regenerate a report.
  */
  const {
    entitled, plan, complimentary, error: subscriptionError, refetch: refetchSubscription,
  } = useSubscription();
  const navigate = useNavigate();
  /*
    Build-time flag. Off: this page is the 1.0.5 page, reading the
    interpretation straight from the `interpretations` view. On: the body comes
    only from `get-interpretation`, which has already chosen Full or Basic for
    this viewer — fetched once when the report opens and once when a
    generation completes. The 3 s polls below stay on the report status and
    never touch get-interpretation, whose rate limit is per day.
  */
  const freemium = clientFreemiumActive();
  const [accessState, setAccessState] = useState<InterpretationAccessResult | null>(null);
  // A failed refresh while a body is on screen: shown inline, the body stays.
  const [accessInlineError, setAccessInlineError] = useState<InterpretationAccessResult | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessNonce, setAccessNonce] = useState(0);
  const [generating, setGenerating] = useState(false);
  // The server refused to generate for this viewer (402): offer Premium, don't retry.
  const [generatePremiumRequired, setGeneratePremiumRequired] = useState(false);
  // PK-PL-A: what the last failed regenerate (or fuller-analysis) request meant,
  // shown as a calm notice above the analysis it left intact. `retry` offers the
  // keyed retry; without it the action on the page is the way to try again.
  const [regenerateFailure, setRegenerateFailure] = useState<{ kind: RegenerationNoticeKind; retry: boolean } | null>(null);
  const regenerationRequests = useRef(createRegenerationRequests()).current;
  const [paywallOpen, setPaywallOpen] = useState(false);
  const accessStateRef = useRef<InterpretationAccessResult | null>(null);
  const accessRequester = useRef(createAccessRequester(id => fetchInterpretationAccess(
    (name, options) => supabase.functions.invoke(name, options),
    id,
  ))).current;
  const autoGenerateFired = useRef(false);
  const refreshAccess = () => setAccessNonce(n => n + 1);
  const [report, setReport] = useState<LabReport | null>(null);
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>([]);
  const [reportAnalytes, setReportAnalytes] = useState<ReportAnalyte[]>([]);
  const [interpretation, setInterpretation] = useState<AIInterpretation | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  /*
    Which tier the STORED row was written at. Null means it predates Free/Plus,
    which reads as Plus — the same fail-open-on-shape rule as
    normalizeTierForClient. Drives the "Generate full Amani analysis" offer
    below, never access to anything.
  */
  const [interpretationTier, setInterpretationTier] = useState<string | null>(null);
  /*
    Which explanation is on screen, for the notices slot (R22): the row id and
    generated_at, where the read that produced it returned them. Flag on, the
    client does not read get-interpretation's version identity yet, so both
    stay null there.
  */
  const [shownExplanation, setShownExplanation] = useState<ShownExplanation | null>(null);
  // "Report a problem" (PK-HARM-01, D20), offered in More only while features.interpretation_feedback is on.
  const [reportProblemOpen, setReportProblemOpen] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  // The report is deleted but its stored file is not removed yet (retryable).
  const [deleteFilePending, setDeleteFilePending] = useState(false);
  const [activeCategory, setActiveCategory] = useState<BiomarkerCategory | null>(null);
  const [showFullPanel, setShowFullPanel] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<BiomarkerCategory>>(new Set());
  const [categoriesInitialized, setCategoriesInitialized] = useState(false);
  const [, setPreviousBiomarkers] = useState<Biomarker[]>([]);
  const [historicalBiomarkers, setHistoricalBiomarkers] = useState<Map<string, { reportDate: string; value: number }[]>>(new Map());
  const [previousBiomarkerOccurrences, setPreviousBiomarkerOccurrences] = useState<Map<string, { value: number; unit: string; reference_min: number | null; reference_max: number | null; reportDate: string }>>(new Map());
  const [immediatePriorReportDate, setImmediatePriorReportDate] = useState<string | null>(null);
  const [historicalReportCount, setHistoricalReportCount] = useState(0);
  const [interpGaveUp, setInterpGaveUp] = useState(false);
  const [rateLimitNotice, setRateLimitNotice] = useState<string | null>(null);
  // PK-FIX-01b (DT9, D12): the last generation answered that the AI is paused.
  const [aiPaused, setAiPaused] = useState(() => readAiPaused(reportId));
  const interpPollingActive = useRef(false);
  const interpRetryFired = useRef(false);

  useEffect(() => { fetchReport(); }, [reportId]);

  // NewReport notes the pause when generate-interpretation answers, which can
  // be after it has navigated here.
  useEffect(() => {
    setAiPaused(readAiPaused(reportId));
    return subscribeAiPaused(reportId, setAiPaused);
  }, [reportId]);

  useEffect(() => {
    if (!report || report.status !== 'processing') return;
    let elapsed = 0;
    const POLL_INTERVAL = 3000;
    // 90s: edge function can take up to 28s for OpenAI + DB writes + startup latency
    const TIMEOUT_MS = 90000;
    const interval = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      // Read fresh: NewReport writes this after navigating here, so it can
      // appear at any tick. Stopping here is what keeps the timeout branch
      // below from branding a rate-limited report as failed.
      const limitMessage = readInterpRateLimit(reportId);
      if (limitMessage) {
        clearInterval(interval);
        setRateLimitNotice(limitMessage);
        return;
      }
      const { data } = await supabase
        .from('lab_reports').select('status').eq('id', reportId).maybeSingle();
      if (data && data.status !== 'processing') {
        clearInterval(interval);
        fetchReport();
        // Flag on: the status change re-runs the get-interpretation effect.
        if (freemium) return;
        const { data: interpData } = await supabase
          .from('interpretations')
          .select('id, json_output, tier')
          .eq('lab_report_id', reportId)
          .maybeSingle();
        if (interpData?.json_output) {
          setInterpretation(normalizeInterpretation(interpData.json_output));
          setInterpretationTier((interpData as { tier?: string | null }).tier ?? null);
          setShownExplanation(shownExplanationOf(interpData));
        }
        return;
      }
      if (elapsed >= TIMEOUT_MS) {
        clearInterval(interval);
        /*
          The poll gave up, so we do NOT know the interpretation succeeded — and
          writing 'ready' here used to claim that it had. A report whose
          interpretation genuinely failed then rendered as a finished report with
          nothing in it, which for a lab-interpretation product is the worst way
          to be wrong: it looks like "nothing to flag" rather than "this did not
          run". Write the terminal status that is actually true instead.

          Compare-and-set on 'processing' so the server always wins: if the edge
          function already wrote 'ready' or 'error' and we simply missed it on
          the last poll, this update matches no row and leaves that result alone.
        */
        await supabase
          .from('lab_reports')
          .update({ status: 'error' })
          .eq('id', reportId)
          .eq('status', 'processing');
        fetchReport();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [report?.status, reportId, freemium]);

  useEffect(() => {
    // Flag on: generation is driven by get-interpretation's generation_needed.
    if (freemium) return;
    if (!report || (report.status !== 'ready' && report.status !== 'error') || interpretation !== null) return;
    if (interpPollingActive.current) return;

    interpPollingActive.current = true;
    interpRetryFired.current = false;
    setInterpGaveUp(false);

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { data: existing } = await supabase
          .from('interpretations')
          .select('id, json_output, tier')
          .eq('lab_report_id', reportId)
          .maybeSingle();

        if (cancelled) return;

        if (existing?.json_output) {
          interpPollingActive.current = false;
          setInterpretation(normalizeInterpretation(existing.json_output));
          setInterpretationTier((existing as { tier?: string | null }).tier ?? null);
          setShownExplanation(shownExplanationOf(existing));
          return;
        }

        interpRetryFired.current = true;
        const { data: retryData, error: invokeErr } = await supabase.functions.invoke('generate-interpretation', {
          body: { reportId },
        });
        if (cancelled) return;
        if (!invokeErr) noteAiPaused(reportId, isAiPausedResponse(retryData));
        if (invokeErr) {
          const redirect = await handle402(invokeErr);
          if (redirect && !cancelled) { navigate(redirect, { replace: true }); return; }
          const limitMessage = await rateLimitMessage(invokeErr);
          interpPollingActive.current = false;
          if (limitMessage) {
            writeInterpRateLimit(reportId, limitMessage);
            if (!cancelled) setRateLimitNotice(limitMessage);
            return;
          }
          setInterpGaveUp(true);
          return;
        }

        let elapsed = 0;
        const POLL_INTERVAL = 3000;
        const TIMEOUT_MS = 120000;
        pollInterval = setInterval(async () => {
          if (cancelled) { clearInterval(pollInterval!); return; }
          elapsed += POLL_INTERVAL;
          const { data } = await supabase
            .from('interpretations')
            .select('id, json_output, tier')
            .eq('lab_report_id', reportId)
            .maybeSingle();
          if (data?.json_output) {
            clearInterval(pollInterval!);
            interpPollingActive.current = false;
            setInterpretation(normalizeInterpretation(data.json_output));
            setInterpretationTier((data as { tier?: string | null }).tier ?? null);
            setShownExplanation(shownExplanationOf(data));
            return;
          }
          if (elapsed >= TIMEOUT_MS) {
            clearInterval(pollInterval!);
            interpPollingActive.current = false;
            setInterpGaveUp(true);
          }
        }, POLL_INTERVAL);
      } catch {
        if (!cancelled) {
          interpPollingActive.current = false;
          setInterpGaveUp(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [report?.status, report?.id, interpretation, reportId, freemium]);

  /*
    Flag on: one get-interpretation call per (report settled, explicit
    refresh) — see accessRequestKey. The requester makes the call idempotent
    across StrictMode's double-invoked effects and drops a response a newer
    request superseded.
  */
  const reportKeyId = report?.id;
  const reportStatus = report?.status;
  useEffect(() => {
    const key = accessRequestKey({ freemium, reportId: reportKeyId, status: reportStatus, nonce: accessNonce });
    const started = accessRequester.request(key, reportId, result => {
      const { state, inlineError } = applyAccessResult(accessStateRef.current, result);
      setAccessInlineError(inlineError);
      if (!inlineError) {
        accessStateRef.current = state;
        setAccessState(state);
        setInterpretation(state.interpretation ? normalizeInterpretation(state.interpretation) : null);
        setShownExplanation(state.interpretation ? UNIDENTIFIED_EXPLANATION : null);
        if (state.interpretation) {
          writeInterpRateLimit(reportId, null);
          setRateLimitNotice(null);
        }
        // This read may be the one that consumed a complimentary claim; the
        // hook's ledger figure predates it, so Billing/SubscriptionStatus refetch.
        if (state.access === 'full') void refetchSubscription();
      }
      setAccessLoading(false);
    });
    if (started) setAccessLoading(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freemium, reportKeyId, reportStatus, accessNonce, reportId]);

  /*
    Flag on, no stored interpretation at all: run the generate action once per
    report open, as the legacy page does. A stored-but-shallow body
    (generation_needed WITH an interpretation) is never regenerated
    automatically — that stays a one-click offer, like the Free-tier upgrade.
  */
  useEffect(() => {
    if (!freemium || accessState?.access !== 'generation_needed' || accessState.interpretation !== null) return;
    if (autoGenerateFired.current) return;
    autoGenerateFired.current = true;
    void handleGenerate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freemium, accessState]);

  const fetchReport = async (isRetry = false) => {
    const { data: reportData, error: reportError } = await supabase
      .from('lab_reports').select('*').eq('id', reportId).maybeSingle();
    if (reportError) { setError(`Failed to load: ${reportError.message}`); setLoading(false); return; }
    if (!reportData) {
      if (!isRetry) {
        await new Promise(r => setTimeout(r, 1200));
        return fetchReport(true);
      }
      setError('Report not found');
      setLoading(false);
      return;
    }
    setReport(reportData as LabReport);

    const [{ data: biomarkersData }, { data: analytesData }, { data: interpretationData }] = await Promise.all([
      supabase.from('biomarkers').select('*').eq('lab_report_id', reportId),
      supabase.from('report_analytes').select('*').eq('lab_report_id', reportId).order('raw_name'),
      // Flag on, the body is read only through get-interpretation.
      freemium
        ? Promise.resolve({ data: null })
        : supabase.from('interpretations').select('*').eq('lab_report_id', reportId).maybeSingle(),
    ]);

    if (biomarkersData) setBiomarkers(biomarkersData as Biomarker[]);
    if (analytesData) setReportAnalytes(analytesData as ReportAnalyte[]);
    if (interpretationData?.json_output) {
      writeInterpRateLimit(reportId, null);
      setRateLimitNotice(null);
      setInterpretation(normalizeInterpretation(interpretationData.json_output));
      setInterpretationTier((interpretationData as { tier?: string | null }).tier ?? null);
      setShownExplanation(shownExplanationOf(interpretationData));
    }

    setLoading(false);

    if (reportData.user_id) {
      const windowStart = new Date(reportData.report_date);
      windowStart.setDate(windowStart.getDate() - PERSONALIZATION_THRESHOLDS.SYMPTOM_WINDOW_DAYS);
      const windowEnd = new Date(reportData.report_date);
      windowEnd.setDate(windowEnd.getDate() + PERSONALIZATION_THRESHOLDS.SYMPTOM_WINDOW_DAYS);

      const [
        { data: prevReportData },
        { data: allReportsData },
      ] = await Promise.all([
        supabase
          .from('lab_reports')
          .select('id, report_date')
          .eq('user_id', reportData.user_id)
          .lt('report_date', reportData.report_date)
          .order('report_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('lab_reports')
          .select('id, report_date')
          .eq('user_id', reportData.user_id)
          .lt('report_date', reportData.report_date)
          .order('report_date', { ascending: true }),
      ]);

      if (prevReportData?.id) {
        const { data: prevBioData } = await supabase
          .from('biomarkers')
          .select('*')
          .eq('lab_report_id', prevReportData.id);
        if (prevBioData) setPreviousBiomarkers(prevBioData as Biomarker[]);
      }
      if (prevReportData?.report_date) {
        setImmediatePriorReportDate(prevReportData.report_date);
      }

      if (allReportsData && allReportsData.length > 0) {
        setHistoricalReportCount(allReportsData.length);
        const reportDateMap = new Map<string, string>();
        for (const r of allReportsData) {
          reportDateMap.set(r.id, r.report_date);
        }

        const allHistoricalIds = allReportsData.map(r => r.id);
        // R27: every prior report's values can pass PostgREST's 1,000-row cap.
        const { data: allHistoricalBiomarkers } = await fetchAllRows<HistoricalBiomarkerRow>(() =>
          supabase
            .from('biomarkers')
            .select('name, value, unit, reference_min, reference_max, lab_report_id')
            .in('lab_report_id', allHistoricalIds)
            .order('id'));

        if (allHistoricalBiomarkers) {
          const histMap = new Map<string, { reportDate: string; value: number }[]>();
          const occurrences = new Map<string, { reportDate: string; value: number; unit: string; reference_min: number | null; reference_max: number | null }[]>();
          for (const b of allHistoricalBiomarkers) {
            const reportDate = reportDateMap.get(b.lab_report_id);
            if (!reportDate) continue;
            if (!histMap.has(b.name)) histMap.set(b.name, []);
            histMap.get(b.name)!.push({ reportDate, value: b.value });
            if (!occurrences.has(b.name)) occurrences.set(b.name, []);
            occurrences.get(b.name)!.push({
              reportDate,
              value: b.value,
              unit: b.unit,
              reference_min: b.reference_min,
              reference_max: b.reference_max,
            });
          }
          setHistoricalBiomarkers(histMap);

          const latestPriorByMarker = new Map<string, { value: number; unit: string; reference_min: number | null; reference_max: number | null; reportDate: string }>();
          for (const [name, list] of occurrences) {
            const sorted = [...list].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
            const last = sorted[sorted.length - 1];
            if (last) latestPriorByMarker.set(name, last);
          }
          setPreviousBiomarkerOccurrences(latestPriorByMarker);
        }
      }
    }
  };

  const derivedMetrics = useMemo(() => computeDerivedMetrics(biomarkers), [biomarkers]);
  // V2-03: no pattern card may be built from an input Amani withholds for
  // this report's context (e.g. a PCOS pattern from an unphased LH:FSH ratio).
  // Amendment 4 (R2): a card that survives says only what its bands authorize.
  const insightFlags = useMemo(
    () => authorizeInsightMatches(
      gateInsightMatches(
        evaluateInsightRules(biomarkers, report?.estimated_cycle_phase),
        biomarkers,
        contextFromReport(report?.estimated_cycle_phase),
      ),
      biomarkers,
      contextFromReport(report?.estimated_cycle_phase),
    ),
    [biomarkers, report]
  );

  const analyteTelemetryMap = useMemo(() => {
    const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const NORM_RANK: Record<string, number> = { mapped: 3, partial: 2, unmapped: 1 };
    const map = new Map<string, { parserConfidence: 'high' | 'medium' | 'low'; normalizationStatus: 'mapped' | 'partial' | 'unmapped'; sourceFormat: 'text' | 'ocr' | 'manual' | 'unknown' | null }>();
    for (const a of reportAnalytes) {
      if (!a.canonical_slug) continue;
      const incoming = {
        parserConfidence: a.confidence_score,
        normalizationStatus: (a.normalization_status ?? a.parse_status) as 'mapped' | 'partial' | 'unmapped',
        sourceFormat: a.source_format ?? null,
      };
      const existing = map.get(a.canonical_slug);
      if (!existing) {
        map.set(a.canonical_slug, incoming);
      } else {
        const incomingScore =
          (CONFIDENCE_RANK[incoming.parserConfidence] ?? 0) +
          (NORM_RANK[incoming.normalizationStatus] ?? 0);
        const existingScore =
          (CONFIDENCE_RANK[existing.parserConfidence] ?? 0) +
          (NORM_RANK[existing.normalizationStatus] ?? 0);
        if (incomingScore > existingScore) {
          map.set(a.canonical_slug, incoming);
        }
      }
    }
    return map;
  }, [reportAnalytes]);

  const dominantSourceFormat = useMemo<'text' | 'ocr' | 'manual' | 'unknown' | null>(() => {
    if (reportAnalytes.length === 0) return null;
    const counts: Record<string, number> = {};
    for (const a of reportAnalytes) {
      const fmt = a.source_format ?? 'unknown';
      counts[fmt] = (counts[fmt] ?? 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = sorted[0]?.[0];
    if (!top || top === 'unknown') return null;
    return top as 'text' | 'ocr' | 'manual';
  }, [reportAnalytes]);

  const biomarkerPersonalizationMap = useMemo(() => {
    const map = new Map<string, {
      baselineStatus?: BaselineStatus;
      baselineStaleness?: BaselineStaleness;
      baselineValue?: number;
      trendDirection?: TrendDirection;
      trendStrength?: TrendStrength;
    }>();

    if (historicalReportCount < PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_BASELINE) return map;

    for (const b of biomarkers) {
      const history = historicalBiomarkers.get(b.name);
      if (!history || history.length === 0) continue;

      const orderedEntries = history
        .slice()
        .sort((a, c) => a.reportDate.localeCompare(c.reportDate))
        .map(h => ({ date: h.reportDate, value: h.value }));
      const ordered = orderedEntries.map(h => h.value);

      const entry: {
        baselineStatus?: BaselineStatus;
        baselineStaleness?: BaselineStaleness;
        baselineValue?: number;
        trendDirection?: TrendDirection;
        trendStrength?: TrendStrength;
      } = {};

      if (ordered.length >= PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_BASELINE) {
        // Pass the dated entries + current report date so computeBaseline can
        // tag staleness ('fresh' if last prior < 12mo, 'stale' if older,
        // 'limited' if only one old data point). BiomarkerCard switches copy
        // on this signal so a 3-year-old single TPO reading no longer fires
        // confident "your usual level" wording.
        const baseline = computeBaseline(orderedEntries, b.value, report?.report_date ?? undefined);
        if (baseline) {
          entry.baselineStatus = baseline.baselineStatus;
          entry.baselineStaleness = baseline.staleness;
          entry.baselineValue = baseline.baselineValue;
        }
      }

      if (ordered.length >= PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_TREND) {
        const trend = analyzeTrend([...ordered, b.value]);
        if (trend) {
          entry.trendDirection = trend.trendDirection;
          entry.trendStrength = trend.trendStrength;
        }
      }

      if (Object.keys(entry).length > 0) {
        map.set(b.name, entry);
      }
    }

    return map;
  }, [biomarkers, historicalBiomarkers, historicalReportCount, report?.report_date]);

  const insightSummary = useMemo(() => {
    if (biomarkers.length === 0) return null;
    const current = biomarkers.map(b => {
      const telemetry = analyteTelemetryMap.get(b.name);
      return {
        key: b.name as BiomarkerName,
        value: b.value,
        unit: b.unit,
        labRefMin: b.reference_min,
        labRefMax: b.reference_max,
        parserConfidence: telemetry?.parserConfidence ?? null,
        normalizationStatus: telemetry?.normalizationStatus ?? null,
        sourceFormat: telemetry?.sourceFormat ?? null,
      };
    });
    const previous = previousBiomarkerOccurrences.size > 0
      ? Array.from(previousBiomarkerOccurrences.entries()).map(([name, occ]) => ({
          key: name as BiomarkerName,
          value: occ.value,
          unit: occ.unit,
          labRefMin: occ.reference_min,
          labRefMax: occ.reference_max,
          reportDate: occ.reportDate,
        }))
      : null;
    return buildInsightSummary(current, previous, report?.estimated_cycle_phase, immediatePriorReportDate);
  }, [biomarkers, previousBiomarkerOccurrences, immediatePriorReportDate, report, analyteTelemetryMap]);

  // Score biomarkers for FocusAreas (deterministic, no AI). Same scoring path
  // buildInsightSummary uses internally — exposed here so FocusAreas can rank.
  const scoredBiomarkers = useMemo(() => {
    return biomarkers.map(b => scoreBiomarker(
      b.name as BiomarkerName,
      b.value,
      b.unit,
      b.reference_min,
      b.reference_max,
      report?.estimated_cycle_phase as Parameters<typeof scoreBiomarker>[5],
    ));
  }, [biomarkers, report]);

  /*
    V2-03b. "Top Priority" / "Main Focus" and the optimization-only headline
    ranked her results and called her lab results "stable" from Amani's bands
    (and a lab margin Amani added). The label is now a neutral selection name
    and the headline is the policy's placement sentence. Each scored marker's
    band language, with the report's own phase, decides what may be said.
  */
  const markerBandLanguage = useMemo(() => {
    const context = contextFromReport(report?.estimated_cycle_phase);
    const map = new Map<string, AuthorizedLanguage>();
    for (const b of biomarkers) {
      const assessment = assessAmaniContext(b.name as BiomarkerName, b.value, context);
      if (assessment.kind === 'scored') map.set(b.name, authorizedLanguage(assessment.band));
    }
    return map;
  }, [biomarkers, report]);
  const safetyWarnings = useMemo(
    () => evaluateSafetyRules(biomarkers.map(b => ({ name: b.name, value: b.value, unit: b.unit }))),
    [biomarkers],
  );

  // Build a frontend PrimaryContext from insightSummary + biggestChanges. The
  // server's interpretation already carries one but it's not surfaced to the
  // client; this matches the same shape so YourHealthStory can render the
  // honest "first tracked" / "improved" / "worsened" sentence.
  const primaryBandLanguage = useMemo(() => {
    const key = insightSummary?.primaryFinding?.key;
    // The current band, with or without a prior report: a first report has no delta.
    return (key ? markerBandLanguage.get(key) ?? insightSummary?.deltaMap.get(key)?.bandLanguage : undefined) ?? authorizedLanguage(null);
  }, [insightSummary, markerBandLanguage]);

  const frontendPrimaryContext = useMemo<PrimaryContext | null>(() => {
    if (!insightSummary?.primaryFinding) return null;
    const pf = insightSummary.primaryFinding;
    const change = insightSummary.biggestChanges.find(c => c.key === pf.key);

    // V2-03 amendment 5: exhaustive, so no movement can read "unchanged".
    const trajectory = primaryTrajectory(change, primaryBandLanguage);

    const currentStatus: PrimaryContext['current_status'] =
      pf.status === 'out_of_range' ? (pf.direction === 'high' ? 'elevated' : pf.direction === 'low' ? 'low' : 'out_of_range')
      : pf.status === 'borderline' ? 'borderline'
      : 'in_range';

    return {
      primary_biomarker: pf.displayName,
      canonical_slug: pf.key,
      current_value: pf.value,
      previous_value: change?.previousValue ?? null,
      unit: pf.unit,
      current_status: currentStatus,
      trajectory,
      percent_change: change?.percentDelta ?? null,
      prior_report_date: change?.priorReportDate ?? null,
      supporting_biomarker: null,
    };
  }, [insightSummary, primaryBandLanguage]);

  const primaryCategory = useMemo<BiomarkerCategory | null>(() => {
    if (!insightSummary?.primaryFinding) return null;
    return getCategory(insightSummary.primaryFinding.key as BiomarkerName) ?? null;
  }, [insightSummary]);

  const flaggedSlugs = useMemo<BiomarkerName[]>(
    () => scoredBiomarkers.filter(s => markerBandPlacement(s.key, s.value, report?.estimated_cycle_phase) === 'outside').map(s => s.key),
    [scoredBiomarkers, report?.estimated_cycle_phase],
  );

  const flaggedCategories = useMemo<BiomarkerCategory[]>(
    () => Array.from(new Set(flaggedSlugs.map(s => getCategory(s)).filter(Boolean) as BiomarkerCategory[])),
    [flaggedSlugs],
  );

  const focusAreas = useMemo(() => {
    if (!insightSummary) return [];
    return buildFocusAreas(
      insightSummary,
      insightSummary.watchSignals,
      scoredBiomarkers.filter(s => markerBandPlacement(s.key, s.value, report?.estimated_cycle_phase) === 'outside'),
      null,
      primaryCategory,
    );
  }, [insightSummary, scoredBiomarkers, primaryCategory, report?.estimated_cycle_phase]);

  const guidanceCards = useMemo(() => {
    const primaryFocusId = focusAreas.find((a) => a.isPrimaryAligned)?.id ?? null;
    return buildCards(focusAreas, primaryFocusId);
  }, [focusAreas]);

  const healthStory = useMemo(() => {
    if (!insightSummary) return { sentences: [] };
    return withBandReview(buildHealthStory({
      primaryContext: frontendPrimaryContext,
      focusAreas,
      primaryCategory,
    }), frontendPrimaryContext?.trajectory, primaryBandLanguage);
  }, [insightSummary, frontendPrimaryContext, focusAreas, primaryCategory, primaryBandLanguage]);

  const groupedBiomarkers = useMemo(() => {
    const groups: Partial<Record<BiomarkerCategory, Biomarker[]>> = {};
    for (const b of biomarkers) {
      const cat = getCategory(b.name as BiomarkerName);
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

  useEffect(() => {
    if (biomarkers.length === 0 || categoriesInitialized) return;
    // Default: collapse every system. Auto-expand only the system containing the primary finding.
    const toCollapse = new Set<BiomarkerCategory>();
    const primaryKey = insightSummary?.primaryFinding?.key ?? null;
    const primaryCategory = primaryKey
      ? getCategory(primaryKey as BiomarkerName)
      : null;
    for (const cat of CATEGORY_ORDER) {
      const items = sortedGroupedBiomarkers[cat];
      if (!items || items.length === 0) continue;
      if (cat !== primaryCategory) toCollapse.add(cat);
    }
    setCollapsedCategories(toCollapse);
    setCategoriesInitialized(true);
  }, [biomarkers, sortedGroupedBiomarkers, categoriesInitialized, insightSummary]);

  const interpMap = useMemo(() => {
    if (!interpretation?.biomarkers) return new Map<string, NonNullable<AIInterpretation['biomarkers']>[number]>();
    return new Map(interpretation.biomarkers.map(b => [b.name, b]));
  }, [interpretation]);

  /*
    Owner R1: model prose is a proposal. Each model field below renders only
    the sentences that resolve to a claim this page issued from the report's
    own measured changes; everything else is suppressed, not labelled. A
    marker card may only state its own marker's claim.
  */
  const movementClaims = useMemo(() => movementClaimsByKey(insightSummary?.deltaMap ?? []), [insightSummary]);
  const reportClaims = useMemo(() => [...movementClaims.values()], [movementClaims]);
  const modelProse = useMemo(() => ({
    headline: authorizeModelProse('interpretation.headline', interpretation?.headline, reportClaims),
    summary: authorizeModelProse('interpretation.summary_bullets', interpretation?.summary_bullets, reportClaims),
    patterns: (interpretation?.pattern_signals ?? []).flatMap(signal => {
      const prose = [
        ...authorizeModelProse('interpretation.pattern_signals.title', signal?.title, reportClaims),
        ...authorizeModelProse('interpretation.pattern_signals.explanation', signal?.explanation, reportClaims),
      ];
      return prose.length > 0 ? [prose] : [];
    }),
  }), [interpretation, reportClaims]);
  const markerProse = useMemo(() => {
    const map = new Map<string, AuthorizedModelProse[]>();
    for (const b of biomarkers) {
      const interp = interpMap.get(b.name) ?? interpMap.get(b.name.replace(/_/g, ' '));
      const claim = movementClaims.get(b.name as BiomarkerName);
      if (!interp || !claim) continue;
      const seen = new Set<string>();
      const prose = [
        ...authorizeModelProse('interpretation.biomarkers.plain_english_meaning', interp.plain_english_meaning, [claim]),
        ...authorizeModelProse('interpretation.biomarkers.timing_notes', interp.timing_notes, [claim]),
        ...authorizeModelProse('interpretation.biomarkers.common_non_alarm_reasons', interp.common_non_alarm_reasons, [claim]),
        ...authorizeModelProse('interpretation.biomarkers.when_clinicians_follow_up', interp.when_clinicians_follow_up, [claim]),
      ].filter(p => !seen.has(p.language.text) && !!seen.add(p.language.text));
      if (prose.length > 0) map.set(b.name, prose);
    }
    return map;
  }, [biomarkers, interpMap, movementClaims]);

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

  // `retry === true` only from the failed-regenerate retry action; a click
  // passes its event, which is a new tap.
  const handleRegenerate = async (retry?: unknown) => {
    if (!report || report.regeneration_count >= 3) return;
    if (freemium ? !freemiumCanRegenerate(accessState, report.regeneration_count) : !entitled) return;
    const requestId = regenerationRequests.next(retry === true);
    setRegenerating(true);
    setError('');
    setRegenerateFailure(null);
    const priorStatus = report.status;
    const analysisOnScreen = interpretation !== null;
    writeInterpRateLimit(reportId, null);
    setRateLimitNotice(null);
    /*
      PK-PL-A (Adell's pre-launch ruling), both flag states. A failed regenerate
      wrote nothing: the server appends a version only on success, keyed by
      request_id, so the retry below can never append twice. So it spends no
      attempt and never brands the report "error" — put back the status and the
      attempt spent optimistically, then say what happened: 402 → Premium (the
      paywall flag on; pricing or billing flag off), 429 → the daily-limit
      notice, anything else → a calm notice whose wording and retry follow the
      server's answer (lib/regenerationFailure.ts).

      Flag off with no analysis on screen the first analysis itself failed, and
      the report has none: it stays marked failed for the existing retry card,
      as before — its attempt is still put back.
    */
    const fail = async (err: unknown) => {
      const redirect = freemium ? null : await handle402(err);
      const limitMessage = await rateLimitMessage(err);
      const kind = limitMessage ? 'rate_limited' : await regenerationFailureOf(err);
      const noAnalysis = !freemium && !analysisOnScreen && (kind === 'retryable' || kind === 'unavailable');
      await supabase.from('lab_reports').update({
        status: noAnalysis ? 'error' : priorStatus,
        regeneration_count: report.regeneration_count,
      }).eq('id', reportId);
      if (redirect) { navigate(redirect, { replace: true }); return; }
      // Re-read first: a stored analysis clears any old daily-limit notice, and
      // this one is new.
      await fetchReport();
      if (limitMessage) {
        writeInterpRateLimit(reportId, limitMessage);
        setRateLimitNotice(limitMessage);
      } else if (kind === 'premium_required' && freemium) {
        setPaywallOpen(true);
      } else if (!noAnalysis) {
        const notice: RegenerationNoticeKind = kind === 'already_saved' || kind === 'unavailable' ? kind
          : kind === 'premium_required' ? 'unavailable' : 'retryable';
        setRegenerateFailure({ kind: notice, retry: notice === 'retryable' });
      }
      // The answer changed what is true for this report (the analysis another
      // request saved, or the server's availability): read it again.
      if (freemium && (kind === 'already_saved' || kind === 'unavailable')) refreshAccess();
    };
    let failure: { error: unknown } | null = null;
    try {
      /*
        Deliberately NOT deleting the existing interpretation first. Once the
        report holds one, `generate-interpretation` appends a new version keyed
        by `request_id` (TASK-048) and the readers serve it; the historical row
        is never replaced. Deleting up front opened a
        window where any failure — a 429 on the daily cap, a dropped connection,
        a 500 — destroyed the interpretation the user already had and could not
        get back, since the retry that would have replaced it is the thing that
        just failed.
      */
      await supabase.from('lab_reports').update({
        status: 'processing',
        regeneration_count: report.regeneration_count + 1,
      }).eq('id', reportId);
      const { data: fnData, error: interpError } = await supabase.functions.invoke('generate-interpretation', {
        body: {
          reportId,
          primary_canonical_slug: insightSummary?.primaryFinding?.key ?? null,
          request_id: requestId,
        },
      });
      if (!interpError) noteAiPaused(reportId, isAiPausedResponse(fnData));
      if (interpError && await isAiPausedError(interpError)) {
        // PK-FIX-01b (D12): the AI is paused, so nothing was generated and the
        // explanation she has stands. Put back the status and the attempt spent
        // above, and say so calmly (DT9) instead of a failure notice.
        await supabase.from('lab_reports').update({
          status: priorStatus,
          regeneration_count: report.regeneration_count,
        }).eq('id', reportId);
        noteAiPaused(reportId, true);
        await fetchReport();
      } else if (interpError || !fnData?.success) {
        failure = { error: interpError };
      } else {
        regenerationRequests.settle();
        await fetchReport();
        if (freemium) refreshAccess();
      }
    } catch (err) {
      failure = { error: err };
    }
    try {
      if (failure) await fail(failure.error);
    } finally {
      setRegenerating(false);
    }
  };

  /*
    Flag on: the generate action for `generation_needed`. The same request the
    legacy auto-generation makes, without touching `regeneration_count` — that
    caps regenerating an existing analysis, not producing the first one. The
    server decides Full or Basic; afterwards the page asks get-interpretation
    once. Never opens a paywall: a report that is not ready yet is not an
    upsell moment. A 402 shows the Premium entry point in place of the
    generate action instead of retrying into the same refusal.

    PK-PL-A: when a body is already stored (the fuller-analysis offer), the
    report holds its interpretation, so the server appends a version keyed by
    request_id and refuses an unkeyed request (400 request_id_required) — which
    used to leave this offer silently doing nothing. It is keyed like a
    regenerate tap, still without spending a regeneration attempt, and a failure
    says calmly that the stored analysis is unchanged.
  */
  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setGeneratePremiumRequired(false);
    setRegenerateFailure(null);
    writeInterpRateLimit(reportId, null);
    setRateLimitNotice(null);
    const storedBody = accessState?.access === 'generation_needed' && accessState.interpretation !== null;
    const requestId = storedBody ? regenerationRequests.next(false) : null;
    let refresh = true;
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('generate-interpretation', {
        body: {
          reportId, primary_canonical_slug: insightSummary?.primaryFinding?.key ?? null,
          ...(requestId ? { request_id: requestId } : {}),
        },
      });
      if (requestId && !invokeErr && data?.success) regenerationRequests.settle();
      if (!invokeErr) noteAiPaused(reportId, isAiPausedResponse(data));
      if (invokeErr && generateFailureKind(httpStatus(invokeErr)) === 'premium_required') {
        refresh = false;
        setGeneratePremiumRequired(true);
      } else if (invokeErr) {
        const limitMessage = await rateLimitMessage(invokeErr);
        if (limitMessage) {
          // Nothing was generated; asking again would only spend the read quota.
          refresh = false;
          writeInterpRateLimit(reportId, limitMessage);
          setRateLimitNotice(limitMessage);
        } else if (storedBody) {
          const kind = await regenerationFailureOf(invokeErr);
          // The offer itself stays on the page as the way to try again.
          setRegenerateFailure({ kind: kind === 'already_saved' || kind === 'unavailable' ? kind : 'retryable', retry: false });
        }
      }
    } catch {
      // Fall through to a fresh read, which renders whatever is true now.
      if (storedBody) setRegenerateFailure({ kind: 'retryable', retry: false });
    } finally {
      setGenerating(false);
      if (refresh) refreshAccess();
    }
  };

  // Server-side deletion (delete-report): the report graph AND the uploaded
  // file. Leave only on confirmed success; otherwise say exactly what is left.
  const handleDelete = async () => {
    if (deleting) return;
    if (!deleteFilePending && !confirm('Delete this report and any uploaded lab file? This cannot be undone.')) return;
    setDeleting(true);
    setError('');
    const outcome = await requestReportDeletion(
      (name, options) => supabase.functions.invoke(name, options),
      reportId,
    );
    setDeleting(false);
    if (outcome.kind === 'deleted') {
      navigate('/app', { replace: true });
      return;
    }
    if (outcome.kind === 'file_pending') setDeleteFilePending(true);
    setError(outcome.message);
  };

  const formatDate = (d: string) => {
    if (!d) return '—';
    const base = d.length === 10 ? d + 'T12:00:00' : d;
    return new Date(base).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-theme-primary" />
        </div>
      </Layout>
    );
  }

  if (!report) {
    return (
      <Layout>
        <div className="text-center py-12">
          <h1 className="text-xl text-theme-neutral-900 mb-4">Report not found</h1>
          <Link to="/app"><Button>Back to Dashboard</Button></Link>
        </div>
      </Layout>
    );
  }

  const canRegenerate = freemium
    ? freemiumCanRegenerate(accessState, report.regeneration_count)
    : report.regeneration_count < 3 && entitled;
  /*
    This report was written at the Free tier, so it holds the deterministic
    interpretation rather than the AI one. A Plus subscriber can turn it into
    the full analysis on demand.

    Deliberately NOT automatic on upgrade: regenerating a whole history at once
    would be a surprise OpenAI bill and a load spike, for reports the user may
    never open again. One click, on the report they are actually looking at.

    Plus spends no Introductory Deep Access credit for this — decideIntroductoryAccess
    returns `plus` with consumesCredit false — but `regeneration_count` still
    caps it at 3, which is the existing abuse control and applies unchanged.

    Null tier means the row predates Free/Plus and is already an AI
    interpretation, so no offer is shown.
  */
  const canUpgradeInterpretation = canRegenerate && interpretationTier === 'free';
  const cyclePhase = report.estimated_cycle_phase !== 'unknown' ? report.estimated_cycle_phase : null;
  const hasError = report.status === 'error';
  // A rate-limited report sits at 'processing' because the server refused to
  // start rather than failed — but nothing is coming, so stop hiding her lab
  // values behind a spinner that will never resolve.
  const isProcessing = (report.status === 'processing' || regenerating) && !rateLimitNotice;

  /*
    The header slot (D19): ReportView's own state and handlers for its
    actions; src/features/report/header decides which is the one primary and
    what goes in More. The rule for offering a regeneration is the one the
    header button always had.
  */
  const headerContext: ReportHeaderContext = {
    report,
    navigate,
    regeneration: {
      available: canRegenerate && !(freemium && accessState?.access === 'generation_needed' && !interpretation),
      upgrade: canUpgradeInterpretation,
      remaining: 3 - report.regeneration_count,
      busy: regenerating,
      run: () => { void handleRegenerate(); },
    },
    deleteReport: () => { void handleDelete(); },
    deleting,
    deleteFilePending,
    reportProblem: isFeatureEnabled(INTERPRETATION_FEEDBACK_FLAG) ? () => setReportProblemOpen(true) : undefined,
  };

  const freemiumPanel = freemium ? (
    <FreemiumReportPanel
      state={accessState}
      floorSummary={insightSummary}
      generating={generating}
      premiumRequired={generatePremiumRequired}
      plan={plan}
      // Fallback only — the panel prefers the figure get-interpretation returned.
      // A failed ledger read leaves the hook's default of 0 used; never show that as fact.
      complimentaryUsed={subscriptionError ? null : complimentary.used}
      onRetry={refreshAccess}
      onGenerate={() => { void handleGenerate(); }}
      onOpenPaywall={() => setPaywallOpen(true)}
    />
  ) : null;

  const resolvedLabSource: LabSource = (() => {
    if (report.lab_source && report.lab_source !== 'unknown') return report.lab_source;
    return 'unknown';
  })();

  return (
    <Layout>
      {freemium && (
        <PremiumPaywall
          open={paywallOpen}
          onClose={() => setPaywallOpen(false)}
          onEntitled={() => { void refetchSubscription(); setGeneratePremiumRequired(false); refreshAccess(); }}
        />
      )}
      <div className="max-w-3xl mx-auto">

        {/* ── A. Header ──────────────────────────────────────────── */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-2xl text-theme-text tracking-tight">
              Lab Report: {formatDate(report.report_date)}
            </h1>
            <p className="text-sm text-theme-muted-text-3 mt-1">
              <span className="font-medium text-theme-muted-text-2">Lab date:</span> {formatDate(report.report_date)}
              {report.upload_date && report.upload_date.split('T')[0] !== report.report_date && (
                <span className="ml-2 text-theme-muted-text-3">
                  (uploaded {formatDate(report.upload_date)})
                </span>
              )}
            </p>
            {/*
              PK-FIX-06-EXT (D10): the cycle day comes first, and any phase is
              labelled as the estimate it is. It replaces the phase pill, which
              wore a status tint (DESIGN.md: phase tints are never status). The
              same ReportCycleLine is on the dashboard and the Reports list.
            */}
            <ReportCycleLine report={report} as="p" className="text-sm text-theme-text mt-1" />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-xs text-theme-muted-text-3">{biomarkers.length} core biomarkers</span>
              {reportAnalytes.length > 0 && (
                <span className="text-xs text-theme-muted-text-3">{reportAnalytes.length} total analytes</span>
              )}
              {resolvedLabSource !== 'unknown' && (
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                  resolvedLabSource === 'quest'
                    ? 'text-theme-flag-ok bg-theme-flag-ok-bg border-theme-flag-ok-border'
                    : 'text-theme-info bg-theme-info-bg border-theme-info-border'
                }`}>
                  <FlaskConical className="w-3 h-3" />
                  Imported from {resolvedLabSource === 'quest' ? 'Quest' : 'Labcorp'}
                </span>
              )}
              {dominantSourceFormat && (
                <span className="text-xs text-theme-muted-text-3 px-1.5 py-0.5 rounded border border-theme-border">
                  Source: {dominantSourceFormat === 'ocr' ? 'OCR' : dominantSourceFormat.charAt(0).toUpperCase() + dominantSourceFormat.slice(1)}
                </span>
              )}
            </div>
          </div>
          {/* One primary action plus a labelled More menu (D19): src/features/report/header. */}
          <ReportHeaderActions context={headerContext} />
        </div>

        {/* ── Cycle rule (DESIGN.md, D10): the draw day on her cycle ── */}
        <CycleRule report={report} />

        {error && (
          <div className="bg-theme-flag-low-bg border border-theme-flag-low-border text-theme-flag-low px-4 py-3 rounded-xl mb-6 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-8">

          {/* ── Processing ──────────────────────────────────────── */}
          {isProcessing && (
            <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface px-6 py-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-theme-primary/10 flex items-center justify-center flex-shrink-0">
                <Loader2 className="w-5 h-5 text-theme-primary animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-theme-text">Generating your analysis</p>
                <p className="text-xs text-theme-muted-text-3 mt-0.5">This usually takes 15–30 seconds.</p>
              </div>
            </div>
          )}

          {/* ── Daily AI limit reached ──────────────────────────── */}
          {rateLimitNotice && (
            <div className="rounded-2xl border border-theme-flag-watch-border bg-theme-flag-watch-bg p-5 space-y-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-theme-flag-watch flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-theme-flag-watch">Daily analysis limit reached</p>
                  <p className="text-xs text-theme-flag-watch mt-1 leading-relaxed">{rateLimitNotice}</p>
                </div>
              </div>
              {(biomarkers.length > 0 || reportAnalytes.length > 0) && (
                <div className="flex items-center gap-2 text-xs text-theme-flag-watch bg-theme-flag-watch-bg/60 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-theme-flag-ok flex-shrink-0" />
                  <span>{reportAnalytes.length || biomarkers.length} lab values detected. Your data is saved and intact below.</span>
                </div>
              )}
              {canRegenerate && (
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-theme-warning text-white text-sm font-semibold rounded-xl hover:bg-theme-warning-dark transition-colors disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} />
                  {regenerating ? 'Retrying...' : 'Try again'}
                </button>
              )}
            </div>
          )}

          {/* ── Flag on: a failed refresh never hides the body on screen ── */}
          {freemium && accessInlineError && !isProcessing && (
            <AccessErrorNotice state={accessInlineError} onRetry={refreshAccess} inline />
          )}
          {/* ── Both flag states (PK-PL-A): a failed regenerate is a calm notice above the intact analysis ── */}
          {regenerateFailure && !isProcessing && (
            <AccessErrorNotice
              state={null}
              inline
              title={REGENERATION_COPY[regenerateFailure.kind].title}
              body={REGENERATION_COPY[regenerateFailure.kind].body}
              onRetry={regenerateFailure.retry && canRegenerate ? () => { void handleRegenerate(true); } : undefined}
            />
          )}

          {/* ── Error state ─────────────────────────────────────── */}
          {!freemium && hasError && !interpretation && interpGaveUp && !rateLimitNotice && (() => {
            const hasData = biomarkers.length > 0 || reportAnalytes.length > 0;
            const reason = !hasData
              ? 'No lab values were extracted. The PDF may be image-based.'
              : 'The AI analysis timed out or hit an error. Your lab data is intact below.';
            return (
              <div className="rounded-2xl border border-theme-flag-low-border bg-theme-flag-low-bg p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-theme-flag-low flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-theme-flag-low">AI summary failed</p>
                    <p className="text-xs text-theme-flag-low mt-1 leading-relaxed">{reason}</p>
                  </div>
                </div>
                {hasData && (
                  <div className="flex items-center gap-2 text-xs text-theme-flag-low bg-theme-flag-low-bg/60 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-theme-flag-ok flex-shrink-0" />
                    <span>{reportAnalytes.length || biomarkers.length} lab values detected. Your data is intact below.</span>
                  </div>
                )}
                {canRegenerate ? (
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-theme-flag-low text-white text-sm font-semibold rounded-xl hover:bg-theme-flag-low transition-colors disabled:opacity-60"
                  >
                    <RefreshCw className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} />
                    {regenerating ? 'Retrying...' : `Retry summary (${3 - report.regeneration_count} of 3 left)`}
                  </button>
                ) : (
                  <p className="text-xs text-theme-flag-low">All retry attempts used. Your lab data is visible below.</p>
                )}
              </div>
            );
          })()}

          {/* ── AI loading indicator (ready/error but no interpretation yet) ─── */}
          {(report.status === 'ready' || report.status === 'error') && !interpretation && !isProcessing && !interpGaveUp && !rateLimitNotice && insightSummary && (!freemium || accessLoading) && (
            <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface px-6 py-4 flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-theme-primary animate-spin flex-shrink-0" />
              <p className="text-sm text-theme-muted-text-2">AI summary is being generated. Your lab data is ready below.</p>
            </div>
          )}

          {/* ── Flag on: error / generate states sit with the status notices ── */}
          {freemiumPanel && !isProcessing && !accessLoading && !rateLimitNotice
            && (generating || accessState?.access === 'error' || accessState?.access === 'generation_needed')
            && freemiumPanel}

          {/* ── A. Safety channel: approved deterministic rules only, never band-derived ── */}
          {!isProcessing && <SafetyWarnings warnings={safetyWarnings} />}

          {/* ── Notices slot (R22): calm notices about the explanation below, from src/features/report/notices ── */}
          {!isProcessing && (
            <ReportNotices
              report={report}
              versions={{ shown: interpretation ? shownExplanation ?? UNIDENTIFIED_EXPLANATION : null, aiPaused }}
            />
          )}

          {/* ── B. Amani Summary (Headline) ──────────────────────── */}
          {(insightSummary || interpretation) && !isProcessing && (
            <div className="rounded-2xl overflow-hidden border border-theme-border-subtle shadow-sm">
              {/*
                Deep plum, not near-black. A single #0D2033 block dropped into an
                otherwise warm light page reads as a copy-paste accident; the
                accent is still high-contrast enough to carry the headline but
                belongs to the palette, so it reads as deliberate emphasis.
              */}
              <div className="bg-theme-accent px-6 py-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <Sparkles className="w-4 h-4 text-theme-primary" />
                  <span className="text-xs font-medium text-theme-muted-text-3 uppercase tracking-widest">Amani analysis</span>
                  {insightSummary && (
                    <div className="ml-auto">
                      <ConfidenceBadge confidence={insightSummary.confidence} />
                    </div>
                  )}
                </div>
                <h2 className="text-lg text-white leading-snug">
                  {(() => {
                    const ctx = insightSummary ? getOpeningContext(insightSummary) : null;
                    const isImproving = ctx?.primaryIsImproving && ctx?.primaryImprovingChange !== null;
                    const isWorsening = ctx?.primaryIsWorsening && ctx?.primaryWorseningChange !== null;
                    const isStableAbnormal = ctx?.primaryIsStableAbnormal && ctx?.primaryStableChange !== null;

                    if (insightSummary) {
                      // A comparison trajectory authorizes observations, never
                      // judgement or advice, in either direction (R1, R2).
                      const observedChange = isImproving ? ctx.primaryImprovingChange
                        : isWorsening ? ctx.primaryWorseningChange
                        : isStableAbnormal ? ctx.primaryStableChange : null;
                      if (observedChange) {
                        return <ClinicalObservation language={describeMeasuredMovement(observedChange)} />;
                      }

                      // Amani writes the headline from its own data. A model headline
                      // is not authority for clinical meaning ("because the LLM
                      // generated it" is inadmissible), and it could read "all within
                      // range" while a card says otherwise (Phase 8B, kept).
                      const labFindings = insightSummary.labFindings ?? [];
                      if (labFindings.length > 0) {
                        const ordered = [...labFindings].sort((a, b) => Number(b.key === insightSummary.primaryFinding?.key) - Number(a.key === insightSummary.primaryFinding?.key));
                        return ordered.map(f => f.labLanguage ? <ClinicalObservation key={f.key} language={{ ...f.labLanguage, text: `${f.labLanguage.text} ` }} /> : null);
                      }
                      const outside = scoredBiomarkers
                        .filter(s => markerBandPlacement(s.key, s.value, cyclePhase) === 'outside')
                        .map(s => ({ name: getDisplayName(s.key), language: markerBandLanguage.get(s.key) ?? authorizedLanguage(null) }));
                      const headline = reportHeadline(markerBandLanguage.size, outside, combineLanguage([...markerBandLanguage.values()]));
                      return <ClinicalObservation language={headline} />;
                    }
                    const modelHeadline = modelProse.headline[0];
                    return modelHeadline ? <ModelProse prose={modelHeadline} /> : REPORT_TITLE;
                  })()}
                </h2>
              </div>

              {/* Top Priority — Deterministic direction override for all trajectory states */}
              {(() => {
                const ctx = insightSummary ? getOpeningContext(insightSummary) : null;
                const isImproving = ctx?.primaryIsImproving && ctx?.primaryImprovingChange !== null;
                const isWorsening = ctx?.primaryIsWorsening && ctx?.primaryWorseningChange !== null;
                const isStableAbnormal = ctx?.primaryIsStableAbnormal && ctx?.primaryStableChange !== null;

                // Comparison movement and magnitude keep a neutral attention cue.
                // AI prose is not independent authority for advice in this channel.
                // V2-03b: movement toward a band is the same observation; its
                // green "right direction" branch had only a boolean's authority.
                const observedChange = isImproving ? ctx.primaryImprovingChange
                  : isWorsening ? ctx.primaryWorseningChange
                  : isStableAbnormal ? ctx.primaryStableChange : null;
                if (observedChange && insightSummary?.primaryFinding) {
                  return (
                    <div data-testid="primary-movement-observation" className="border-b border-theme-border-inner bg-theme-background-tint px-6 py-5">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 bg-theme-surface">
                          <ArrowRightLeft aria-hidden="true" className="w-5 h-5 text-theme-muted-text-2" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-bold text-theme-text mb-2 leading-snug">{insightSummary.primaryFinding.displayName}</p>
                          <p className="text-sm text-theme-text-body leading-relaxed">
                            <ClinicalObservation language={describeMeasuredMovement(observedChange)} />{' '}
                            <ClinicalObservation language={describeComparisonBand(primaryBandLanguage, 'outside')} />
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }

                // V2-03b: the model's primary_concern title, summary and
                // why_it_matters no longer render here. A model is not authority
                // for clinical meaning, and the warning triangle signalled danger
                // from an unreviewed band. The deterministic finding remains.
                if (insightSummary?.primaryFinding) {
                  return (
                    <div data-testid="primary-finding" className="border-b border-theme-border-inner bg-theme-background-tint px-6 py-5">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-theme-surface flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Info aria-hidden="true" className="w-5 h-5 text-theme-muted-text-2" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-extrabold text-theme-muted-text-2 uppercase tracking-[0.15em] mb-2">
                            {PRIMARY_FINDING_LABEL}
                          </p>
                          <p className="text-base font-bold text-theme-text mb-2 leading-snug">
                            {insightSummary.primaryFinding.displayName}
                          </p>
                          <p className="text-sm text-theme-text-body leading-relaxed">
                            {primaryFindingSentence(insightSummary.primaryFinding, primaryBandLanguage)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }

                return null;
              })()}

              {/* Summary bullets: only those that resolve to a measured-change claim (owner R1) */}
              {modelProse.summary.length > 0 && (
                <div className="bg-theme-surface px-6 py-5" data-model-surface="summary_bullets">
                  <ul className="space-y-3">
                    {modelProse.summary.map(prose => (
                      <li key={prose.language.text} className="flex items-start gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-theme-primary flex-shrink-0 mt-2" />
                        <p className="text-sm text-theme-text-body leading-relaxed"><ModelProse prose={prose} /></p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </div>
          )}

          {/* ── B1. Your Health Story (NEW — narrative paragraph after Amani Analysis) ─── */}
          {!isProcessing && healthStory.sentences.length > 0 && (
            <YourHealthStory story={healthStory} />
          )}

          {/* ── B2. Your Trajectory (top-level, after Health Story) ─── */}
          {insightSummary && !isProcessing && (
            <YourTrajectoryCard
              changes={insightSummary.biggestChanges}
              primaryFinding={insightSummary.primaryFinding}
              reportCount={historicalReportCount}
              bandLanguage={bandLanguageByKey(insightSummary.deltaMap.values())}
            />
          )}

          {/* ── B3. Focus Areas (NEW — system-level deterministic cards) ─── */}
          {!isProcessing && focusAreas.length > 0 && (
            <FocusAreas focusAreas={focusAreas} />
          )}

          {!isProcessing && guidanceCards.length > 0 && (
            <GuidanceCards cards={guidanceCards} />
          )}

          {/* ── B4. Next Best Steps: not mounted (V2-03b Stage 2, owner R4).
              Every item is model-written what_you_can_do_now / what_to_do_next.
              Its "Support" bucket is food, nutrient, supplement and lifestyle
              advice tied to her result with no Clinical Truth rule, and the
              keyword bucketing cannot keep that advice out of the others
              ("Ask your doctor whether an iron supplement makes sense" files
              under Discuss). Suppressed whole, not relabelled. ─── */}

          {/* ── Flag on: Basic insights, Premium Preview, locked cards ── */}
          {freemiumPanel && !isProcessing && !accessLoading && !generating
            && (accessState?.access === 'basic' || accessState?.access === 'full')
            && freemiumPanel}

          {/* Legacy cards removed in this consolidation pass:
              - PrimaryInsightCard (subsumed by Your Health Story)
              - TopFindingsCard (subsumed by Focus Areas)
              - BiggestChangesCard (subsumed by Your Trajectory)
              - YourPatternsCard (subsumed by Your Health Story)
              - WhatToWatchCard (subsumed by Focus Areas)
              - inline "Next Steps" + WhatToDoNextCard (merged into Next Best Steps)
              See git history for the original implementations. */}

          {/* ── E. More Details (Pattern Signals, Flags, Derived) ── */}
          {(modelProse.patterns.length > 0 || insightFlags.length > 0 || derivedMetrics.length > 0) && (
            <div className="rounded-2xl border border-theme-neutral-200 overflow-hidden">
              <button
                className="flex items-center justify-between w-full px-5 py-4 text-left bg-theme-surface hover:bg-theme-neutral-50 transition-colors"
                onClick={() => setShowMoreDetails(v => !v)}
              >
                <div className="flex items-center gap-2.5">
                  <Activity className="w-4 h-4 text-theme-muted-text-2" />
                  <span className="text-sm font-semibold text-theme-text">Patterns & Insights</span>
                  <span className="text-xs text-theme-muted-text-3">signals, flags, derived metrics</span>
                </div>
                {showMoreDetails
                  ? <ChevronDown className="w-4 h-4 text-theme-neutral-400" />
                  : <ChevronRight className="w-4 h-4 text-theme-neutral-400" />
                }
              </button>
              {showMoreDetails && (
                <div className="border-t border-theme-neutral-100 px-5 py-5 space-y-6">
                  {modelProse.patterns.length > 0 && (
                    <div className="space-y-3" data-model-surface="pattern_signals">
                      <p className="text-xs font-bold text-theme-muted-text-3 uppercase tracking-widest">Measured changes</p>
                      {modelProse.patterns.map(prose => (
                        <div key={prose.map(p => p.language.text).join('|')} className="rounded-xl border border-theme-neutral-200 bg-theme-neutral-50 p-4">
                          <p className="text-xs leading-relaxed text-theme-neutral-600"><ModelProseText items={prose} /></p>
                        </div>
                      ))}
                    </div>
                  )}
                  {insightFlags.length > 0 && <InsightFlagsPanel flags={insightFlags} />}
                  {derivedMetrics.length > 0 && <DerivedMetricsPanel metrics={derivedMetrics} />}
                </div>
              )}
            </div>
          )}

          {/* ── F. Full Lab Panel (accordion) ───────────────────── */}
          {totalAnalyteCount > 0 && (
            <div className="rounded-2xl border border-theme-neutral-200 overflow-hidden">
              <button
                className="flex items-center justify-between w-full px-5 py-4 text-left bg-theme-surface hover:bg-theme-neutral-50 transition-colors"
                onClick={() => setShowFullPanel(v => !v)}
              >
                <div className="flex items-center gap-2.5">
                  <Microscope className="w-4 h-4 text-theme-muted-text-2" />
                  <span className="text-sm font-semibold text-theme-text">Full lab panel</span>
                  <span className="text-xs text-theme-muted-text-3">({totalAnalyteCount} items)</span>
                </div>
                {showFullPanel
                  ? <ChevronDown className="w-4 h-4 text-theme-neutral-400" />
                  : <ChevronRight className="w-4 h-4 text-theme-neutral-400" />
                }
              </button>
              {showFullPanel && (
                <div className="px-5 pb-5 pt-1 border-t border-theme-neutral-100 space-y-6">
                  {Object.entries(analytesForDisplay)
                    .sort(([a], [b]) => a === 'Unmapped' ? 1 : b === 'Unmapped' ? -1 : a.localeCompare(b))
                    .map(([cat, items]) => (
                      <div key={cat}>
                        <h3 className="text-xs text-theme-neutral-400 uppercase tracking-widest mb-2">{cat}</h3>
                        <div className="divide-y divide-theme-neutral-100">
                          {items.map(item => <ResultRow key={item.id} analyte={item} cyclePhase={cyclePhase} />)}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ── G. Recommended Labs (component owns its own heading + empty-state) */}
          <RecommendedLabs
            presentBiomarkers={presentBiomarkerNames}
            activeCategory={activeCategory}
            primaryCategory={primaryCategory}
            flaggedSlugs={flaggedSlugs}
            flaggedCategories={flaggedCategories}
          />

          {/* ── Cycle context ─────────────────────────────────────── */}
          {!isProcessing && (() => {
            // Phase/day always come from the report; see cycleContextCard.
            const card = cycleContextCard(report, interpretation?.cycle_context, reportClaims);
            if (!card) return null;
            return (
              <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface px-5 py-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <CalendarDays className="w-4 h-4 text-theme-primary" />
                  <h3 className="text-sm text-theme-text">Cycle context</h3>
                  {card.confidence && (
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border font-medium ${CONFIDENCE_STYLE[card.confidence]}`}>
                      {card.confidence} confidence
                    </span>
                  )}
                </div>
                {/* D10: the cycle day first; a phase is labelled as an estimate. */}
                <div className="flex gap-4 mb-3">
                  {card.day && (
                    <div>
                      <p className="text-xs text-theme-muted-text-3">Cycle day</p>
                      <p className="text-sm font-semibold text-theme-text mt-0.5">{card.day}</p>
                    </div>
                  )}
                  {card.phase && (
                    <div>
                      <p className="text-xs text-theme-muted-text-3">Phase</p>
                      <p className="text-sm font-semibold text-theme-text capitalize mt-0.5">
                        {card.phase}
                      </p>
                      <p className="text-xs text-theme-muted-text-2 mt-0.5" data-cycle-phase-estimate>{PHASE_ESTIMATE_LABEL}</p>
                    </div>
                  )}
                  {/* A stored phase the cycle rule does not draw: the report's own record, never an estimate (Q13). */}
                  {card.recordedPhase && (
                    <div data-cycle-phase-recorded>
                      <p className="text-xs text-theme-muted-text-3">Phase recorded with this report</p>
                      <p className="text-sm font-semibold text-theme-text capitalize mt-0.5">
                        {card.recordedPhase.replace(/_/g, ' ')}
                      </p>
                    </div>
                  )}
                </div>
                {/* PK-FIX-06: a cycle day shown without a phase says why, neutrally. */}
                {card.phaseNote && (
                  <p className="text-xs text-theme-muted-text-2 leading-relaxed" data-cycle-phase-note>
                    {card.phaseNote}
                  </p>
                )}
                {card.explanation && (
                  <p className="text-xs text-theme-muted-text-2 leading-relaxed" data-model-surface="cycle_context">
                    <ModelProse prose={card.explanation} />
                  </p>
                )}
              </div>
            );
          })()}

          {/* ── Discussion preparation (deterministic, DISCUSSION_PREP_PROMPT) ──────── */}
          {insightSummary && !isProcessing && insightSummary.questionsForDoctor.length > 0 && (
            <DoctorQuestionsCard questions={insightSummary.questionsForDoctor} />
          )}

          {/* ── Health Systems (drill-down to underlying biomarkers) ── */}
          {biomarkers.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base text-theme-text">
                  Health Systems
                  {activeCategory && (
                    <span className="ml-2 text-sm font-normal text-theme-primary">
                      : {systemDisplayLabel(activeCategory)}
                      <button onClick={() => setActiveCategory(null)} className="ml-2 underline text-xs">
                        clear
                      </button>
                    </span>
                  )}
                </h2>
                <span className="text-xs text-theme-muted-text-3">
                  {filteredCategories.reduce((a, g) => a + g.items.length, 0)} markers
                </span>
              </div>
              <p className="text-sm text-theme-muted-text-2 mb-4">
                Explore your results by body system when you want more detail.
              </p>

              {insightSummary && (
                <SystemSummaryCards
                  systems={insightSummary.systemSummaries}
                  activeCategory={activeCategory}
                  onCategoryClick={cat => setActiveCategory(prev => prev === cat ? null : cat)}
                />
              )}

              <div className="mt-5 space-y-2">
                {filteredCategories.map(({ category, items }) => {
                  // Counted live, not from the persisted upload-time flag: a flag stored
                  // before V2-03 may have come from a fallback band Amani now withholds.
                  const flaggedCount = items.filter(b => markerBandPlacement(b.name as BiomarkerName, b.value, cyclePhase) === 'outside').length;
                  const isCollapsed = collapsedCategories.has(category);
                  const toggleCollapsed = () => {
                    setCollapsedCategories(prev => {
                      const next = new Set(prev);
                      if (next.has(category)) next.delete(category);
                      else next.add(category);
                      return next;
                    });
                  };
                  return (
                    <div key={category} className="rounded-xl border border-theme-neutral-200 overflow-hidden">
                      <button
                        onClick={toggleCollapsed}
                        aria-expanded={!isCollapsed}
                        className="flex items-center justify-between w-full px-4 py-3 text-left bg-theme-surface hover:bg-theme-neutral-50 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-semibold text-theme-text">
                            {systemDisplayLabel(category)}
                          </span>
                          {flaggedCount > 0 && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CUE_STYLE.attention.bg} ${CUE_STYLE.attention.text}`}>
                              {outsideBandCount(flaggedCount)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-theme-muted-text-3">{items.length}</span>
                          {isCollapsed
                            ? <ChevronRight className="w-4 h-4 text-theme-neutral-400" />
                            : <ChevronDown className="w-4 h-4 text-theme-neutral-400" />
                          }
                        </div>
                      </button>
                      {!isCollapsed && (
                        <div className="px-4 pb-4 pt-1 border-t border-theme-neutral-100 space-y-2">
                          {items.map(b => {
                            const personalization = biomarkerPersonalizationMap.get(b.name);
                            return (
                              <BiomarkerCard
                                key={b.id}
                                name={b.name as BiomarkerName}
                                value={b.value}
                                rawValueText={b.raw_value_text}
                                unit={b.unit}
                                labRefMin={b.reference_min}
                                labRefMax={b.reference_max}
                                cyclePhase={cyclePhase}
                                modelProse={markerProse.get(b.name)}
                                baselineStatus={personalization?.baselineStatus}
                                baselineStaleness={personalization?.baselineStaleness}
                                baselineValue={personalization?.baselineValue}
                                trendDirection={personalization?.trendDirection}
                                trendStrength={personalization?.trendStrength}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── H. Disclaimer ───────────────────────────────────── */}
          {/* The policy's product disclaimer; the model's own disclaimer text never renders (owner R1). */}
          {interpretation && (
            <div className="flex items-start gap-3 px-4 py-4">
              <Info className="w-3.5 h-3.5 text-theme-neutral-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-theme-muted-text-3 leading-relaxed italic"
                data-language-category={PRODUCT_DISCLAIMERS.report.category}
                data-language-source={PRODUCT_DISCLAIMERS.report.authority.kind}
                data-language-cue={PRODUCT_DISCLAIMERS.report.cue}>
                {PRODUCT_DISCLAIMERS.report.text}
              </p>
            </div>
          )}

        </div>
      </div>
      {/* PK-HARM-01 (D20): opened from More; renders nothing while closed. */}
      <ReportProblemFlow
        open={reportProblemOpen}
        onClose={() => setReportProblemOpen(false)}
        reportId={report.id}
        interpretationId={interpretation ? shownExplanation?.id ?? null : null}
      />
    </Layout>
  );
}
