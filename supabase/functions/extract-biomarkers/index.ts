import "jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.3";
import { fetchWithBackoff } from "../_shared/fetchWithBackoff.ts";
import { errorType, scrubbedErrorMessage, scrubServerText } from "../_shared/phi-scrub.ts";
import { chatCompletionParams, resolveOpenAiModel } from "../_shared/openai-models.ts";
import { redactLabText } from "../_shared/lab-text-redaction.ts";
import { consentRefusal } from "../_shared/consent.ts";
import { consentGateFor } from "../_shared/consent-gate-supabase.ts";
import { ExtractBiomarkersRequestSchema } from "../_shared/schemas/requests.ts";
import { entitlementUnavailable } from "../_shared/entitlement-response.ts";
import { checkUserSubscription } from "../_shared/subscription-guard.ts";
import { enforceRateLimit, isRateLimitExceeded } from "../_shared/rate-limit.ts";
import { createRateLimitStore } from "../_shared/rate-limit-store.ts";
import { aiPausedBody } from "../_shared/ai-pause.ts";
import { aiPausedNow, edgeAiCostLedger, edgeErrorReporter, inBackground } from "../_shared/edge-ai-guards.ts";

// PK-FIX-01b: error capture (PHI-scrubbed, never blocking), the cross-function
// AI cost ledger, and the kill switch. Once per isolate.
const reporter = edgeErrorReporter("extract-biomarkers");
const costLedger = edgeAiCostLedger("extract-biomarkers");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CanonicalAnalyte {
  id: string;
  slug: string;
  display_name: string;
  category: string;
  subcategory: string | null;
  unit: string | null;
  is_core: boolean;
  is_ratio: boolean;
  affects_scoring: boolean;
  affects_recommendations: boolean;
}

interface ReportAnalyte {
  raw_name: string;
  raw_value_text: string | null;
  value_numeric: number;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_min: number | null;
  normalized_max: number | null;
  normalized_operator: string | null;
  normalized_operator_value: number | null;
  source_snippet: string | null;
  confidence_score: "high" | "medium" | "low";
  canonical_analyte_id: string | null;
  canonical_slug: string | null;
  parse_status: "mapped" | "partial" | "unmapped";
  needs_review: boolean;
  is_core: boolean;
  category: string | null;
}

type SupabaseClient = ReturnType<typeof createClient>;
type RawExtractedItem = Record<string, unknown> & {
  raw_name?: string;
  name?: string;
  canonical_slug?: string | null;
  value_numeric?: number | string | null;
  value_text?: string | null;
  unit?: string | null;
  raw_reference_range?: string | null;
  normalized_reference_min?: number | null;
  normalized_reference_max?: number | null;
  reference_operator?: string | null;
  reference_operator_value?: number | null;
  confidence_score?: "high" | "medium" | "low";
};

const CORE_BIOMARKER_SLUGS = new Set([
  'estradiol', 'progesterone', 'lh', 'fsh', 'amh',
  'total_testosterone', 'free_testosterone', 'dheas', 'prolactin', 'fasting_insulin', 'shbg',
  'tsh', 'free_t4', 'free_t3', 'total_t4', 'reverse_t3', 'tpo_antibodies', 'tg_antibodies',
  'fasting_glucose', 'hemoglobin_a1c', 'c_peptide',
  'total_cholesterol', 'ldl_cholesterol', 'hdl_cholesterol', 'triglycerides', 'non_hdl_cholesterol', 'apob', 'lpa',
  'alt', 'ast', 'ggt', 'alkaline_phosphatase', 'bilirubin_total',
  'creatinine', 'egfr', 'bun',
  'hs_crp', 'esr',
  'ferritin', 'iron_saturation', 'vitamin_d_25_oh', 'vitamin_b12', 'folate', 'magnesium',
]);

