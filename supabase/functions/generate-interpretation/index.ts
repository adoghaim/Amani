import "jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.3";
import {
  ALLOWED_NUTRIENTS_PROMPT_LIST,
  sanitizeViolations,
  validateInterpretationOutput,
} from "../_shared/nutrient-policy.ts";
import { fetchWithBackoff } from "../_shared/fetchWithBackoff.ts";
import { createAppEventSink, logServerEvent } from "../_shared/app-events.ts";
import { errorMessage } from "../_shared/errors.ts";
import { consentRefusal } from "../_shared/consent.ts";
import { consentGateFor } from "../_shared/consent-gate-supabase.ts";
import { buildBasicProjection } from "../_shared/interpretation-visibility.ts";
import { entitlementUnavailable, generationVisibilityMode } from "../_shared/entitlement-response.ts";
import { checkUserSubscription } from "../_shared/subscription-guard.ts";
import {
  commitGeneratedInterpretation,
  decideIntroductoryAccess,
  type ClaimRecord,
  type CommitRequest,
  type DeepAccessDecision,
  type IntroductoryAccessActions,
} from "../_shared/introductory-access.ts";
import { resolveGenerationDrawIdentity } from "../_shared/generation-draw-identity.ts";
import { projectBasic, servedBasic, visibleClaimProjection, withClaimAuthority } from "../_shared/claim-authority.ts";
import { buildTrendEvidence, formatTrendEvidencePrompt, type TrendEvidence } from "../_shared/trend-evidence.ts";
import { generationSample, recordGenerationCosts, type GenerationSample, type GenerationCostContext } from "../_shared/generation-cost.ts";
import { resolveTier, type Tier } from "../_shared/tier.ts";
import {
  findFloorViolations,
  shapeInterpretation,
  shouldRequestDeepInterpretation,
} from "../_shared/response-shaping.ts";
import { decideDeepGeneration } from "../_shared/regeneration-availability.ts";
import {
  isHistoryProtected,
  isVersionable,
  legacyHistoryProtectedResponse,
  ProtectedHistoryError,
  regenerationFailedResponse,
  regenerationProvenance,
  REQUEST_ID_REQUIRED,
  REQUEST_REUSED_SQLSTATE,
  VERSION_DISCLAIMER_VERSION,
  versionIdentity,
  type StoredVersion,
} from "../_shared/interpretation-version-write.ts";
import { enforceRateLimit, isRateLimitExceeded } from "../_shared/rate-limit.ts";
import { createRateLimitStore } from "../_shared/rate-limit-store.ts";
import { redactLabText } from "../_shared/lab-text-redaction.ts";
import { InterpretationSchema } from "../_shared/schemas/interpretation.ts";
import { GenerateInterpretationRequestSchema } from "../_shared/schemas/requests.ts";
import {
  formatUserContextBlock,
  LabReportContextSchema,
  UserProfileContextSchema,
} from "../_shared/schemas/context.ts";
import { callModelUnlessPaused } from "../_shared/ai-pause.ts";
import { aiPausedNow, edgeAiCostLedger, edgeErrorReporter, inBackground } from "../_shared/edge-ai-guards.ts";
import {
  fallbackDiagnostics,
  fallbackReasonOf,
  httpModelFailure,
  refusalDiagnostics,
  regenerationRefusalReason,
  thrownModelFailure,
  type ModelFailure,
} from "../_shared/generation-outcome.ts";
import { labPlacement, labPlacementPhrase, type LabPlacement } from "../_shared/lab-placement.ts";