const CORE_BIOMARKER_CATEGORIES: Record<string, string> = {
  estradiol: 'hormones', progesterone: 'hormones', lh: 'hormones', fsh: 'hormones', amh: 'hormones',
  total_testosterone: 'hormones', free_testosterone: 'hormones', dheas: 'hormones', prolactin: 'hormones',
  fasting_insulin: 'hormones', shbg: 'hormones',
  tsh: 'thyroid', free_t4: 'thyroid', free_t3: 'thyroid', total_t4: 'thyroid', reverse_t3: 'thyroid',
  tpo_antibodies: 'thyroid', tg_antibodies: 'thyroid',
  fasting_glucose: 'metabolic', hemoglobin_a1c: 'metabolic', c_peptide: 'metabolic',
  total_cholesterol: 'lipids', ldl_cholesterol: 'lipids', hdl_cholesterol: 'lipids', triglycerides: 'lipids',
  non_hdl_cholesterol: 'lipids', apob: 'lipids', lpa: 'lipids',
  alt: 'liver', ast: 'liver', ggt: 'liver', alkaline_phosphatase: 'liver', bilirubin_total: 'liver',
  creatinine: 'kidney', egfr: 'kidney', bun: 'kidney',
  hs_crp: 'inflammation', esr: 'inflammation',
  ferritin: 'nutrients', iron_saturation: 'nutrients', vitamin_d_25_oh: 'nutrients',
  vitamin_b12: 'nutrients', folate: 'nutrients', magnesium: 'nutrients',
};

async function loadCanonicalRegistry(supabaseAdmin: SupabaseClient): Promise<{
  analyteMap: Map<string, CanonicalAnalyte>;
  synonymMap: Map<string, string>;
}> {
  const [{ data: analytes }, { data: synonyms }] = await Promise.all([
    supabaseAdmin.from("canonical_analytes").select("*"),
    supabaseAdmin.from("analyte_synonyms").select("canonical_analyte_id, synonym_text"),
  ]);

  const analyteMap = new Map<string, CanonicalAnalyte>();
  for (const a of (analytes ?? [])) {
    analyteMap.set(a.id, a);
  }

  const synonymMap = new Map<string, string>();
  for (const s of (synonyms ?? [])) {
    synonymMap.set(s.synonym_text.toUpperCase(), s.canonical_analyte_id);
  }

  return { analyteMap, synonymMap };
}

function normalizeRawName(rawName: string): string[] {
  const upper = rawName.toUpperCase().trim();
  const candidates = new Set<string>([upper]);

  const stripped = upper
    .replace(/[,\s]+(SERUM|PLASMA|WHOLE BLOOD|BLOOD|URINE|DIRECT|CALC|CALCULATED)$/i, '')
    .trim();
  if (stripped !== upper) candidates.add(stripped);

  const noParens = upper.replace(/\s*\([^)]*\)/g, '').trim();
  if (noParens !== upper) candidates.add(noParens);

  if (upper.includes('TPO') || upper.includes('THYROID PEROXIDASE')) {
    candidates.add('TPO ANTIBODY');
    candidates.add('THYROID PEROXIDASE ANTIBODIES');
    candidates.add('TPO THYROID PEROXIDASE ANTIBODIES');
    candidates.add('THYROID PEROXIDASE (TPO) AB');
    candidates.add('THYROID PEROXIDASE (TPO) ANTIBODIES');
    candidates.add('THYROID PEROXIDASE ANTIBODY');
    candidates.add('TPO AB');
    candidates.add('TPO ANTIBODIES');
    candidates.add('ANTI-TPO');
  }

  if (upper.includes('T3 UPTAKE') || upper.includes('T-UPTAKE')) {
    candidates.add('T3 UPTAKE');
  }

  if (upper.startsWith('LDL') && !upper.includes('VLDL')) {
    candidates.add('LDL-CHOLESTEROL');
    candidates.add('LDL CHOLESTEROL');
  }

  if (upper.includes('CHOL') && upper.includes('HDL')) {
    candidates.add('CHOL/HDLC RATIO');
    candidates.add('CHOL/HDLC');
  }

  if (upper.includes('NON') && upper.includes('HDL')) {
    candidates.add('NON HDL CHOLESTEROL');
    candidates.add('NON-HDL CHOLESTEROL');
  }

  if (upper.includes('BUN') && upper.includes('CREATININE')) {
    candidates.add('BUN/CREATININE RATIO');
  }

  if (upper.includes('ALBUMIN') && upper.includes('GLOBULIN')) {
    candidates.add('ALBUMIN/GLOBULIN RATIO');
  }

  if (upper === 'RBC' || upper.includes('RED BLOOD CELL')) {
    candidates.add('RBC');
    candidates.add('RED BLOOD CELL COUNT');
  }

  return [...candidates];
}