// PK-FIX-01b: error capture (PHI-scrubbed, never blocking), the cross-function
// AI cost ledger, and the kill switch. Once per isolate.
const reporter = edgeErrorReporter("generate-interpretation");
const costLedger = edgeAiCostLedger("generate-interpretation");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Verbose logs include analyte counts and biomarker names tied to reportId —
// gated behind DEBUG to avoid PII-adjacent leakage in normal operation.
const DEBUG_ENABLED = !!Deno.env.get("DEBUG");
function debugLog(...args: unknown[]) {
  if (DEBUG_ENABLED) console.log(...args);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyteData {
  id: string;
  raw_name: string;
  canonical_slug: string | null;
  value_numeric: number;
  raw_value_text: string | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_min: number | null;
  normalized_max: number | null;
  normalized_operator: string | null;
  normalized_operator_value: number | null;
  is_core: boolean;
}

interface LabReportData {
  id: string;
  report_date: string;
  estimated_cycle_day: number | null;
  estimated_cycle_phase: string | null;
  context: {
    birth_control?: string;
    pregnant?: string;
    postpartum?: string;
    top_symptoms?: string[];
  };
}

type AnalyteStatus = "in_range" | "out_of_range" | "borderline" | "unknown";

interface PrimaryContext {
  primary_biomarker: string;
  canonical_slug: string | null;
  current_value: number;
  previous_value: number | null;
  unit: string | null;
  current_status: "elevated" | "low" | "in_range" | "borderline" | "out_of_range";
  /** Against her lab's printed interval, exactly as printed: the only position narrative text states. */
  lab_placement: LabPlacement | null;
  trajectory: "improving" | "worsening" | "unchanged" | "no_prior_data";
  percent_change: number | null;
  prior_report_date: string | null;
  supporting_biomarker: { name: string; value: string; direction: string; lab_placement: LabPlacement | null } | null;
}

interface PatternCandidate {
  title: string;
  confidence: "low" | "medium" | "high";
  explanation: string;
  related_biomarkers: string[];
}

interface ReportFacts {
  top_out_of_range: AnalyteData[];
  top_borderline: AnalyteData[];
  reassuring_in_range: AnalyteData[];
  matched_patterns: PatternCandidate[];
  missing_followup_labs: string[];
  cycle_notes: string;
  context_notes: string[];
}

type AIInterpretationOutput = Record<string, unknown>;

/**
 * Master switch for Amani Free. Off everywhere until the production fresh-user
 * E2E test is green; while it is off `resolveTier` resolves every caller to
 * Plus and reproduces the pre-freemium 402 exactly, so this function behaves
 * byte for byte as it did before tiering existed.
 */
const freemiumActive = () => Deno.env.get("FREEMIUM_ACTIVE") === "true";

// ─── Classification ───────────────────────────────────────────────────────────

function classifyAnalyte(a: AnalyteData): AnalyteStatus {
  const v = Number(a.value_numeric);
  if (a.normalized_min !== null && a.normalized_max !== null) {
    const min = Number(a.normalized_min);
    const max = Number(a.normalized_max);
    const buf = (max - min) * 0.08;
    if (v < min - buf || v > max + buf) return "out_of_range";
    if (v < min || v > max) return "borderline";
    return "in_range";
  }
  if (a.normalized_operator && a.normalized_operator_value !== null) {
    const val = Number(a.normalized_operator_value);
    const op = a.normalized_operator;
    if (op === "<" || op === "<=" || op === "< OR =") return v <= val ? "in_range" : "out_of_range";
    if (op === ">" || op === ">=" || op === "> OR =") return v >= val ? "in_range" : "out_of_range";
  }
  return "unknown";
}

/*
  How far outside its reference range a value sits, normalised so different
  analytes are comparable: 1.0 means "one full range-width outside the range".

  This exists because the caller used to take the first six out-of-range
  analytes in the order Postgres returned them — `.order("raw_name")`, i.e.
  ALPHABETICAL. With more than six abnormal results the rest were dropped
  before the model ever saw them, so whether a dangerous value reached the
  interpretation depended on its first letter. The same ordering also fed the
  headline, which called `top_out_of_range[0]` "the most notable finding".

  NOTE: this is a magnitude measure, not a clinical severity scale. It does not
  know that potassium is more urgent than cholesterol. A real panic-value tier
  needs clinician-set per-analyte thresholds; this only guarantees that the
  most deviant results are the ones that survive truncation.
*/
function deviationScore(a: AnalyteData): number {
  const v = Number(a.value_numeric);
  if (!Number.isFinite(v)) return 0;

  if (a.normalized_min !== null && a.normalized_max !== null) {
    const min = Number(a.normalized_min);
    const max = Number(a.normalized_max);
    const width = max - min;
    // A zero-width range would divide by zero; fall back to absolute distance.
    if (!Number.isFinite(width) || width <= 0) {
      return Math.max(min - v, v - max, 0);
    }
    if (v < min) return (min - v) / width;
    if (v > max) return (v - max) / width;
    return 0;
  }

  if (a.normalized_operator && a.normalized_operator_value !== null) {
    const val = Number(a.normalized_operator_value);
    if (!Number.isFinite(val) || val === 0) return 0;
    const op = a.normalized_operator;
    if (op === "<" || op === "<=" || op === "< OR =") return v > val ? (v - val) / Math.abs(val) : 0;
    if (op === ">" || op === ">=" || op === "> OR =") return v < val ? (val - v) / Math.abs(val) : 0;
  }

  return 0;
}

function slug(a: AnalyteData): string {
  return a.canonical_slug ?? a.raw_name.toLowerCase().replace(/\s+/g, "_");
}

function displayVal(a: AnalyteData): string {
  return `${a.raw_value_text ?? String(a.value_numeric)}${a.unit ? " " + a.unit : ""}`;
}

/** Use the name printed on the report; do not invent a clinical label. */
function label(a: AnalyteData): string {
  return a.raw_name;
}

/*
  Where the value sits against her lab's printed interval, exactly as printed
  (_shared/lab-placement.ts, the page's own rule). Narrative words use this, so
  the stored text says "below the lab's reference range" where the page says
  "Below your lab's range". classifyAnalyte's 8% margin keeps deciding claim
  statuses, ranking and which markers the prompt lists; it never words a
  position, because a value just past the printed bound is outside it.
*/
function placementOf(a: AnalyteData): LabPlacement | null {
  const num = (v: number | null) => (v === null || v === undefined ? null : Number(v));
  return labPlacement(num(a.value_numeric), num(a.normalized_min), num(a.normalized_max),
    a.normalized_operator, num(a.normalized_operator_value));
}

/** "below the lab's reference range", or null when the report printed no usable interval. */
function placementPhrase(a: AnalyteData): string | null {
  const placement = placementOf(a);
  return placement ? labPlacementPhrase(placement) : null;
}

function getBySlug(analytes: AnalyteData[], s: string): AnalyteData | undefined {
  return analytes.find(a => a.canonical_slug === s);
}

// ─── Pattern Detection ────────────────────────────────────────────────────────

function detectPatterns(analytes: AnalyteData[], report: LabReportData): PatternCandidate[] {
  const patterns: PatternCandidate[] = [];
  const statusMap = new Map<string, AnalyteStatus>();
  for (const a of analytes) {
    if (a.canonical_slug) statusMap.set(a.canonical_slug, classifyAnalyte(a));
  }

  const isAbnormal = (s: string) =>
    statusMap.get(s) === "out_of_range" || statusMap.get(s) === "borderline";
  const isLow = (a: AnalyteData | undefined) => {
    if (!a || a.normalized_min === null) return false;
    return Number(a.value_numeric) < Number(a.normalized_min);
  };
  const isHigh = (a: AnalyteData | undefined) => {
    if (!a) return false;
    if (a.normalized_max !== null) return Number(a.value_numeric) > Number(a.normalized_max);
    if (a.normalized_operator === "<" && a.normalized_operator_value !== null)
      return Number(a.value_numeric) > Number(a.normalized_operator_value);
    return false;
  };

  // ── Thyroid autoimmunity ──────────────────────────────────────────────────
  const tpo = getBySlug(analytes, "tpo_antibodies");
  const tgAb = getBySlug(analytes, "tg_antibodies");
  const tpoHigh = tpo && isHigh(tpo);
  const tgHigh = tgAb && isHigh(tgAb);
  const thyroidFunctionAbnormal = isAbnormal("tsh") || isAbnormal("free_t4") || isAbnormal("free_t3");

  if (tpoHigh || tgHigh) {
    const related = ["tpo_antibodies", "tg_antibodies", "tsh", "free_t4", "free_t3"].filter(s =>
      analytes.some(a => a.canonical_slug === s)
    );
    const confidence: "low" | "medium" | "high" =
      (tpoHigh && tgHigh && thyroidFunctionAbnormal) ? "high" :
      (tpoHigh || tgHigh) && thyroidFunctionAbnormal ? "medium" : "low";
    patterns.push({
      title: "Thyroid Autoimmunity Pattern",
      confidence,
      explanation: `Elevated thyroid antibodies${tpoHigh && tgHigh ? " (both TPO and thyroglobulin)" : tpoHigh ? " (TPO)" : " (thyroglobulin)"}${thyroidFunctionAbnormal ? " alongside thyroid function markers that are outside their reference range" : ""} can be seen in autoimmune thyroid conditions. This combination is worth evaluating in context with your provider, particularly if you're experiencing symptoms like fatigue, hair changes, or temperature sensitivity.`,
      related_biomarkers: related,
    });
  } else if (isAbnormal("tsh") || isAbnormal("free_t4") || isAbnormal("free_t3")) {
    const related = ["tsh", "free_t4", "free_t3"].filter(s => analytes.some(a => a.canonical_slug === s));
    const allThreeAbnormal = isAbnormal("tsh") && (isAbnormal("free_t4") || isAbnormal("free_t3"));
    patterns.push({
      title: "Thyroid Function Variation",
      confidence: allThreeAbnormal ? "medium" : "low",
      explanation: `One or more thyroid function markers are outside their reference range. Thyroid hormones affect energy, metabolism, mood, and menstrual regularity, so this is worth a closer look in conjunction with your symptoms and full thyroid panel.`,
      related_biomarkers: related,
    });
  }

  // ── Insulin resistance / glucose dysregulation ───────────────────────────
  const insulin = getBySlug(analytes, "fasting_insulin");
  const triglycerides = getBySlug(analytes, "triglycerides");
  const hdl = getBySlug(analytes, "hdl_cholesterol");

  const glucoseAbnormal = isAbnormal("fasting_glucose");
  const hba1cAbnormal = isAbnormal("hemoglobin_a1c");
  const insulinHigh = insulin && isHigh(insulin);
  const trigsHigh = triglycerides && isHigh(triglycerides);
  const hdlLow = hdl && isLow(hdl);

  const irSignals = [glucoseAbnormal, hba1cAbnormal, insulinHigh, trigsHigh, hdlLow].filter(Boolean).length;

  if (irSignals >= 2) {
    const related = ["fasting_glucose", "hemoglobin_a1c", "fasting_insulin", "triglycerides", "hdl_cholesterol"].filter(s =>
      analytes.some(a => a.canonical_slug === s)
    );
    patterns.push({
      title: "Glucose Regulation Pattern",
      confidence: irSignals >= 3 ? "medium" : "low",
      explanation: `${irSignals} markers associated with glucose regulation are outside their reference ranges — ${[glucoseAbnormal && "fasting glucose", hba1cAbnormal && "HbA1c", insulinHigh && "fasting insulin", trigsHigh && "triglycerides", hdlLow && "HDL"].filter(Boolean).join(", ")}. Together, these may reflect variation in how the body is currently processing sugar and insulin. This pattern is worth discussing in context with your provider, particularly if you have a history of PCOS or metabolic conditions.`,
      related_biomarkers: related,
    });
  } else if (irSignals === 1 && (glucoseAbnormal || hba1cAbnormal)) {
    const related = ["fasting_glucose", "hemoglobin_a1c"].filter(s => analytes.some(a => a.canonical_slug === s));
    patterns.push({
      title: "Fasting Glucose Elevation",
      confidence: "low",
      explanation: `A single elevated fasting glucose or HbA1c marker can sometimes suggest early variation in glucose regulation, but is not meaningful in isolation. A repeat test and conversation with your provider — in context of your full health history — will clarify whether any follow-up is warranted.`,
      related_biomarkers: related,
    });
  }

  // ── Lipid pattern ─────────────────────────────────────────────────────────
  const ldl = getBySlug(analytes, "ldl_cholesterol");
  const totalChol = getBySlug(analytes, "total_cholesterol");
  const apob = getBySlug(analytes, "apob");

  const ldlHigh = ldl && isHigh(ldl);
  const totalCholHigh = totalChol && isHigh(totalChol);
  const apobHigh = apob && isHigh(apob);
  const lipidSignals = [ldlHigh, totalCholHigh, apobHigh, trigsHigh, hdlLow].filter(Boolean).length;

  if (lipidSignals >= 2) {
    const related = ["ldl_cholesterol", "total_cholesterol", "hdl_cholesterol", "triglycerides", "apob"].filter(s =>
      analytes.some(a => a.canonical_slug === s)
    );
    patterns.push({
      title: "Lipid Pattern Worth Monitoring",
      confidence: lipidSignals >= 3 ? "medium" : "low",
      explanation: `${[ldlHigh && "LDL", totalCholHigh && "total cholesterol", apobHigh && "ApoB", trigsHigh && "triglycerides", hdlLow && "HDL"].filter(Boolean).join(", ")} ${lipidSignals === 1 ? "is" : "are"} outside reference range. Because estrogen modulates lipid metabolism, values can shift across the cycle and with hormonal changes — so context matters. Your provider can help assess whether this pattern warrants closer tracking over time.`,
      related_biomarkers: related,
    });
  }

  // ── Phase-aware reproductive hormone interpretation ───────────────────────
  const phase = report.estimated_cycle_phase;
  const cycleDay = report.estimated_cycle_day;
  const onBC = report.context?.birth_control === "yes";
  const pregnant = report.context?.pregnant === "yes";

  if (!onBC && !pregnant && phase && phase !== "unknown") {
    const estradiol = getBySlug(analytes, "estradiol");
    const progesterone = getBySlug(analytes, "progesterone");
    const lh = getBySlug(analytes, "lh");
    const fsh = getBySlug(analytes, "fsh");
    const amh = getBySlug(analytes, "amh");

    const hormoneAbnormal = [estradiol, progesterone, lh, fsh].filter(a => a && isAbnormal(a.canonical_slug!)).length;

    if (hormoneAbnormal >= 2) {
      const related = ["estradiol", "progesterone", "lh", "fsh", "amh"].filter(s =>
        analytes.some(a => a.canonical_slug === s)
      );
      const phaseLabel = phase === "luteal" ? "luteal" : phase === "follicular" ? "follicular" : phase === "ovulatory" ? "ovulatory" : phase;
      patterns.push({
        title: "Reproductive Hormone Variation",
        confidence: hormoneAbnormal >= 3 ? "medium" : "low",
        explanation: `${hormoneAbnormal} reproductive hormones are outside their reference ranges for the ${phaseLabel} phase (day ${cycleDay ?? "?"}). Hormone levels are highly phase-dependent and a single draw rarely tells the full story — this may simply reflect normal individual variation, but it can be worth repeating at a different phase or tracking across cycles to see if a pattern holds.`,
        related_biomarkers: related,
      });
    }

    if (amh && isLow(amh)) {
      patterns.push({
        title: "Low Ovarian Reserve Signal",
        confidence: "low",
        explanation: `AMH (anti-Müllerian hormone) is below the lower reference limit. AMH values vary between labs and across the cycle, and a single reading below range doesn't tell a complete story on its own. If fertility or ovarian function is relevant to you, this is worth reviewing with your provider alongside FSH and a full cycle context.`,
        related_biomarkers: ["amh", "fsh"],
      });
    }
  }

  // ── Iron / nutrient depletion ─────────────────────────────────────────────
  const ferritin = getBySlug(analytes, "ferritin");
  const vitD = getBySlug(analytes, "vitamin_d_25_oh");
  const b12 = getBySlug(analytes, "vitamin_b12");
  const hgb = getBySlug(analytes, "hemoglobin");

  const ferritinLow = ferritin && isLow(ferritin);
  const vitDLow = vitD && isLow(vitD);
  const b12Low = b12 && isLow(b12);
  const hgbLow = hgb && isLow(hgb);
  const nutrientSignals = [ferritinLow, vitDLow, b12Low, hgbLow].filter(Boolean).length;

  if (nutrientSignals >= 2) {
    const related = ["ferritin", "vitamin_d_25_oh", "vitamin_b12", "hemoglobin", "serum_iron"].filter(s =>
      analytes.some(a => a.canonical_slug === s)
    );
    patterns.push({
      title: "Nutrient Depletion Pattern",
      confidence: nutrientSignals >= 3 ? "medium" : "low",
      explanation: `${[ferritinLow && "Ferritin", vitDLow && "vitamin D", b12Low && "B12", hgbLow && "hemoglobin"].filter(Boolean).join(", ")} ${nutrientSignals === 1 ? "is" : "are"} below their reference ranges. Nutrient markers often cluster, and low levels across several can sometimes be associated with fatigue, mood changes, or hormonal variability. How and whether to address these depends on severity and your full clinical picture — your provider can help prioritize.`,
      related_biomarkers: related,
    });
  } else if (ferritinLow && hgbLow) {
    patterns.push({
      title: "Iron-Deficiency Signal",
      confidence: "medium",
      explanation: `Both ferritin and hemoglobin are below their reference ranges, which can sometimes be seen alongside iron insufficiency — a pattern that's relatively common in women, particularly those with heavier cycles. A full iron panel and clinical context would help clarify the picture before any next steps.`,
      related_biomarkers: ["ferritin", "hemoglobin", "serum_iron", "tibc"],
    });
  }

  return patterns.slice(0, 3);
}

// ─── Missing Follow-up Labs ───────────────────────────────────────────────────

function computeMissingFollowupLabs(analytes: AnalyteData[]): string[] {
  const present = new Set(analytes.map(a => a.canonical_slug).filter(Boolean));
  const missing: string[] = [];

  const has = (...slugs: string[]) => slugs.some(s => present.has(s));

  if (has("tsh") && !has("free_t4", "free_t3")) {
    missing.push("Free T4 and Free T3 (TSH alone is incomplete for thyroid function assessment)");
  }
  if (has("tpo_antibodies", "tg_antibodies") && !has("tsh")) {
    missing.push("TSH (to pair with the antibody markers already present)");
  }
  if (has("fasting_glucose", "hemoglobin_a1c") && !has("fasting_insulin")) {
    missing.push("Fasting insulin (would complete a glucose dysregulation assessment)");
  }
  if (has("ldl_cholesterol", "total_cholesterol") && !has("apob")) {
    missing.push("ApoB (a more precise cardiovascular risk marker than LDL alone)");
  }
  if (has("estradiol", "progesterone") && !has("lh", "fsh")) {
    missing.push("LH and FSH (would provide a more complete reproductive hormone picture)");
  }
  if (has("ferritin") && !has("serum_iron", "tibc")) {
    missing.push("Serum iron and TIBC (to characterize iron status more fully)");
  }
  if (!has("vitamin_d_25_oh") && !has("vitamin_b12")) {
    missing.push("Vitamin D and B12 (commonly deficient and clinically impactful for women)");
  }
  if (has("hemoglobin") && !has("ferritin")) {
    missing.push("Ferritin (often low before hemoglobin drops — the earliest iron marker)");
  }
  if (!has("hs_crp") && !has("esr")) {
    missing.push("hs-CRP (a sensitive inflammatory marker absent from this panel)");
  }

  return missing.slice(0, 5);
}

// ─── Pre-LLM Report Facts ─────────────────────────────────────────────────────

const HIGH_VALUE_SLUGS = new Set([
  "estradiol", "progesterone", "lh", "fsh", "tsh", "free_t4", "free_t3",
  "fasting_glucose", "hemoglobin_a1c", "total_cholesterol", "ldl_cholesterol",
  "hdl_cholesterol", "triglycerides", "creatinine", "egfr", "alt", "ast",
  "ferritin", "vitamin_d_25_oh", "vitamin_b12", "hs_crp", "tpo_antibodies",
  "hemoglobin", "shbg", "total_testosterone", "dheas", "fasting_insulin",
  "amh", "prolactin", "apob", "tg_antibodies", "serum_iron",
]);

function directionLabel(a: AnalyteData, status: AnalyteStatus): "elevated" | "low" | "in_range" | "borderline" | "out_of_range" {
  if (status === "in_range") return "in_range";
  const v = Number(a.value_numeric);
  if (a.normalized_min !== null && a.normalized_max !== null) {
    if (v > Number(a.normalized_max)) return status === "borderline" ? "borderline" : "elevated";
    if (v < Number(a.normalized_min)) return status === "borderline" ? "borderline" : "low";
  }
  if (a.normalized_operator && a.normalized_operator_value !== null) {
    const op = a.normalized_operator;
    const thr = Number(a.normalized_operator_value);
    if ((op === "<" || op === "<=" || op === "< OR =") && v > thr) return "elevated";
    if ((op === ">" || op === ">=" || op === "> OR =") && v < thr) return "low";
  }
  return "out_of_range";
}

function concernScore(a: AnalyteData): number {
  const status = classifyAnalyte(a);
  if (status === "out_of_range") return 2;
  if (status === "borderline") return 1;
  return 0;
}

function deviationMultiplier(a: AnalyteData): number {
  const v = Number(a.value_numeric);
  if (a.normalized_min !== null && a.normalized_max !== null) {
    const min = Number(a.normalized_min);
    const max = Number(a.normalized_max);
    const mid = (min + max) / 2;
    const half = Math.max((max - min) / 2, 0.0001);
    return Math.abs(v - mid) / half;
  }
  if (a.normalized_operator && a.normalized_operator_value !== null) {
    const thr = Number(a.normalized_operator_value);
    if (thr === 0) return Math.abs(v);
    return Math.abs(v - thr) / Math.abs(thr);
  }
  return 0;
}

function computeTrajectory(
  current: number,
  previous: number,
  status: AnalyteStatus,
  direction: "elevated" | "low" | "in_range" | "borderline" | "out_of_range",
): { trajectory: "improving" | "worsening" | "unchanged"; percent: number | null } {
  const pct = Math.abs(previous) > 0.0001 ? ((current - previous) / Math.abs(previous)) * 100 : null;
  const absPct = pct !== null ? Math.abs(pct) : Math.abs(current - previous);
  if (absPct < 5) return { trajectory: "unchanged", percent: pct !== null ? Math.round(pct * 10) / 10 : null };

  if (status === "in_range") {
    return { trajectory: "unchanged", percent: pct !== null ? Math.round(pct * 10) / 10 : null };
  }

  let movedTowardRange = false;
  if (direction === "elevated" && current < previous) movedTowardRange = true;
  else if (direction === "low" && current > previous) movedTowardRange = true;

  return {
    trajectory: movedTowardRange ? "improving" : "worsening",
    percent: pct !== null ? Math.round(pct * 10) / 10 : null,
  };
}

function buildPrimaryContext(
  analytes: AnalyteData[],
  priorAnalytes: AnalyteData[],
  priorReportDate: string | null,
  pinnedSlug?: string | null,
): PrimaryContext | null {
  const abnormal = analytes
    .filter(a => concernScore(a) > 0)
    .map(a => ({ a, score: concernScore(a) * 10 + deviationMultiplier(a) }))
    .sort((x, y) => y.score - x.score);

  // Pin override: when the frontend supplies a canonical primary slug, use it
  // even when no marker is abnormal per backend's lab-ref classifier. The
  // frontend can also select a marker against Amani comparison bands
  // that this function's classifyAnalyte doesn't see.
  let primary: AnalyteData | null = null;
  if (pinnedSlug) {
    primary = analytes.find(a => a.canonical_slug === pinnedSlug) ?? null;
  }
  if (!primary) {
    if (abnormal.length === 0) return null;
    primary = abnormal[0].a;
  }
  const status = classifyAnalyte(primary);
  const direction = directionLabel(primary, status);

  const prior = primary.canonical_slug
    ? priorAnalytes.find(p => p.canonical_slug === primary.canonical_slug)
    : priorAnalytes.find(p => p.raw_name.toLowerCase() === primary.raw_name.toLowerCase());

  let trajectory: "improving" | "worsening" | "unchanged" | "no_prior_data" = "no_prior_data";
  let percent: number | null = null;
  let previousValue: number | null = null;

  if (prior && prior.value_numeric !== null && prior.value_numeric !== undefined) {
    previousValue = Number(prior.value_numeric);
    const t = computeTrajectory(Number(primary.value_numeric), previousValue, status, direction);
    trajectory = t.trajectory;
    percent = t.percent;
  }

  const supporting = abnormal.find(entry => entry.a !== primary)?.a ?? null;
  const supportingBlock = supporting
    ? {
        name: label(supporting),
        value: displayVal(supporting),
        direction: directionLabel(supporting, classifyAnalyte(supporting)),
        lab_placement: placementOf(supporting),
      }
    : null;

  return {
    primary_biomarker: label(primary),
    canonical_slug: primary.canonical_slug,
    current_value: Number(primary.value_numeric),
    previous_value: previousValue,
    unit: primary.unit,
    current_status: direction,
    lab_placement: placementOf(primary),
    trajectory,
    percent_change: percent,
    prior_report_date: priorReportDate,
    supporting_biomarker: supportingBlock,
  };
}

/*
  The deterministic sentence for the primary marker. Her lab's printed interval
  words its position, with no margin ("sits near the edge of the reference
  range" was the 8% margin talking, for a value outside the printed range), and
  a change is stated by its numbers, never judged ("has improved" claimed a
  direction no reviewed rule supports; owner R1). "Remains" needs a prior value.
*/
function formatPrimarySummary(ctx: PrimaryContext): string {
  const unit = ctx.unit ? ` ${ctx.unit}` : "";
  const where = ctx.lab_placement ? `is ${labPlacementPhrase(ctx.lab_placement)}` : "was measured";
  const current = `${ctx.current_value}${unit}`;

  let sentence1: string;
  if (ctx.previous_value !== null) {
    const verb = ctx.current_value > ctx.previous_value ? "increased" : ctx.current_value < ctx.previous_value ? "decreased" : null;
    sentence1 = verb
      ? `${ctx.primary_biomarker} ${where} at ${current} and has ${verb} from ${ctx.previous_value}${unit} since your last report.`
      : `${ctx.primary_biomarker} ${where} at ${current}, the same as your previous result.`;
  } else {
    sentence1 = `${ctx.primary_biomarker} ${where} at ${current}.`;
  }

  const s = ctx.supporting_biomarker;
  if (s?.lab_placement && s.lab_placement !== "within") {
    return `${sentence1} ${s.name} is also ${labPlacementPhrase(s.lab_placement)} at ${s.value}.`;
  }
  return sentence1;
}

function computeReportFacts(analytes: AnalyteData[], report: LabReportData): ReportFacts {
  const outOfRange = analytes.filter(a => classifyAnalyte(a) === "out_of_range");
  const borderline = analytes.filter(a => classifyAnalyte(a) === "borderline");
  const inRange = analytes.filter(a => classifyAnalyte(a) === "in_range");

  const reassuring = inRange.filter(a =>
    a.canonical_slug && HIGH_VALUE_SLUGS.has(a.canonical_slug)
  ).slice(0, 6);

  const phase = report.estimated_cycle_phase;
  const day = report.estimated_cycle_day;
  const onBC = report.context?.birth_control === "yes";
  const pregnant = report.context?.pregnant === "yes";
  const postpartum = report.context?.postpartum === "yes";

  let cycleNotes = "";
  if (pregnant) {
    cycleNotes = "Patient is currently pregnant. Hormone and metabolic reference ranges differ significantly in pregnancy.";
  } else if (postpartum) {
    cycleNotes = "Patient is postpartum. Hormone levels may be suppressed or fluctuating as the body recovers.";
  } else if (onBC) {
    cycleNotes = "Patient is on hormonal birth control. Endogenous hormone levels — especially estradiol, progesterone, LH, and FSH — will be suppressed. SHBG is often elevated. Interpret hormone markers accordingly.";
  } else if (phase && phase !== "unknown" && day) {
    const phaseExpectations: Record<string, string> = {
      menstrual: "Estradiol and progesterone are typically low. FSH begins rising. Spotting iron-related markers (ferritin, hemoglobin) here is valuable.",
      follicular: "Estradiol is rising. Progesterone is low. FSH is moderately elevated. LH is baseline.",
      ovulatory: "LH surge expected. Estradiol peaks just before ovulation. Progesterone beginning to rise.",
      luteal: "Progesterone should be elevated (ideally above 5–10 ng/mL at mid-luteal). Estradiol has a secondary, smaller rise. LH and FSH are low.",
    };
    cycleNotes = `Labs drawn on day ${day} (${phase} phase). ${phaseExpectations[phase] ?? "Phase-specific hormone expectations apply."}`;
  } else {
    cycleNotes = "Cycle day is not known. Hormone values cannot be interpreted in phase context without this information.";
  }

  const contextNotes: string[] = [];
  const symptoms = report.context?.top_symptoms ?? [];
  if (symptoms.length > 0) {
    contextNotes.push(`Reported symptoms: ${symptoms.slice(0, 4).join(", ")}.`);
  }
  if (postpartum) contextNotes.push("Postpartum status noted.");
  if (pregnant) contextNotes.push("Currently pregnant.");
  if (onBC) contextNotes.push("On hormonal birth control.");

  /*
    Sort by deviation before truncating. `report_analytes` arrives ordered by
    `raw_name`, so without this the six survivors — and `top_out_of_range[0]`,
    which the headline names as "the most notable finding" — were chosen
    alphabetically.
  */
  const bySeverity = (x: AnalyteData, y: AnalyteData) => deviationScore(y) - deviationScore(x);

  return {
    top_out_of_range: [...outOfRange].sort(bySeverity).slice(0, 6),
    top_borderline: [...borderline].sort(bySeverity).slice(0, 5),
    reassuring_in_range: reassuring,
    matched_patterns: detectPatterns(analytes, report),
    missing_followup_labs: computeMissingFollowupLabs(analytes),
    cycle_notes: cycleNotes,
    context_notes: contextNotes,
  };
}

// ─── Fallback Interpretation ──────────────────────────────────────────────────

/** Cycle phase/day are app-calculated report facts, never model output. */
function deterministicCycleFacts(report: LabReportData) {
  const day = report.estimated_cycle_day ?? null;
  return {
    estimated_cycle_day: day,
    estimated_cycle_phase: report.estimated_cycle_phase ?? "unknown",
    confidence: day ? "medium" as const : "low" as const,
  };
}

/** The model owns only the prose around the deterministic cycle facts. */
function modelCycleExplanation(value: unknown): string {
  if (typeof value === "string") return value;
  const explanation = value && typeof value === "object" ? (value as Record<string, unknown>).explanation : undefined;
  return typeof explanation === "string" ? explanation : "";
}

function generateFallbackInterpretation(
  report: LabReportData,
  analytes: AnalyteData[],
  primaryContext: PrimaryContext | null,
) {
  const facts = computeReportFacts(analytes, report);
  const { top_out_of_range, top_borderline, matched_patterns } = facts;
  const phase = report.estimated_cycle_phase ?? "unknown";
  const day = report.estimated_cycle_day;

  /*
    Positions are her lab's printed interval, exactly as printed (placementOf):
    a value 8% past a bound is outside it, never "borderline" or "near the
    edge", and the count says how many values sit outside, not which ones a
    margin promoted. classifyAnalyte only chooses and orders the markers named.
    The marker named first is the report's primary finding (the client pins it
    as primary_canonical_slug) when it is outside the lab's range.
  */
  const below = analytes.filter(a => placementOf(a) === "below").length;
  const above = analytes.filter(a => placementOf(a) === "above").length;
  const outside = below + above;
  const flagged = [...top_out_of_range, ...top_borderline];
  const lead = primaryContext?.lab_placement && primaryContext.lab_placement !== "within"
    ? primaryContext.primary_biomarker
    : flagged[0] ? label(flagged[0]) : null;

  // An empty panel is not "within reference ranges": nothing was read to compare.
  let headline: string;
  if (analytes.length === 0) {
    headline = "No lab values could be read from this report.";
  } else if (outside === 0) {
    headline = "No value on this panel is outside the lab's printed reference ranges.";
  } else {
    headline = `${outside} value${outside > 1 ? "s" : ""} outside the lab's printed reference range${lead ? `, including ${lead}` : ""}.`;
  }

  const summaryBullets: string[] = [];

  if (analytes.length === 0) {
    summaryBullets.push("No lab values were read from this report, so there is nothing to compare with a reference range yet.");
  } else if (outside === 0) {
    summaryBullets.push(`Of ${analytes.length} analytes reviewed, none is outside the lab's printed reference range.`);
  } else {
    const parts: string[] = [];
    if (below > 0) parts.push(`${below} below`);
    if (above > 0) parts.push(`${above} above`);
    summaryBullets.push(`Of ${analytes.length} analytes reviewed, ${parts.join(" and ")} the lab's printed reference range.`);
  }

  if (day && phase !== "unknown") {
    summaryBullets.push(
      `These labs were drawn on cycle day ${day} (${phase} phase). Reproductive hormones — especially estradiol, progesterone, LH, and FSH — are highly phase-dependent, so timing context matters when interpreting them.`
    );
  } else {
    summaryBullets.push(
      `Cycle timing isn't available for this report. Adding your last period date would allow hormone markers like estradiol, progesterone, and LH to be interpreted in their proper cycle context.`
    );
  }

  if (facts.context_notes.length > 0) {
    summaryBullets.push(facts.context_notes.join(" "));
  } else if (facts.matched_patterns.length > 0) {
    summaryBullets.push(
      `Pattern analysis identified ${facts.matched_patterns.length} potential signal${facts.matched_patterns.length > 1 ? "s" : ""} — including ${facts.matched_patterns[0].title.toLowerCase()}. These are observations, not diagnoses.`
    );
  }

  const topFlagged = flagged.slice(0, 5);
  const top_findings = topFlagged.map(a => {
    const status = classifyAnalyte(a);
    const where = placementPhrase(a);
    return {
      biomarker_slug: slug(a),
      title: label(a),
      status: status === "out_of_range" ? "discuss" as const : "monitor" as const,
      explanation: `Your ${label(a)} result was ${displayVal(a)}${where ? `, ${where}` : ""}. What it means depends on your full history, symptoms, and cycle context.`,
    };
  });

  const questions: string[] = [];

  const first = flagged[0];
  if (first) {
    const where = placementPhrase(first);
    questions.push(`My ${label(first)} came back ${displayVal(first)}${where ? `, ${where}` : ""}. Can you help me understand what that means in the context of my full history?`);
  } else {
    questions.push("Are there any values on this panel that you'd want to track over time, even if they're currently in range?");
  }

  if (matched_patterns.length > 0) {
    questions.push(`The pattern analysis flagged a possible ${matched_patterns[0].title.toLowerCase()} — is there anything you'd want to evaluate or rule out based on these results?`);
  } else if (facts.missing_followup_labs.length > 0) {
    questions.push(`Would adding ${facts.missing_followup_labs[0].split(" (")[0]} to my next draw give us more useful information?`);
  } else {
    questions.push("Are there any markers not on this panel that you'd recommend adding to get a more complete picture?");
  }

  if (day && phase !== "unknown") {
    questions.push(`These labs were drawn on day ${day} of my cycle. Would retesting any of these at a different phase change how we interpret them?`);
  } else {
    questions.push("Which markers on this panel are most sensitive to cycle timing, and when would be the best phase to retest them?");
  }

  const cycleExplanation = day && phase !== "unknown"
    ? `Labs drawn on cycle day ${day} during the ${phase} phase. Hormone values on this panel should be read with that timing in mind.`
    : "Cycle timing was not available for this report. Providing your last period date with future reports will enable more precise hormone interpretation.";

  const overallInterpretation = primaryContext ? formatPrimarySummary(primaryContext) : headline;

  return {
    headline,
    summary_bullets: summaryBullets.slice(0, 3),
    top_findings,
    pattern_signals: matched_patterns,
    overall_interpretation: overallInterpretation,
    cycle_context: { ...deterministicCycleFacts(report), explanation: cycleExplanation },
    questions_for_doctor: questions.slice(0, 3),
    disclaimer:
      "This report is for educational purposes only and does not constitute medical advice. All results should be reviewed with your healthcare provider in the context of your full health history, symptoms, and clinical presentation.",
  };
}

// ─── OpenAI Call ──────────────────────────────────────────────────────────────

async function tryOpenAI(
  apiKey: string,
  report: LabReportData,
  analytes: AnalyteData[],
  primaryContext: PrimaryContext | null,
  userContextBlock: string | null,
  isOptimizationOnly: boolean,
  recordCost?: (sample: GenerationSample) => void,
  trendEvidence: readonly TrendEvidence[] = [],
  /** Told how the model failed, when it did (generation-outcome.ts `model_failure`). */
  onModelFailure?: (failure: ModelFailure) => void,
): Promise<AIInterpretationOutput | null> {
  const facts = computeReportFacts(analytes, report);
  const { top_out_of_range, top_borderline, reassuring_in_range, matched_patterns, missing_followup_labs, cycle_notes, context_notes } = facts;

  const patternSlugs = new Set(matched_patterns.flatMap(p => p.related_biomarkers));

  const patternSupportingInRange = analytes.filter(a =>
    a.canonical_slug &&
    patternSlugs.has(a.canonical_slug) &&
    classifyAnalyte(a) === "in_range"
  );

  const remainingHighValue = analytes.filter(a =>
    a.canonical_slug &&
    HIGH_VALUE_SLUGS.has(a.canonical_slug) &&
    classifyAnalyte(a) === "in_range" &&
    !patternSlugs.has(a.canonical_slug)
  );

  const selected = [
    ...top_out_of_range,
    ...top_borderline,
    ...patternSupportingInRange,
    ...reassuring_in_range,
    ...remainingHighValue,
  ].filter((a, i, arr) => arr.indexOf(a) === i).slice(0, 16);

  // Each marker's position against her lab's printed range, exactly as printed:
  // the same words the report page uses, never a margin's "borderline".
  const labLines = selected.map(a => {
    const val = displayVal(a);
    const s = a.canonical_slug ? ` [${a.canonical_slug}]` : "";
    let line = `${label(a)}${s}: ${val}`;
    if (a.raw_reference_range) line += ` (ref: ${a.raw_reference_range})`;
    const placement = placementOf(a);
    if (placement === "below") line += " ← BELOW LAB RANGE";
    else if (placement === "above") line += " ← ABOVE LAB RANGE";
    else if (placement === "within") line += " (within lab range)";
    return line;
  }).join("\n");
  const outsideLines = (placement: LabPlacement) => {
    const names = selected.filter(a => placementOf(a) === placement).map(a => `${label(a)} (${displayVal(a)})`);
    return names.length > 0 ? names.join(", ") : "none";
  };
  const withinNotable = reassuring_in_range.filter(a => placementOf(a) === "within");

  const patternBlock = matched_patterns.length > 0
    ? `\nDETERMINISTIC PATTERN CANDIDATES (pre-analyzed — use as starting evidence, not final conclusions):\n` +
      matched_patterns.map(p =>
        `- ${p.title} [confidence: ${p.confidence}]: ${p.explanation} (markers: ${p.related_biomarkers.join(", ")})`
      ).join("\n")
    : "";

  const missingBlock = missing_followup_labs.length > 0
    ? `\nABSENT FOLLOW-UP LABS WORTH NOTING:\n${missing_followup_labs.map(m => `- ${m}`).join("\n")}`
    : "";

  const prompt = `You are Amani, a warm and knowledgeable women's health lab interpreter.

You help users understand their lab results in plain, human language — not clinical reports.
You are NOT diagnosing. You are translating numbers into meaning.

-----------------------------------

CORE TONE RULES (non-negotiable)

- Write like a knowledgeable friend, not a doctor writing a chart note
- NEVER use em dashes (—). Use short, clear sentences instead.
- NEVER use these phrases:
  - "clinical significance depends"
  - "may indicate"
  - "further evaluation may be necessary"
  - "suggests possible"
  - "warrants monitoring"
  - "suggests that"
  - "indicates that"
  - "it is important to note"
  - "you may want to consider"
  - "it appears that"
- Instead, use direct statements:
  - "Vitamin D is below the lab's reference range at 21 ng/mL" not "Vitamin D may indicate a deficiency"
  - "TSH has decreased from 5.2 to 3.9 mIU/L" not "TSH suggests improvement"
  - "Ferritin is below the lab's reference range at 9 ng/mL" not "Ferritin indicates possible low iron"
- Be specific to the actual values, not just the flags
- Do NOT repeat the same point across sections
- Keep every explanation to 1–2 sentences max

LAB RANGE vs AMANI BANDS (non-negotiable)

- A marker's position is always stated against the lab's printed reference range shown in LAB PANEL (ref: ...): below it, within it, or above it. LAB PANEL marks each one.
- A value inside its printed reference range is within the lab's range. Never call it low, high, elevated, deficient, abnormal or out of range, whatever its value.
- A value outside its printed reference range is below or above it, however close. Never call it borderline, near the edge, or almost in range.
- The app shows Amani's own comparison bands separately, and they are still under review. Never mention Amani bands, optimal ranges or optimal targets, and never describe a marker against them.
- State a change between reports by its numbers ("has increased from 18 to 25 ng/mL"). Never call a change an improvement, better, worse, or a move in the right or wrong direction.

-----------------------------------

SECTION 1 — HEADLINE

This is the first thing the user sees. It sets the tone for the whole report.

Rules:
- Name the ACTUAL systems or markers that stand out — never count them
- Be specific, warm, and direct
- One sentence only
- When PRIMARY CONTEXT names a primary_biomarker, name it first. It is the primary finding the app shows above your text, so a headline that leads with another marker contradicts the page.
- Positions are against the lab's printed reference range only (see LAB RANGE vs AMANI BANDS). NEVER write "all within range" or "all values look good" when any marker is below or above its printed range.${isOptimizationOnly ? `
- PRIMARY WITHIN THE LAB'S RANGE: the primary marker (${primaryContext?.primary_biomarker}) is within the lab's printed reference range. The app shows it as the primary finding because Amani's comparison band, which is still under review, places it differently. Say it is within the lab's reference range. Do NOT call it low, high, elevated or a problem, and do NOT describe what changing it would do.` : ""}

GOOD:
- "Your TSH is above the lab's reference range, and your free T4 is within it."
- "Your hemoglobin is below the lab's reference range, while ferritin is within it."
- "Your HbA1c is above the lab's reference range, and the rest of your metabolic markers are within theirs."

BAD (never write these):
- "3 values outside range"
- "Your results show some abnormalities"
- "Several biomarkers require attention"
- "All your lab results are within range" (when a marker is below or above its printed range)
- "Your ferritin is low" (when ferritin is within its printed reference range)
- "Your iron markers are the main story" (when PRIMARY CONTEXT names a different marker)

-----------------------------------

SECTION 2 — PRIMARY CONCERN

This is the single most important finding. Lead with it.

Rules for primary_concern.summary:
- State clearly what the marker is and where it landed
- Explain in plain English what that means for how someone feels or functions
- 1–2 sentences, no jargon

Rules for primary_concern.why_it_matters:
- Explain the real-world consequence: energy, hormones, metabolism, mood — whatever applies
- Do NOT say "clinical significance depends" — say what it actually tends to affect

${isOptimizationOnly ? `PRIMARY WITHIN THE LAB'S RANGE (active for this report):
- The primary marker is within the lab's printed reference range. Do NOT use words like "deficient", "abnormal", "concerning", "elevated", or "low" about it.
- primary_concern.summary says the value and that it is within the lab's reference range. Do NOT mention optimal ranges, optimal targets or Amani bands.
- primary_concern.why_it_matters says what the marker measures, in general terms. Do NOT describe the benefits of moving it, or the dangers of leaving it where it is.

Example (primary within the lab's range):
summary: "Your vitamin D came back at 42 ng/mL, within the lab's reference range."
why_it_matters: "Vitamin D is measured in the blood as 25-OH vitamin D, which is how labs estimate your vitamin D status."

` : ""}Example (printed lab-range finding):
summary: "Your TSH came back above the lab's reference range."
why_it_matters: "Read this measurement alongside the other thyroid results on your report."

-----------------------------------

SECTION 3 — KEY FINDINGS ("Focus Now")

Each item explains one finding clearly and specifically.

Rules:
- State the actual value and what direction it's heading
- Explain what it means for how the person feels or functions
- DO NOT repeat anything already covered in primary_concern
- DO NOT use clinical filler phrases

GOOD:
"Your ferritin came back at 9 ng/mL, below the lab's reference range of 16–154 ng/mL. Ferritin is the marker labs use to estimate stored iron."

BAD:
"Ferritin is low. Clinical significance depends on symptoms. Further evaluation may be necessary."
"Your ferritin is low at 18 ng/mL." (when 18 is inside the lab's printed range, it is within the lab's range)

-----------------------------------

SECTION 4 — WHAT YOU CAN DO NOW (most important section)

This is actionable, empowering, and practical. Users read this closely.

IMPORTANT — scope split with Support Plan:
The "Support Plan" section of the report owns ALL food and nutrient discussion topics. This section ("what_you_can_do_now") must NOT include foods, named food groups, or nutrient/supplement names. Focus this section on lifestyle behaviors only (sleep, stress, movement, sun exposure, hydration timing, symptom awareness).

Rules:
- Provide 3–5 suggestions, each tied to a specific flagged marker
- Cover lifestyle behaviors: sleep, stress, movement, sun exposure, hydration patterns, symptom awareness
- Do NOT name foods (no "olive oil", "avocados", "lentils", "leafy greens", etc.) — those live in Support Plan
- Do NOT name nutrients/supplements (no ${ALLOWED_NUTRIENTS_PROMPT_LIST}) — those live in Support Plan
- Do NOT use the words "supplement" or "supplements" anywhere in what_you_can_do_now, even as a generic term. Supplement discussion lives only in Support Plan. If you would have said "lifestyle changes or supplements", say "lifestyle changes" instead.
- Never give dosages, frequencies, brands, or units (no IU, mg, mcg, g, mL, "daily", "twice a day", "with food")
- Never use prescriptive verbs like "take", "start", "consume", "prescribe"
- Frame as discussion topics with a clinician, not directives
- Never mention herbal/adaptogen supplements (ashwagandha, maca, vitex, DIM, evening primrose, black cohosh, etc.)
- Write like a knowledgeable friend giving a real tip, not a disclaimer
- No "For your X:" prefixes. Do not begin bullets with phrases like "For your thyroid:" or "For your HDL cholesterol:". Lead directly with the verb.
- One verb per bullet. Do not combine multiple intents in a single bullet. Bad: "Monitor your HDL cholesterol and discuss lifestyle changes" — split into two bullets if both intents matter, otherwise pick the dominant intent.

DO NOT:
- Give dosages
- Prescribe or suggest medications
- Repeat anything from what_to_do_next
- Use generic advice not tied to what was found
- Include foods or nutrient names (Support Plan owns those)

Tone: practical, warm, specific

GOOD examples (lifestyle-only, no foods/nutrients):
- "Aim for 15–20 minutes of midday sun a few times a week, especially if you're indoors most of the day."
- "Track how your energy and sleep align with these results over the next few weeks."
- "Build in short stress-down breaks during the day — even 5 minutes can help cycle-related symptoms."
- "Notice how hydration patterns line up with how you feel between meals."

BAD examples (these now belong in Support Plan, not here):
- "Focus on heart-supportive fats such as olive oil, avocado, nuts, and fatty fish." (names foods)
- "Pair iron-rich foods like lentils or dark leafy greens with a vitamin C source." (names foods + nutrients)
- "Magnesium-rich foods like pumpkin seeds and dark chocolate can support sleep." (names foods + nutrient)
- "Consider discussing selenium or zinc with your provider." (nutrient names belong in Support Plan, not in what_you_can_do_now)
- "Discussing any lifestyle changes or supplements with your healthcare provider..." (the word "supplements" must not appear here — supplement discussion is Support Plan's scope)

-----------------------------------

SECTION 5 — WHAT TO DO NEXT

3–5 next steps focused only on:
- Follow-up labs to consider
- Conversations to have with a provider
- When to retest

Keep this completely distinct from "What You Can Do Now" — no overlap.

IMPORTANT — scope split with Support Plan:
This section is for Track / Discuss / Retest actions only. Do NOT include foods, named food groups, or nutrient/supplement names. Food and nutrient discussion topics live in the Support Plan section of the report.

- Specific markers, not categories. Name the specific follow-up markers when known. For example, write 'TPO antibodies, TSH, Free T4, and Free T3' rather than 'thyroid markers' or 'thyroid function tests'. If multiple markers are flagged in the same physiological system, list each by name (up to 5 max). Use the lab panel data above as the source of marker names.
- When PRIMARY CONTEXT is set, what_to_do_next MUST include at least one step that explicitly names the primary biomarker (use the exact display name from PRIMARY CONTEXT.primary_biomarker). Frame it as a Discuss or Retest item — e.g. "Discuss whether retesting {primary} in a few months makes sense" or "Review {primary} trend with your provider." Do NOT prescribe dosages, supplements, or treatments. If the primary marker is in optimization-only mode (within the lab's reference range but outside Amani's optimal range), keep the wording educational and non-alarming.
- Direct phrasing, not hedge phrases. Use direct phrasing. Prefer 'Discuss whether repeating X makes sense' over 'X can be helpful'. Prefer 'Review X with your provider if Y' over 'X might be worth discussing'. Banned phrases: 'can be helpful', 'might be worth', 'may be worth', 'could be worth'. Replace with: 'Discuss…', 'Review…', 'Consider repeating…'.
- When thyroid autoantibodies (TPO or TG) are flagged AND thyroid function markers are present in the panel, include a Discuss bullet asking whether repeat-testing thyroid function markers makes sense given the user's symptoms and timeline.
- No "For your X:" prefixes. Lead with the action verb. Write "Discuss whether repeating thyroid markers makes sense" not "For your thyroid: Discuss whether repeating thyroid markers makes sense". The bucketing UI already groups by system, so the prefix is redundant.
- One verb per bullet. Do not combine multiple intents in a single bullet. Bad: "Monitor your HDL cholesterol and discuss lifestyle changes" — split into two bullets if both intents matter, otherwise pick the dominant intent. Good: "Monitor your HDL cholesterol over the next 3-6 months." OR "Discuss lifestyle changes with your provider.", not both.
- Do NOT use the words "supplement" or "supplements" anywhere in what_to_do_next bullets. If a Discuss bullet would have referenced supplements, rephrase to "lifestyle changes" or "any changes to your routine" without naming supplements.

BAD examples:
- "Discuss whether you should start any supplements with your provider." (use "Discuss any lifestyle considerations with your provider" instead)

Examples of good next steps:
- "Discuss whether repeating TPO antibodies, TSH, Free T4, and Free T3 makes sense based on your symptoms and timeline."
- "Ask whether repeating thyroid function markers with TPO antibodies makes sense based on your symptoms and timeline."
- "Review BUN/Creatinine Ratio if hydration, protein intake, or kidney markers remain a concern."
- "Consider retesting thyroid markers in a few months to confirm the trend."
- "Continue monitoring vitamin D levels — retest in 2–3 months to see if the trend holds."
- "Track how your energy and sleep align with these results over the next few weeks."

Do NOT write: "Increase your intake of..." — that belongs in what_you_can_do_now.

-----------------------------------

SECTION 6 — OVERALL INTERPRETATION (phrase the pre-computed truth, do NOT recalculate)

The primary biomarker, its position against the lab's printed range, current value, previous value, and change have ALREADY been determined deterministically (see PRIMARY CONTEXT below). Your job is to phrase that truth in clean, warm language. You must NOT pick a different primary marker. You must NOT contradict the change provided.

Hard rules:
- 2–3 sentences max
- Maximum 220 characters per sentence
- Sentence 1 (REQUIRED): State the primary biomarker's value and its lab_placement exactly as given (below, within or above the lab's reference range). If a previous_value is provided, you MUST include the change using both numbers.
- Sentence 2 (OPTIONAL): Mention the supporting biomarker (if provided) or add one factual context note. Do NOT introduce new markers not in the lab panel.
- Sentence 3 (OPTIONAL): One forward-looking line about monitoring or trend. Keep it specific.
- Do NOT use em dashes
- Do NOT use filler phrases: "overall", "in general", "it is important to", "be sure to", "this suggests", "may want to consider", "may indicate", "warrants monitoring", "clinical significance depends", "further evaluation may be necessary", "keep an eye on things"
- Do NOT say "everything looks good"
- Do NOT give medical advice
- When change is "no_prior_data": describe the current value and position only. Do NOT fabricate a change or a previous value.
- \`primary_concern.title\` MUST name the same biomarker as \`PRIMARY CONTEXT.primary_biomarker\`. Do not pick a different marker as the title even if you think another finding is more "concerning" — the deterministic primary is the canonical primary.
- \`primary_concern.summary\` and \`primary_concern.why_it_matters\` must center on the PRIMARY CONTEXT biomarker.
- Describe a supporting biomarker only by its lab_placement; never translate the internal claim status into a clinical judgement.
- When \`supporting_biomarker\` is null in PRIMARY CONTEXT, you MUST NOT mention any other marker by name in Sentence 2 or Sentence 3. Use a generic context note instead (e.g., "Continued monitoring will help clarify the trend." or "Tracking this over time will give a clearer picture."). NEVER write phrases like "Your TgAb is also high" or "Your X is also low" when no supporting biomarker was provided.

Phrasing examples (use only the actual supplied values and lab_placement):
- "Ferritin is within the lab's reference range at 18 ng/mL."
- "Vitamin D is below the lab's reference range at 24 ng/mL and has increased from 18 ng/mL since your last report."

BAD examples (never write these):
- "Overall, your results show some areas of concern and some areas of improvement." (filler, no specifics)
- "These results suggest that further evaluation may be necessary." (banned phrasing)
- "It is important to monitor your thyroid health and maintain a healthy lifestyle." (generic)
- "primary_concern.title naming a different marker than PRIMARY CONTEXT.primary_biomarker (e.g., headline says 'Ferritin remains low' but primary_concern.title says 'Elevated ALT')."
- "Your TgAb is also high and worth monitoring." (when direction is "borderline" — do not strengthen borderline to high)
- "Your TgAb is also high and worth monitoring." (no supporting_biomarker in PRIMARY CONTEXT — do not invent marker status; use a generic context note instead)

-----------------------------------

PATIENT CONTEXT:
- Report date: ${report.report_date}
- Cycle: ${cycle_notes}
${context_notes.length ? "- " + context_notes.join("\n- ") : ""}
${userContextBlock ? `\n${userContextBlock}\n` : ""}
LAB PANEL: ${analytes.length} total analytes. Key values shown below:
${labLines}
${patternBlock}
${missingBlock}${formatTrendEvidencePrompt(trendEvidence)}

STRUCTURED FACTS (use these to ground your entire response):
- Below the printed lab range: ${outsideLines("below")}
- Above the printed lab range: ${outsideLines("above")}
- Clinically important in-range markers: ${withinNotable.length > 0 ? withinNotable.map(a => `${label(a)} (${displayVal(a)})`).join(", ") : "none notable"}

PRIMARY CONTEXT (deterministic — do NOT recompute, do NOT select a different primary marker):
${primaryContext ? JSON.stringify({
  primary_biomarker: primaryContext.primary_biomarker,
  current_value: primaryContext.current_value,
  previous_value: primaryContext.previous_value,
  unit: primaryContext.unit,
  lab_placement: primaryContext.lab_placement,
  change: primaryContext.previous_value === null ? "no_prior_data" : primaryContext.current_value === primaryContext.previous_value ? "unchanged" : "changed",
  percent_change: primaryContext.percent_change,
  supporting_biomarker: primaryContext.supporting_biomarker,
}, null, 2) : "null (no primary selected; describe only supplied measurements and lab placements)"}

The overall_interpretation field MUST phrase the PRIMARY CONTEXT above. If previous_value is not null, both values and their numeric change are MANDATORY in sentence 1. Never judge that change as better or worse.

Prioritize the most clinically significant finding first across all sections, using PRIMARY CONTEXT as the anchor.

-----------------------------------

SAFETY

- Do not diagnose conditions
- Do not create urgency unless clearly warranted
- One light disclaimer in the disclaimer field is sufficient — do not repeat it throughout

-----------------------------------

Return ONLY a valid JSON object. No markdown. No code blocks. No preamble. Every array field MUST be an array.

Required schema:
{
  "headline": "string",
  "primary_concern": {
    "title": "string",
    "summary": "string",
    "why_it_matters": "string"
  },
  "key_findings": [
    {
      "biomarker_slug": "string",
      "title": "string",
      "status": "monitor or attention or reassuring",
      "explanation": "string"
    }
  ],
  "pattern_signals": [
    {
      "title": "string",
      "confidence": "emerging or moderate or strong",
      "explanation": "string",
      "related_biomarkers": ["string"]
    }
  ],
  "what_you_can_do_now": ["string"],
  "what_to_do_next": ["string"],
  "overall_interpretation": "string",
  "questions_for_doctor": ["string"],
  "cycle_context": {"explanation": "string"},
  "disclaimer": "string"
}`;

  const first = await callOpenAIOnce(apiKey, prompt, recordCost, onModelFailure);
  if (!first) return null;

  const firstCheck = validateInterpretationOutput(first);
  if (firstCheck.valid) return first;

  console.warn(
    "[generate-interpretation] nutrient validation failed (attempt 1):",
    firstCheck.violations.join(", "),
  );

  const stricterPrompt =
    prompt +
    "\n\nIMPORTANT: Your previous response violated the medical-boundary rules (" +
    firstCheck.violations.join(", ") +
    "). Regenerate without dosages, frequencies, prescriptive verbs, or banned supplements. Re-read the supplement rules above and comply strictly.";

  const second = await callOpenAIOnce(apiKey, stricterPrompt, recordCost, onModelFailure);
  if (!second) return null;

  const secondCheck = validateInterpretationOutput(second);
  if (secondCheck.valid) return second;

  console.warn(
    "[generate-interpretation] nutrient validation failed (attempt 2), sanitizing:",
    secondCheck.violations.join(", "),
  );
  /*
    `sanitizeViolations` returns null when a violation survives in a scalar or
    nested field it cannot filter — the fail-closed path. Keep that null visible
    to the type checker instead of casting it away: the caller's `if (aiResult)`
    is what routes to `generateFallbackInterpretation`, and a future refactor
    that stops checking must fail to compile rather than persist unsafe content.
  */
  const sanitized = sanitizeViolations(second);
  if (sanitized === null) onModelFailure?.("output_rejected");
  if (sanitized === null) {
    // Distinct from the OpenAI-failure logs above: OpenAI answered fine and the
    // policy discarded the answer. Without its own line this is indistinguishable
    // from an API outage in the logs, so nobody can tell how often a paying user
    // gets the deterministic fallback because of a validator false positive.
    console.warn(
      "[generate-interpretation] policy discarded a usable OpenAI interpretation (sanitize failed closed):",
      secondCheck.violations.join(", "),
    );
    return null;
  }
  return sanitized as AIInterpretationOutput;
}

async function callOpenAIOnce(
  apiKey: string,
  prompt: string,
  recordCost?: (sample: GenerationSample) => void,
  onModelFailure?: (failure: ModelFailure) => void,
): Promise<AIInterpretationOutput | null> {
  const started = recordCost ? performance.now() : 0;
  let receivedResponse = false;
  let usage: unknown;
  let model = "gpt-4o-mini";
  try {
    const res = await fetchWithBackoff(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are Amani's clinical interpretation engine. Return ONLY valid JSON. No markdown, no code blocks, no preamble. Educational use only — not medical advice.",
            },
            // PK-PRIV-01: identifiers out before the prompt leaves for OpenAI.
            { role: "user", content: redactLabText(prompt).text },
          ],
          max_tokens: 2200,
          temperature: 0.25,
          response_format: { type: "json_object" },
        }),
      },
      { attemptTimeoutMs: 18000 },
    );

    receivedResponse = true;
    if (!res.ok) {
      onModelFailure?.(httpModelFailure(res.status));
      console.warn("[generate-interpretation] OpenAI status:", res.status);
      return null;
    }

    const data = await res.json();
    usage = data.usage;
    if (typeof data.model === "string") model = data.model;
    const content = data.choices?.[0]?.message?.content;
    if (data.choices?.[0]?.finish_reason === "length") {
      onModelFailure?.("truncated");
      return null;
    }
    if (!content) { onModelFailure?.("output_rejected"); return null; }

    const parsed = JSON.parse(content);
    const result = InterpretationSchema.safeParse(parsed);
    if (!result.success) {
      onModelFailure?.("output_rejected");
      console.warn(
        "[generate-interpretation] OpenAI response failed schema validation:",
        result.error.flatten(),
      );
      return null;
    }
    return result.data as AIInterpretationOutput;
  } catch (e: unknown) {
    const failure = receivedResponse ? "output_rejected" : thrownModelFailure(e);
    onModelFailure?.(failure);
    console.warn("[generate-interpretation] OpenAI failed:", failure);
    return null;
  } finally {
    recordCost?.(generationSample(model, usage, performance.now() - started));
  }
}

// ─── Context sanitization ────────────────────────────────────────────────────
// Parsing is delegated to `LabReportContextSchema` in `_shared/schemas/context.ts`.

function sanitizeReportContext(raw: unknown): LabReportData["context"] {
  const result = LabReportContextSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

// ─── Shared generation pipeline ───────────────────────────────────────────────
// First generation and regeneration (TASK-048) run these identical stages. Only
// the commit differs: the anchor row first, an appended version afterwards.

// The same `createClient(url, key)` call the handler makes, so the shared stages
// see its client and row types. `ReturnType<typeof createClient>` would erase
// the schema generics and type every row as `never`. Type-only; never called.
function serviceClientShape(url: string, key: string) {
  return createClient(url, key);
}
type ServiceClient = ReturnType<typeof serviceClientShape>;

interface GenerationContext {
  report: LabReportData | null;
  userContextBlock: string | null;
  analytes: AnalyteData[];
  priorAnalytes: AnalyteData[];
  priorReportDate: string | null;
  primaryContext: PrimaryContext | null;
  isOptimizationOnly: boolean;
}

async function loadGenerationContext(
  supabase: ServiceClient,
  reportId: string,
  userId: string,
  pinnedSlug: string | null,
): Promise<GenerationContext> {
  const { data: report } = await supabase
    .from("lab_reports")
    .select("id, report_date, estimated_cycle_day, estimated_cycle_phase, context")
    .eq("id", reportId)
    .maybeSingle();

  if (report) {
    (report as { context?: unknown }).context = sanitizeReportContext(
      (report as { context?: unknown }).context,
    );
  }

  // ── Voluntary user profile context (Phase 8A) ──────────────────────────
  // Belt-and-braces: any failure here must NOT block interpretation. On
  // schema-fail, fetch-fail, or empty fields, userContextBlock stays null
  // and the prompt is byte-identical to pre-8A behavior.
  let userContextBlock: string | null = null;
  try {
    const { data: userProfileRaw } = await supabase
      .from("users")
      .select("full_name, age_range, sex_at_birth, pregnancy_status, health_goals, symptoms")
      .eq("id", userId)
      .maybeSingle();

    if (userProfileRaw) {
      const parsed = UserProfileContextSchema.safeParse(userProfileRaw);
      if (parsed.success) {
        userContextBlock = formatUserContextBlock(parsed.data);
      } else {
        console.warn(
          "[generate-interpretation] user profile context failed schema validation:",
          parsed.error.flatten(),
        );
      }
    }
  } catch (err) {
    console.warn(
      "[generate-interpretation] user profile context fetch threw:",
      errorMessage(err),
    );
  }

  const { data: rawAnalytes } = await supabase
    .from("report_analytes")
    .select("id, raw_name, canonical_slug, value_numeric, raw_value_text, unit, raw_reference_range, normalized_min, normalized_max, normalized_operator, normalized_operator_value, is_core")
    .eq("lab_report_id", reportId)
    .order("raw_name");

  const analytes: AnalyteData[] = (rawAnalytes ?? []) as AnalyteData[];
  debugLog(`[generate-interpretation] ${analytes.length} analytes for report ${reportId}`);

  // ── Fetch most recent prior report analytes for the same user ──────────
  let priorAnalytes: AnalyteData[] = [];
  let priorReportDate: string | null = null;
  if (report && userId) {
    const { data: priorReport } = await supabase
      .from("lab_reports")
      .select("id, report_date")
      .eq("user_id", userId)
      .neq("id", reportId)
      .lt("report_date", report.report_date)
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (priorReport?.id) {
      priorReportDate = priorReport.report_date;
      const { data: priorRows } = await supabase
        .from("report_analytes")
        .select("id, raw_name, canonical_slug, value_numeric, raw_value_text, unit, raw_reference_range, normalized_min, normalized_max, normalized_operator, normalized_operator_value, is_core")
        .eq("lab_report_id", priorReport.id);
      priorAnalytes = (priorRows ?? []) as AnalyteData[];
    }
  }

  const primaryContext = buildPrimaryContext(
    analytes,
    priorAnalytes,
    priorReportDate,
    pinnedSlug,
  );

  // A pinned comparison-band finding may be within the printed lab interval.
  // The prompt states that lab fact without inferring a clinical judgement.
  const isOptimizationOnly = !!(
    pinnedSlug &&
    primaryContext &&
    primaryContext.current_status === "in_range"
  );

  return {
    report: (report ?? null) as LabReportData | null,
    userContextBlock, analytes, priorAnalytes, priorReportDate, primaryContext, isOptimizationOnly,
  };
}

/** Per-marker comparison against the same prior report the primary context uses. */
function trendEvidenceFor(ctx: GenerationContext): TrendEvidence[] {
  return buildTrendEvidence(
    ctx.analytes.map(a => ({ slug: slug(a), name: a.raw_name, value: a.value_numeric, unit: a.unit })),
    ctx.priorAnalytes.map(a => ({ slug: slug(a), name: a.raw_name, value: a.value_numeric, unit: a.unit })),
    ctx.priorReportDate,
  );
}

/** Model call, shaping, V2-03c claim authority, Basic projection and the floor
 * check. `policyActive` selects the activated pipeline; a regeneration that
 * appends a version always does. */
async function produceInterpretation(input: {
  ctx: GenerationContext;
  reportId: string;
  trendEvidence: TrendEvidence[];
  tier: Tier;
  generateDeep: boolean;
  policyActive: boolean;
  openaiApiKey: string | undefined;
  /** PK-FIX-01b: the owner's kill switch is on. No model call; the deterministic interpretation is served. */
  aiPaused: boolean;
  recordCost?: (sample: GenerationSample) => void;
}) {
  const { ctx: { report, analytes, primaryContext, userContextBlock, isOptimizationOnly },
    reportId, trendEvidence, generateDeep, openaiApiKey } = input;
  const active = input.policyActive;

  // The floor, as a thunk. Only evaluated on the branch that persists it, so
  // this keeps running exactly as often as it did before tiering — on a
  // skipped or failed model call, never on a successful one.
  const deterministicInterpretation = (): AIInterpretationOutput => report
    ? generateFallbackInterpretation(report as LabReportData, analytes, primaryContext)
    : {
        headline: "Lab data could not be loaded for this report.",
        summary_bullets: [],
        top_findings: [],
        pattern_signals: [],
        cycle_context: { estimated_cycle_day: null, estimated_cycle_phase: "unknown", confidence: "low", explanation: "" },
        questions_for_doctor: [],
        disclaimer: "This report is for educational purposes only and does not constitute medical advice.",
      };


  let aiInterpretation: AIInterpretationOutput | null = null;
  let modelFailure: ModelFailure | null = null;

  // PK-FIX-01b (D12, DT9): while the kill switch is on the model is not called,
  // so aiInterpretation stays null, the deterministic interpretation below is
  // served exactly as on an OpenAI failure, and interpretationGenerated (from
  // aiInterpretation !== null) keeps commitDeepAccess from charging a claim.
  const wantsModel = shouldRequestDeepInterpretation(generateDeep, !!openaiApiKey, analytes.length > 0) && !!report;
  const { result: aiResult, modelCalled } = await callModelUnlessPaused({
    paused: input.aiPaused,
    wanted: wantsModel,
    call: () => {
      console.log("[generate-interpretation] Trying OpenAI...");
      return tryOpenAI(openaiApiKey!, report as LabReportData, analytes, primaryContext, userContextBlock, isOptimizationOnly,
        input.recordCost, trendEvidence, failure => { modelFailure = failure; });
    },
  });

  if (modelCalled && report) {
    if (aiResult) {
      // Phase/day/confidence come from the report, never the model; any
      // model-supplied values are discarded before storage.
      aiResult.cycle_context = { ...deterministicCycleFacts(report as LabReportData), explanation: modelCycleExplanation(aiResult.cycle_context) };
      // Guarantee overall_interpretation is grounded in deterministic primary_context
      if (primaryContext) {
        aiResult.overall_interpretation = formatPrimarySummary(primaryContext);
      }
      aiInterpretation = aiResult;
      console.log("[generate-interpretation] OpenAI succeeded");
    } else {
      console.log("[generate-interpretation] OpenAI failed, using fallback");
    }
  } else if (wantsModel && input.aiPaused) {
    console.log("[generate-interpretation] AI paused by the kill switch — deterministic interpretation, no model call");
  } else if (!generateDeep) {
    // on_demand skips model spend after introductory access is exhausted.
    console.log("[generate-interpretation] Deep access not granted — deterministic interpretation");
  } else {
    console.log("[generate-interpretation] Using fallback (no key or no analytes)");
  }

  const shaped = shapeInterpretation({
    tier: input.tier,
    deepAccessGranted: generateDeep,
    aiInterpretation,
    deterministicInterpretation,
  });

  // V2-03c: the model's output is a proposal. Claims are issued only from the
  // server's trend_evidence and reference-range classifier; server-owned keys
  // are always the server's; Basic preview and counts come from the claim set.
  // A deterministic source keeps its narrative in Basic
  // (MEDICAL_FLOOR.deterministicInterpretation). Inactive requests unchanged.
  const interpretationJson = active
    ? withClaimAuthority(shaped.payload, {
        source: shaped.source, trendEvidence,
        statuses: analytes.map(a => ({ biomarker_slug: slug(a), marker: a.raw_name,
          value: Number(a.value_numeric), unit: a.unit, status: classifyAnalyte(a) })),
      })
    : shaped.payload;
  const basicProjection = active
    ? projectBasic(interpretationJson, { source: shaped.source })
    : buildBasicProjection(interpretationJson, undefined, { source: shaped.source });

  /*
    The medical floor is checked on whatever is about to be persisted, at every
    tier. A violation is logged and the row is still written: it means our
    shaping is wrong, and withholding the report on top of that would punish
    the user for our bug by denying them their own lab data.
  */
  const floorViolations = findFloorViolations(interpretationJson);
  if (floorViolations.length > 0) {
    console.error(
      "[generate-interpretation] MEDICAL FLOOR VIOLATION — a first generation persists anyway; a version append refuses (nothing stored):",
      JSON.stringify({ reportId, tier: shaped.tier, depth: shaped.depth, floorViolations }),
    );
  }

  // The pause changed this answer only when the model would otherwise have been called.
  const pauseApplied = input.aiPaused && wantsModel;
  const fallbackReason = fallbackReasonOf({ deepGeneration: generateDeep, hasReport: !!report,
    hasAnalytes: analytes.length > 0, hasApiKey: !!openaiApiKey, aiPaused: input.aiPaused,
    modelProduced: aiInterpretation !== null });
  return { shaped, aiInterpretation, interpretationJson, basicProjection, floorViolations, pauseApplied, fallbackReason, modelFailure };
}

// ─── Version store (TASK-048) ────────────────────────────────────────────────
// A report that already holds its anchor interpretation is never overwritten in
// place: its regeneration appends a version through the trusted writer, which
// decides nothing about entitlement and consumes nothing, or — for a Free
// request the introductory ledger settles — through commit_deep_access_version,
// which settles the claim and appends in one transaction. Wiring only.

/** The report's anchor interpretation, if it holds one, and whether an
 * introductory claim covers it. Through the owner-bound service reader (one row
 * per owned report, the same claim derivation every reader uses), never the raw table. */
async function readAnchor(supabase: ServiceClient, userId: string, reportId: string): Promise<{ claimCovered: boolean } | null> {
  const { data, error } = await supabase.rpc("read_interpretation_for_server", {
    p_user_id: userId, p_report_id: reportId, p_premium: false,
  });
  if (error) throw new Error(`Anchor read failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error("Unexpected anchor read shape");
  if (data.length === 0) return null;
  return { claimCovered: (data[0] as { has_claim?: unknown }).has_claim === true };
}

type LedgerOutcome = "committed" | "already_claimed" | "limit_reached";

/** Settles the introductory claim and appends the version in one transaction.
 * `limit_reached` persisted nothing. A request id reused with different output
 * is a concurrent twin that committed first (and settled the claim): serve it. */
async function commitLedgerVersion(supabase: ServiceClient, input: {
  userId: string; reportId: string; requestId: string; bloodDrawId: string; evidenceTier: string;
  consumeCredit: boolean; full: Record<string, unknown>; basic: Record<string, unknown>;
}): Promise<{ outcome: LedgerOutcome; appended: { version: StoredVersion; created: boolean } | null }> {
  const { data, error } = await supabase.rpc("commit_deep_access_version", {
    p_user_id: input.userId, p_report_id: input.reportId, p_blood_draw_id: input.bloodDrawId,
    p_evidence_tier: input.evidenceTier, p_request_id: input.requestId, p_full: input.full, p_basic: input.basic,
    p_consume_credit: input.consumeCredit, p_provenance: regenerationProvenance(),
  });
  if (isHistoryProtected(error)) throw new ProtectedHistoryError();
  if (error) {
    if (error.code === REQUEST_REUSED_SQLSTATE) {
      const twin = await findRequestVersion(supabase, input.reportId, input.requestId);
      if (twin) return { outcome: "already_claimed", appended: { version: twin, created: false } };
    }
    throw new Error(`commit_deep_access_version failed: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length !== 1) throw new Error("Unexpected ledger version shape");
  const row = data[0] as { outcome: string; version_id: string | null; history_id: string | null; version_generated_at: string | null };
  if (row.outcome === "limit_reached") return { outcome: "limit_reached", appended: null };
  if ((row.outcome !== "committed" && row.outcome !== "already_claimed") || !row.version_id || !row.history_id || !row.version_generated_at) {
    throw new Error("Unexpected ledger version outcome");
  }
  return {
    outcome: row.outcome,
    appended: {
      version: { versionId: row.version_id, historicalInterpretationId: row.history_id,
        generatedAt: row.version_generated_at, full: input.full, basic: input.basic },
      created: true,
    },
  };
}

/** The version already committed for this request, if any. */
async function findRequestVersion(supabase: ServiceClient, reportId: string, requestId: string): Promise<StoredVersion | null> {
  const { data, error } = await supabase.from("interpretation_versions")
    .select("id, historical_interpretation_id, generated_at, json_output, json_output_basic")
    .eq("lab_report_id", reportId).eq("request_id", requestId).maybeSingle();
  if (error) throw new Error(`Version read failed: ${error.message}`);
  if (!data) return null;
  return {
    versionId: data.id, historicalInterpretationId: data.historical_interpretation_id,
    generatedAt: data.generated_at, full: data.json_output, basic: data.json_output_basic,
  };
}

/** Appends and selects a version. A request id reused with different output is a
 * concurrent twin of this request that committed first: serve it. */
async function appendVersion(supabase: ServiceClient, input: {
  userId: string; reportId: string; requestId: string;
  full: Record<string, unknown>; basic: Record<string, unknown>;
}): Promise<{ version: StoredVersion; created: boolean }> {
  const { data, error } = await supabase.rpc("append_interpretation_version", {
    p_user_id: input.userId, p_report_id: input.reportId, p_request_id: input.requestId,
    p_full: input.full, p_basic: input.basic, p_depth: "deep",
    p_disclaimer: VERSION_DISCLAIMER_VERSION, p_provenance: regenerationProvenance(),
  });
  if (isHistoryProtected(error)) throw new ProtectedHistoryError();
  if (error) {
    if (error.code === REQUEST_REUSED_SQLSTATE) {
      const twin = await findRequestVersion(supabase, input.reportId, input.requestId);
      if (twin) return { version: twin, created: false };
    }
    throw new Error(`append_interpretation_version failed: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length !== 1) throw new Error("Unexpected append shape");
  const row = data[0] as { version_id: string; history_id: string; version_generated_at: string };
  return {
    version: { versionId: row.version_id, historicalInterpretationId: row.history_id,
      generatedAt: row.version_generated_at, full: input.full, basic: input.basic },
    created: true,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

  debugLog("DEPLOYMENT VERIFIED: generate-interpretation v2.3 (auth + ownership). Auth Header Present:", !!req.headers.get("Authorization"));
  const supabase = createClient(supabaseUrl, serviceKey);

  let reportId: string | null = null;
  // PK-PL-A: a regeneration (a keyed request, or a report that already holds its
  // interpretation) is never branded "error" here on a failure. It wrote nothing,
  // the interpretation the user has is intact, and the client that keyed it puts
  // back the status it set.
  let regeneration = false;
  const costSamples: GenerationSample[] = [];
  let costContext: GenerationCostContext | null = null;
  // PK-FIX-01b: every model call this request made, for ai_call_costs; and the kill switch.
  const aiCallSamples: GenerationSample[] = [];
  let callerId: string | null = null;
  let aiPaused = false;
  const pausedFlag = () => (aiPaused ? { ai_paused: true } : {});

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or invalid Authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    callerId = user.id;

    // PK-CONSENT-01: while features.consent_gate is on, uploads and AI processing
    // need her current consent (_shared/consent.ts). Off, this always allows.
    const consentRefused = consentRefusal(await consentGateFor(supabase).check(user.id));
    if (consentRefused) {
      return new Response(JSON.stringify(consentRefused.body), {
        status: consentRefused.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await enforceRateLimit(createRateLimitStore(supabase), {
      userId: user.id,
      endpoint: "generate-interpretation",
      limitPerDay: 20,
    });

    const body = await req.json().catch(() => null);
    const parsedBody = GenerateInterpretationRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request body", detail: parsedBody.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    reportId = parsedBody.data.reportId;
    const requestId = parsedBody.data.request_id ?? null;
    regeneration = requestId !== null;

    const { data: reportCheck } = await supabase
      .from("lab_reports")
      .select("id, user_id")
      .eq("id", reportId)
      .maybeSingle();

    if (!reportCheck) {
      return new Response(JSON.stringify({ error: "Report not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (reportCheck.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // TASK-048: once the report holds its anchor interpretation, a regeneration
    // appends a version instead of overwriting it, keyed by the client's per-tap
    // request_id so a retried regeneration appends nothing twice.
    const anchor = await readAnchor(supabase, user.id, reportId);
    const appendsVersion = anchor !== null;
    regeneration ||= appendsVersion;
    if (appendsVersion && requestId === null) {
      return new Response(JSON.stringify({ error: REQUEST_ID_REQUIRED }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let active = freemiumActive();
    let subCheck = await checkUserSubscription(supabaseUser, user.id, active, true);
    if (!subCheck.allowed && subCheck.reason === "error") return entitlementUnavailable(corsHeaders);
    try {
      active = await generationVisibilityMode({ active, entitlement: subCheck,
        readEnabled: async () => {
          const { data, error } = await supabase.from("interpretation_visibility_config")
            .select("enabled").eq("singleton", true).single();
          if (error || !data) throw new Error("Visibility configuration unavailable");
          return data.enabled === true;
        },
        warn: () => console.warn("[generate-interpretation] Free generation disabled: DB visibility switch is OFF"),
      });
    } catch {
      return entitlementUnavailable(corsHeaders);
    }
    if (freemiumActive() && !active) {
      subCheck = await checkUserSubscription(supabaseUser, user.id, false, true);
      if (!subCheck.allowed && subCheck.reason === "error") return entitlementUnavailable(corsHeaders);
    }
    const tierDecision = resolveTier({
      entitlement: subCheck,
      freemiumActive: active,
    });
    if (tierDecision.gate.gate === "block") {
      debugLog("[generate-interpretation] subscription check blocked:", tierDecision.gate.reason);
      return new Response(
        JSON.stringify({ error: "subscription_required", reason: tierDecision.gate.reason }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // A retry of a committed regeneration is answered from the version store
    // without model spend, claim decision or any write but the report status.
    // Access is the readers' rule: Plus, or an introductory claim on this report.
    if (appendsVersion) {
      const committed = await findRequestVersion(supabase, reportId, requestId!);
      if (committed) {
        await supabase.from("lab_reports").update({ status: "ready" }).eq("id", reportId);
        const full = tierDecision.tier === "plus" || anchor?.claimCovered === true;
        return new Response(JSON.stringify(active ? {
          success: true, source: "ai", reused: true,
          access: full ? "full" : "basic",
          interpretation: full ? committed.full : servedBasic(committed.basic),
          ...visibleClaimProjection(committed.basic), ...versionIdentity(committed),
        } : { success: true, source: "ai", reused: true, ...versionIdentity(committed) }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const ctx = await loadGenerationContext(
      supabase, reportId, reportCheck.user_id, parsedBody.data.primary_canonical_slug ?? null,
    );
    const { analytes, primaryContext } = ctx;
    // A version must pass V2-03c claim authority whatever the switch says, so a
    // regeneration that appends one always runs the activated pipeline. First
    // generation keeps today's behaviour in both states.
    const policyActive = active || appendsVersion;
    // Activated only: per-marker comparison against the same prior report the
    // primary context uses. Inactive requests keep prompt and payload unchanged.
    const trendEvidence: TrendEvidence[] = policyActive ? trendEvidenceFor(ctx) : [];
    debugLog(`[generate-interpretation] primaryContext:`, primaryContext
      ? `${primaryContext.primary_biomarker} trajectory=${primaryContext.trajectory} prev=${primaryContext.previous_value}`
      : "null");

    // Only activated Free requests read the ledger or derive a draw identity.
    // Keep the legacy generation predicate unchanged when the flag is off.
    let accessDecision: DeepAccessDecision | null = null;
    let claimRequest: Omit<CommitRequest, "interpretation"> | null = null;
    // TASK-048 turn 11: what the ledger persisted for an anchored report.
    let ledgerVersion: { version: StoredVersion; created: boolean } | null = null;
    let ledgerLimitReached = false;
    const introActions: IntroductoryAccessActions = {
      async findClaim(userId, bloodDrawId) {
        // RV-GI2: the draw's own claim first; this report's only without one.
        // Whether a report match covers is claimCoverage's decision.
        for (const [column, value] of [["blood_draw_id", bloodDrawId], ["report_id", reportId]] as const) {
          const { data, error } = await supabase
            .from("introductory_deep_access_claims")
            .select("user_id, blood_draw_id, report_id, evidence_tier, claimed_at")
            .eq("user_id", userId)
            .eq(column, value)
            .limit(1)
            .maybeSingle();
          if (error) throw new Error(`Claim read failed: ${error.message}`);
          if (data) return data as ClaimRecord;
        }
        return null;
      },
      async countClaims(userId) {
        const { count, error } = await supabase
          .from("introductory_deep_access_claims")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);
        if (error) throw new Error(`Claim count failed: ${error.message}`);
        if (count === null) throw new Error("Claim count missing");
        return count;
      },
      async commitDeepAccess(input) {
        // An anchored report never persists through commit_deep_access_v2 /
        // save_interpretation: the claim settles with an appended version.
        if (appendsVersion) {
          const settled = await commitLedgerVersion(supabase, {
            userId: input.userId, reportId: input.reportId, requestId: requestId!,
            bloodDrawId: input.bloodDrawId, evidenceTier: input.evidenceTier, consumeCredit: input.consumeCredit,
            full: input.interpretation as Record<string, unknown>, basic: basicProjection,
          });
          ledgerVersion = settled.appended;
          ledgerLimitReached = settled.outcome === "limit_reached";
          if (costContext && settled.outcome === "committed" && input.consumeCredit) {
            costContext.claimConsumed = true;
            costContext.interpretationTier = "plus";
          }
          return settled.outcome;
        }
        const { data, error } = await supabase.rpc("commit_deep_access_v2", {
          p_user_id: input.userId,
          p_report_id: input.reportId,
          p_blood_draw_id: input.bloodDrawId,
          p_evidence_tier: input.evidenceTier,
          p_interpretation: input.interpretation,
          p_basic: basicProjection,
          p_source: "ai",
          p_tier: "plus",
          p_consume_credit: input.consumeCredit,
        });
        if (isHistoryProtected(error)) throw new ProtectedHistoryError();
        if (error) throw new Error(`commit_deep_access failed: ${error.message}`);
        if (data !== "committed" && data !== "already_claimed" && data !== "limit_reached") {
          throw new Error("Unexpected commit_deep_access outcome");
        }
        if (costContext && data === "committed" && input.consumeCredit) {
          costContext.claimConsumed = true;
          costContext.interpretationTier = "plus";
        }
        return data;
      },
    };
    if (active && tierDecision.tier === "free") {
      // Raw accession/collection evidence is not retained in production. Hash
      // the stored upload, only from her own folder (F032), bound to the
      // analytes generated from (F042); never use client-editable report_date.
      const draw = await resolveGenerationDrawIdentity({
        async readReportFile(id) {
          const { data, error } = await supabase
            .from("lab_reports").select("file_url, content_hash").eq("id", id).maybeSingle();
          if (error) throw new Error(`Report identity read failed: ${error.message}`);
          return data;
        },
        async downloadOwnedObject(path) {
          const { data: blob, error } = await supabase.storage.from("lab-files").download(path);
          if (error) throw new Error(`Report file read failed: ${error.message}`);
          if (!blob) throw new Error("Report file missing");
          return await blob.arrayBuffer();
        },
        async saveContentHash(id, contentHash) {
          const { error } = await supabase.from("lab_reports")
            .update({ content_hash: contentHash }).eq("id", id).is("content_hash", null);
          if (error) throw new Error(`Report hash save failed: ${error.message}`);
        },
      }, { userId: user.id, reportId, analytes });
      claimRequest = { userId: user.id, reportId, bloodDrawId: draw.bloodDrawId, evidenceTier: draw.evidenceTier };
      accessDecision = await decideIntroductoryAccess(introActions, {
        tier: "free", userId: user.id, bloodDrawId: draw.bloodDrawId,
        reportId, legacyBloodDrawId: draw.legacyBloodDrawId,
      });
    }

    // Access remains the ledger's decision; generation may continue after exhaustion.
    // get-interpretation reports this same decision as `regeneration` (PK-PL-A).
    const generateDeep = decideDeepGeneration({
      freemiumActive: active, tier: tierDecision.tier, decision: accessDecision,
      postLimitGeneration: Deno.env.get("FREEMIUM_POST_LIMIT_GENERATION"),
    });
    if (active) {
      if (subCheck.allowed && subCheck.plan === undefined) {
        console.warn("[generate-interpretation] Cost telemetry plan missing; recording unknown");
      }
      costContext = {
        userId: user.id, reportId, interpretationTier: tierDecision.tier,
        planAtRequest: subCheck.allowed ? (subCheck.plan ?? "unknown") : "free",
        claimConsumed: false, deep: generateDeep,
      };
    }

    const killSwitchOn = await aiPausedNow();
    const { shaped, aiInterpretation, interpretationJson, basicProjection, floorViolations, pauseApplied, fallbackReason, modelFailure } = await produceInterpretation({
      ctx, reportId, trendEvidence, tier: tierDecision.tier, generateDeep, policyActive, openaiApiKey, aiPaused: killSwitchOn,
      recordCost: sample => {
        aiCallSamples.push(sample);
        if (costContext) costSamples.push(sample);
      },
    });
    // Reported to the app (DT9) only when the pause is why this answer is the basic one.
    aiPaused = pauseApplied;

    const source = shaped.source;

    // TASK-048: an anchored report persists only a deep current-policy AI body,
    // whatever the entitlement outcome. Checked before the ledger, so a refused
    // regeneration consumes no claim. Nothing persisted: the selected
    // interpretation stands, never a fallback.
    if (appendsVersion && !isVersionable({ source, depth: shaped.depth, floorViolations })) {
      console.warn("[generate-interpretation] Regeneration not versioned:", JSON.stringify({ source, depth: shaped.depth }));
      const refused = regenerationFailedResponse(generateDeep, refusalDiagnostics(regenerationRefusalReason(fallbackReason), modelFailure));
      return new Response(JSON.stringify({ ...refused.body, ...pausedFlag() }), {
        status: refused.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let savedByLedger = false;
    if (active && tierDecision.tier === "free") {
      let committed: Awaited<ReturnType<typeof commitGeneratedInterpretation>>;
      try {
        committed = await commitGeneratedInterpretation(introActions, {
          freemiumActive: true,
          tier: tierDecision.tier,
          decision: accessDecision,
          completion: { parseConfident: analytes.length > 0, interpretationGenerated: aiInterpretation !== null },
          request: claimRequest ? { ...claimRequest, interpretation: interpretationJson } : null,
        });
      } catch (err) {
        if (!appendsVersion || err instanceof ProtectedHistoryError) throw err;
        // The transaction rolled back whole (no claim, no version); the
        // previously selected interpretation is intact, so the report is not in error.
        console.error("[generate-interpretation] Ledger version commit error:", errorMessage(err));
        return new Response(JSON.stringify({ error: "Failed to save interpretation" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      savedByLedger = committed.committed;
      shaped.tier = committed.tier;
    }

    // TASK-048 turn 11: the ledger settled an anchored report's claim together
    // with its version, or refused at the limit and persisted nothing. A refused
    // claim is not appended as a Free version: no write, the selection stands.
    // A retry is decided afresh (an exhausted decision, then post-limit rules).
    if (appendsVersion && ledgerLimitReached) {
      console.warn("[generate-interpretation] Regeneration not versioned: introductory limit reached at commit");
      const refused = regenerationFailedResponse(true, refusalDiagnostics("introductory_limit_reached", null));
      return new Response(JSON.stringify(refused.body), {
        status: refused.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (appendsVersion && savedByLedger && !ledgerVersion) {
      throw new Error("Ledger committed an anchored report without a version");
    }

    if (costContext) costContext.interpretationTier = shaped.tier;

    // A race loser saves the already-generated payload with Free metadata.
    // Post-limit always-generation uses this same upsert without consuming a claim.
    // TASK-048: when the report already holds its anchor, the same outcomes
    // append a version instead (the ledger's own version when it settled one);
    // save_interpretation is reached only by a report with no anchor.
    let appended: { version: StoredVersion; created: boolean } | null = savedByLedger ? ledgerVersion : null;
    if (!savedByLedger && appendsVersion) {
      try {
        appended = await appendVersion(supabase, {
          userId: user.id, reportId, requestId: requestId!, full: interpretationJson, basic: basicProjection,
        });
      } catch (err) {
        if (err instanceof ProtectedHistoryError) throw err;
        // The previously selected interpretation is intact, so the report is not in error.
        console.error("[generate-interpretation] Version append error:", errorMessage(err));
        return new Response(JSON.stringify({ error: "Failed to save interpretation" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (!savedByLedger) {
      const { error: upsertError } = await supabase.rpc("save_interpretation", {
        p_user_id: user.id, p_report_id: reportId,
        p_interpretation: interpretationJson,
        p_basic: basicProjection,
        p_stored_depth: shaped.depth, p_source: source, p_tier: shaped.tier,
        p_blood_draw_id: claimRequest?.bloodDrawId ?? null,
      });

      if (isHistoryProtected(upsertError)) {
        // TASK-048: the guard refused an in-place overwrite (a report that
        // gained its anchor after the anchor read: the first-generation race).
        // Nothing was written; the report is intact, so its status is too.
        console.warn("[generate-interpretation] Ordinary regeneration refused: historical interpretation is protected");
        return new Response(JSON.stringify(legacyHistoryProtectedResponse.body), {
          status: legacyHistoryProtectedResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (upsertError) {
        console.error("[generate-interpretation] Upsert error:", upsertError.message);
        await supabase.from("lab_reports").update({ status: "error" }).eq("id", reportId);
        return new Response(JSON.stringify({ error: "Failed to save interpretation" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

    }

    await supabase.from("lab_reports").update({ status: "ready" }).eq("id", reportId);
    console.log("[generate-interpretation] Done — status: ready, source:", source, "tier:", shaped.tier, "depth:", shaped.depth);
    // PK-EXP5 funnel step. Never throws, gives up after 3 seconds: a logging
    // failure never blocks the interpretation the user is waiting for.
    await logServerEvent(createAppEventSink(row => supabase.from("app_events").insert(row)), {
      event: "interpretation_generated", userId: user.id, props: { tier: shaped.tier },
    });

    // The same gate get-interpretation applies, so both responses agree. A
    // version is served as committed (a concurrent twin's body, if it won) and
    // under its own identity, never the historical row's.
    const servedFull = appended ? appended.version.full : interpretationJson;
    const servedBasicProjection = appended ? appended.version.basic : basicProjection;
    const identity = appended ? { reused: !appended.created, ...versionIdentity(appended.version) } : {};
    return new Response(JSON.stringify(active ? {
      success: true, source, ...fallbackDiagnostics(fallbackReason, modelFailure),
      access: shaped.tier === "plus" ? "full" : "basic",
      interpretation: shaped.tier === "plus" ? servedFull : servedBasic(servedBasicProjection),
      ...visibleClaimProjection(servedBasicProjection), ...identity, ...pausedFlag(),
    } : { success: true, source, ...fallbackDiagnostics(fallbackReason, modelFailure), ...identity, ...pausedFlag() }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    const message = errorMessage(err, "Internal server error");
    console.error("[generate-interpretation] Fatal error:", message);

    // Ahead of the status write on purpose. Being over your daily quota says
    // nothing about the report — marking it "error" would permanently brand an
    // intact report as failed for a condition that clears at midnight.
    if (isRateLimitExceeded(err)) {
      return new Response(
        JSON.stringify({ error: "Rate limit reached. Please try again tomorrow." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Same reasoning for a protected legacy row refused by the claim commit:
    // the transaction rolled back, and the report is not in error.
    if (err instanceof ProtectedHistoryError) {
      return new Response(JSON.stringify(legacyHistoryProtectedResponse.body), {
        status: legacyHistoryProtectedResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    inBackground(reporter.captureException(err, { stage: "generate" }));

    // A failed first generation leaves the report without an interpretation, so
    // "error" is true. A failed regeneration wrote nothing and left the selected
    // interpretation intact, so it is not (PK-PL-A).
    if (reportId && !regeneration) {
      try {
        await supabase.from("lab_reports").update({ status: "error" }).eq("id", reportId);
      } catch {
        // Best-effort status update only.
      }
    }
    // The message is logged above, not returned: it is an internal string
    // (Postgres errors, OpenAI responses) with nothing a client can act on.
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    // PK-FIX-01b: one ai_call_costs row per model call, without holding the response.
    for (const sample of aiCallSamples) {
      inBackground(costLedger.record({
        functionName: "generate-interpretation",
        userId: callerId,
        model: sample.model,
        usage: { prompt_tokens: sample.promptTokens, completion_tokens: sample.completionTokens },
      }));
    }
    if (costContext) {
      await recordGenerationCosts(costContext, costSamples, async row => {
        const { error } = await supabase.from("interpretation_generation_costs").insert(row);
        if (error) throw error;
      }, error => console.warn("[generate-interpretation] Cost insert failed:", errorMessage(error)));
    }
  }
});