function resolveCanonicalByLabel(
  rawName: string,
  gptSlug: string | null,
  analyteMap: Map<string, CanonicalAnalyte>,
  synonymMap: Map<string, string>
): { analyte: CanonicalAnalyte | null; matchedVia: "synonym" | "slug" | "none" } {
  const candidates = normalizeRawName(rawName);

  for (const candidate of candidates) {
    const synonymId = synonymMap.get(candidate);
    if (synonymId) {
      const analyte = analyteMap.get(synonymId) ?? null;
      if (analyte) return { analyte, matchedVia: "synonym" };
    }
  }

  if (gptSlug) {
    for (const a of analyteMap.values()) {
      if (a.slug === gptSlug) return { analyte: a, matchedVia: "slug" };
    }
    const SLUG_ALIASES: Record<string, string> = {
      testosterone_total: 'total_testosterone',
      testosterone_free: 'free_testosterone',
      dhea_s: 'dheas',
      insulin: 'fasting_insulin',
      ldl: 'ldl_cholesterol',
      hdl: 'hdl_cholesterol',
      non_hdl: 'non_hdl_cholesterol',
      lpA: 'lpa',
      glucose_fasting: 'fasting_glucose',
      hba1c: 'hemoglobin_a1c',
      hscrp: 'hs_crp',
      vitamin_d: 'vitamin_d_25_oh',
      b12: 'vitamin_b12',
      tgab: 'tg_antibodies',
      total_bilirubin: 'bilirubin_total',
    };
    const aliased = SLUG_ALIASES[gptSlug];
    if (aliased) {
      for (const a of analyteMap.values()) {
        if (a.slug === aliased) return { analyte: a, matchedVia: "slug" };
      }
    }
  }

  return { analyte: null, matchedVia: "none" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    console.log("DEPLOYMENT VERIFIED: extract-biomarkers v2.1 (explicit auth). Auth Header Present:", !!req.headers.get("Authorization"));
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subCheck = await checkUserSubscription(supabase, user.id, undefined, true);
    if (!subCheck.allowed && subCheck.reason === "error") return entitlementUnavailable(corsHeaders);
    if (!subCheck.allowed) {
      console.log("[extract-biomarkers] subscription check blocked:", subCheck.reason);
      return new Response(
        JSON.stringify({ error: "subscription_required", reason: subCheck.reason }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // PK-CONSENT-01: while features.consent_gate is on, uploads and AI processing
    // need her current consent (_shared/consent.ts). Off, this always allows.
    const consentRefused = consentRefusal(await consentGateFor(supabaseAdmin).check(user.id));
    if (consentRefused) {
      return new Response(JSON.stringify(consentRefused.body), {
        status: consentRefused.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PK-FIX-01b (D12): while the owner's kill switch is on, no model call. No
    // items, so the app keeps its own parse; before the rate limit, so a paused
    // attempt spends no quota.
    if (await aiPausedNow()) {
      return new Response(
        JSON.stringify({ ...aiPausedBody(), items: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await enforceRateLimit(createRateLimitStore(supabaseAdmin), {
      userId: user.id,
      endpoint: "extract-biomarkers",
      limitPerDay: 20,
    });

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsedBody = ExtractBiomarkersRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request body", detail: parsedBody.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { text } = parsedBody.data;
    // PK-PRIV-01: strip direct identifiers (name, DOB, record numbers, address,
    // phone, email) before the lab text leaves for OpenAI.
    const labText = redactLabText(text).text;

    const { analyteMap, synonymMap } = await loadCanonicalRegistry(supabaseAdmin);

    const systemPrompt = `You are a medical lab data extraction specialist. Extract EVERY lab test result from the report — not just a fixed set.

CRITICAL RULES:
1. Extract ALL tests on the report, including CBC components, CMP components, ratios, panels, and any other items
2. Parse decimal points EXACTLY as shown (2.1 = 2.1, not 21)
3. For "<0.5" set value_numeric = 0.25, value_text = "<0.5"
4. For "<9" or "< 9" set value_numeric = 4.5, value_text = "<9" (ALWAYS use half the threshold, NEVER 0)
5. For "<10" set value_numeric = 5, value_text = "<10"
6. For "<34" or "<35" set value_numeric = 17, value_text = "<34"
7. For ">200" set value_numeric = 200, value_text = ">200"
8. For "> OR = 60" set value_numeric = 60, value_text = "> OR = 60"
9. CRITICAL: value_numeric must NEVER be 0 for a comparator result like "<9" — always use half the threshold
10. value_numeric must always be a NUMBER, never a string
11. Extract units exactly as shown; use null if not present
12. Preserve reference ranges exactly as shown in raw_reference_range
13. raw_name must be the EXACT label as printed on the report — do not normalize or abbreviate

CANONICAL SLUG MAPPING (use these slugs when the test EXACTLY matches, null otherwise):
Hormones: estradiol, progesterone, lh, fsh, amh, total_testosterone, free_testosterone, dheas, prolactin, fasting_insulin, shbg
Thyroid: tsh, free_t4, free_t3, total_t4, reverse_t3, tpo_antibodies, tg_antibodies
Metabolic: fasting_glucose, hemoglobin_a1c, c_peptide
Lipids/CV: total_cholesterol, ldl_cholesterol, hdl_cholesterol, triglycerides, non_hdl_cholesterol, apob, lpa
Liver: alt, ast, ggt, alkaline_phosphatase, bilirubin_total
Kidney: creatinine, egfr, bun
Inflammation: hs_crp, esr
Nutrients: ferritin, iron_saturation, vitamin_d_25_oh, vitamin_b12, folate, magnesium
Extended: wbc, rbc, hemoglobin, hematocrit, mcv, mch, mchc, rdw, platelets, mpv, neutrophils, lymphocytes, monocytes, eosinophils, basophils, sodium, potassium, chloride, co2, calcium, total_protein, albumin, globulin, chol_hdl_ratio, bun_creatinine_ratio, albumin_globulin_ratio, t3_uptake, free_thyroxine_index, total_t3, serum_iron, tibc, uibc

ALIAS MAPPING — use these to set canonical_slug:
"Testosterone, Total" → total_testosterone
"Testosterone, Free" → free_testosterone
"DHEA-S", "DHEA Sulfate" → dheas
"Insulin", "Fasting Insulin" → fasting_insulin
"TSH", "TSH, 3rd Generation" → tsh
"Free T4", "T4, Free", "Thyroxine, Free" → free_t4
"Free T3", "T3, Free", "Triiodothyronine, Free" → free_t3
"T4 (Thyroxine)", "T4, Serum", "Thyroxine (T4)" → total_t4 (ONLY if NOT labeled as "Free T4")
"T3 Uptake", "T3 Uptake, Serum" → t3_uptake (NOT free_t3 — these are different tests)
"FTI", "Free Thyroxine Index", "T7" → free_thyroxine_index
"TPO Ab", "TPO Antibody", "Thyroid Peroxidase Antibodies", "Thyroid Peroxidase (TPO) Ab", "TPO (Thyroid Peroxidase Antibody)" → tpo_antibodies
"TgAb", "Thyroglobulin Antibodies" → tg_antibodies
"Glucose", "Glucose, Serum" → fasting_glucose
"HbA1c", "A1C", "Glycohemoglobin" → hemoglobin_a1c
"LDL-Cholesterol", "LDL Cholesterol", "LDL Chol Calc", "LDL-C" → ldl_cholesterol
"HDL Cholesterol", "HDL Chol Direct", "HDL-C" → hdl_cholesterol
"Cholesterol, Total" → total_cholesterol (NOT ldl_cholesterol)
"Chol/HDLC Ratio", "Chol/HDLC", "Cholesterol/HDL Ratio" → chol_hdl_ratio
"Non HDL Cholesterol", "Non-HDL Cholesterol", "Non-HDL-C" → non_hdl_cholesterol
"ALT (SGPT)", "SGPT" → alt
"AST (SGOT)", "SGOT" → ast
"Alkaline Phosphatase", "Alk Phos" → alkaline_phosphatase
"Bilirubin, Total", "Total Bilirubin" → bilirubin_total
"Creatinine, Serum" → creatinine
"eGFR", "GFR Estimated" → egfr
"BUN", "Urea Nitrogen (BUN)", "Blood Urea Nitrogen" → bun
"BUN/Creatinine Ratio" → bun_creatinine_ratio
"Albumin/Globulin Ratio", "A/G Ratio" → albumin_globulin_ratio
"hs-CRP", "C-Reactive Protein, Cardiac", "High Sensitivity CRP" → hs_crp
"Ferritin, Serum" → ferritin
"Iron, % Saturation", "Iron Saturation", "Transferrin Saturation" → iron_saturation
"Iron", "Serum Iron", "Iron, Serum" → serum_iron (NOT iron_saturation)
"TIBC", "Total Iron Binding Capacity" → tibc
"UIBC" → uibc
"Vitamin D, 25-Hydroxy", "Vitamin D (25-OH)", "25-OH Vitamin D" → vitamin_d_25_oh
"Vitamin B12, Serum", "Vitamin B12" → vitamin_b12
"Folate, Serum" → folate
"Magnesium, Serum" → magnesium
"WBC", "White Blood Cells" → wbc
"RBC", "Red Blood Cell Count", "Red Blood Cells" → rbc
"Hemoglobin", "HGB", "Hgb" → hemoglobin
"Hematocrit", "HCT" → hematocrit
"Platelet Count", "Platelets", "PLT" → platelets
"MPV", "Mean Platelet Volume" → mpv
"RDW", "RDW-CV", "Red Cell Distribution Width" → rdw

REFERENCE RANGE FORMATS - preserve exactly in raw_reference_range:
- Min-max: "65-99" → normalized_reference_min: 65, normalized_reference_max: 99, reference_operator: null
- Comparator: "<200" → normalized_reference_min: null, normalized_reference_max: null, reference_operator: "<", reference_operator_value: 200
- Comparator: "> OR = 60" → reference_operator: "> OR =", reference_operator_value: 60
- Comparator: ">= 60" → reference_operator: ">=", reference_operator_value: 60
- Comparator: "<= 9" → reference_operator: "<=", reference_operator_value: 9

Return ONLY a JSON object: { "items": [...] }

Each item has these fields:
{
  "raw_name": string,         // test name EXACTLY as on report
  "canonical_slug": string | null,
  "value_numeric": number,
  "value_text": string | null,
  "unit": string | null,
  "raw_reference_range": string | null,
  "normalized_reference_min": number | null,
  "normalized_reference_max": number | null,
  "reference_operator": string | null,
  "reference_operator_value": number | null,
  "confidence_score": "high" | "medium" | "low"
}

CONFIDENCE:
- high: value + unit + reference range all found
- medium: value + unit, no reference range
- low: value only, unit missing or unclear`;

    const userPrompt = `Extract ALL lab test results from this report. Include every item with a numeric result.\n\n${labText}\n\nReturn JSON: { "items": [...] }`;

    const model = resolveOpenAiModel("extraction", (name) => Deno.env.get(name));
    const openaiResponse = await fetchWithBackoff(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          ...chatCompletionParams(model, { maxOutputTokens: 4000, temperature: 0.1 }),
          response_format: { type: "json_object" }
        }),
      },
      { attemptTimeoutMs: 25000 },
    );

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      // F033: the body can echo report content, so it is scrubbed in the log and
      // kept out of the thrown message (which reaches the client).
      console.error("OpenAI API error:", openaiResponse.status, scrubServerText(errorData));
      throw new Error(`OpenAI API error: status ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    inBackground(costLedger.record({
      functionName: "extract-biomarkers",
      userId: user.id,
      model: typeof openaiData?.model === "string" ? openaiData.model : model,
      usage: openaiData?.usage,
    }));
    const content = openaiData.choices[0].message.content;

    let rawItems: RawExtractedItem[];
    try {
      const parsedJson = JSON.parse(content) as unknown;
      if (Array.isArray(parsedJson)) {
        rawItems = parsedJson as RawExtractedItem[];
      } else if (
        parsedJson &&
        typeof parsedJson === "object" &&
        "items" in parsedJson &&
        Array.isArray(parsedJson.items)
      ) {
        rawItems = parsedJson.items as RawExtractedItem[];
      } else if (
        parsedJson &&
        typeof parsedJson === "object" &&
        "biomarkers" in parsedJson &&
        Array.isArray(parsedJson.biomarkers)
      ) {
        rawItems = parsedJson.biomarkers as RawExtractedItem[];
      } else {
        rawItems = [];
      }
    } catch {
      rawItems = [];
    }

    for (const item of rawItems) {
      if ((item.value_numeric === 0 || item.value_numeric == null) && item.value_text) {
        const comparatorMatch = String(item.value_text).match(/^([<>]=?)\s*(\d+(?:\.\d+)?)/);
        if (comparatorMatch) {
          const threshold = parseFloat(comparatorMatch[2]);
          const op = comparatorMatch[1];
          if (op.startsWith('<')) {
            item.value_numeric = threshold / 2;
          } else {
            item.value_numeric = threshold;
          }
        }
      }
    }

    const reportAnalytes: ReportAnalyte[] = rawItems
      .filter(item => typeof item.value_numeric === 'number' && !isNaN(item.value_numeric))
      .map(item => {
        const rawName = item.raw_name ?? item.name ?? 'Unknown';
        const gptSlug = item.canonical_slug ?? null;

        const { analyte, matchedVia } = resolveCanonicalByLabel(rawName, gptSlug, analyteMap, synonymMap);

        /*
          The `[TPO DEBUG]` block that used to sit here printed the verbatim
          biomarker label off the user's report into Supabase's function logs,
          which are retained and readable in the dashboard. "This account was
          tested for thyroid peroxidase antibodies" is health data, and it was
          leftover instrumentation from a single synonym-matching investigation
          (docs/tpo-history-audit.sql), not telemetry anything depends on.
          Removed rather than gated: there is no DEBUG flag in this function, and
          adding one would keep a PHI sink one env var away from firing.
        */

        const canonicalSlug = analyte?.slug ?? null;
        const isCore = canonicalSlug ? CORE_BIOMARKER_SLUGS.has(canonicalSlug) : false;
        const category = canonicalSlug ? (CORE_BIOMARKER_CATEGORIES[canonicalSlug] ?? analyte?.category ?? null) : null;

        let parseStatus: "mapped" | "partial" | "unmapped" = "unmapped";
        if (analyte) {
          parseStatus = matchedVia === "synonym" ? "mapped" : "partial";
        }

        const RATIO_SLUGS = new Set([
          'chol_hdl_ratio', 'bun_creatinine_ratio', 'albumin_globulin_ratio', 'free_thyroxine_index',
        ]);
        const isRatio = canonicalSlug
          ? RATIO_SLUGS.has(canonicalSlug)
          : /ratio|index/i.test(rawName);
        const needsReview = item.confidence_score === 'low' || (!item.unit && !isRatio);

        return {
          raw_name: rawName,
          raw_value_text: item.value_text ?? null,
          value_numeric: typeof item.value_numeric === 'number' ? item.value_numeric : parseFloat(item.value_numeric),
          unit: item.unit ?? null,
          raw_reference_range: item.raw_reference_range ?? null,
          normalized_min: item.normalized_reference_min ?? null,
          normalized_max: item.normalized_reference_max ?? null,
          normalized_operator: item.reference_operator ?? null,
          normalized_operator_value: item.reference_operator_value ?? null,
          source_snippet: null,
          confidence_score: item.confidence_score ?? 'low',
          canonical_analyte_id: analyte?.id ?? null,
          canonical_slug: canonicalSlug,
          parse_status: parseStatus,
          needs_review: needsReview,
          is_core: isCore,
          category,
        } as ReportAnalyte;
      });

    const validatedAnalytes = applySanityChecks(reportAnalytes);

    const coverage = {
      total_detected: validatedAnalytes.length,
      total_core: validatedAnalytes.filter(i => i.is_core).length,
      total_extended: validatedAnalytes.filter(i => !i.is_core).length,
      needs_review: validatedAnalytes.filter(i => i.needs_review).length,
      total_mapped: validatedAnalytes.filter(i => i.parse_status === 'mapped').length,
      total_unmapped: validatedAnalytes.filter(i => i.parse_status === 'unmapped').length,
    };

    await supabaseAdmin.from("audit_events").insert({
      user_id: user.id,
      event_type: "lab_uploaded",
      metadata: { ...coverage },
    }).then(() => {});

    const legacyItems = validatedAnalytes.map(a => ({
      raw_name: a.raw_name,
      canonical_slug: a.canonical_slug,
      category: a.category,
      value_numeric: a.value_numeric,
      value_text: a.raw_value_text,
      unit: a.unit,
      raw_reference_range: a.raw_reference_range,
      normalized_reference_min: a.normalized_min,
      normalized_reference_max: a.normalized_max,
      reference_operator: a.normalized_operator,
      reference_operator_value: a.normalized_operator_value,
      confidence_score: a.confidence_score,
      needs_review: a.needs_review,
      is_core_biomarker: a.is_core,
      source_snippet: a.source_snippet,
    }));

    return new Response(
      JSON.stringify({ items: legacyItems, analytes: validatedAnalytes, coverage }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error extracting biomarkers:", errorType(error), scrubbedErrorMessage(error));

    if (isRateLimitExceeded(error)) {
      return new Response(
        JSON.stringify({ error: "Rate limit reached. Please try again tomorrow." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    inBackground(reporter.captureException(error, { stage: "extract" }));
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function applySanityChecks(items: ReportAnalyte[]): ReportAnalyte[] {
  return items.map(item => {
    const b = { ...item };
    if (!b.value_numeric) return b;
    if (b.canonical_slug === 'tsh' && b.value_numeric > 50) b.confidence_score = 'low';
    if (b.canonical_slug === 'estradiol' && b.value_numeric > 5000) b.confidence_score = 'low';
    if (b.canonical_slug === 'progesterone' && b.value_numeric > 100) b.confidence_score = 'low';
    if (b.canonical_slug === 'ferritin' && b.value_numeric > 10000) b.confidence_score = 'low';
    if (b.canonical_slug === 'vitamin_d_25_oh' && b.value_numeric > 500) b.confidence_score = 'low';
    if (b.canonical_slug === 'free_t4' && b.value_numeric > 10) b.confidence_score = 'low';
    if (b.canonical_slug === 'fasting_glucose' && b.value_numeric > 600) b.confidence_score = 'low';
    if (b.canonical_slug === 'total_cholesterol' && b.value_numeric > 1000) b.confidence_score = 'low';
    if (b.canonical_slug === 'hemoglobin_a1c' && b.value_numeric > 20) b.confidence_score = 'low';
    if (b.canonical_slug === 'egfr' && b.value_numeric > 200) b.confidence_score = 'low';
    if (b.value_numeric <= 0) b.confidence_score = 'low';
    if (b.confidence_score === 'low') b.needs_review = true;
    return b;
  });
}
