import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ComparatorRange {
  operator: string;
  value: number;
  raw: string;
}

interface ReportItem {
  raw_name: string;
  canonical_slug: string | null;
  category: string | null;
  value_numeric: number;
  value_text: string | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_reference_min: number | null;
  normalized_reference_max: number | null;
  reference_operator: string | null;
  reference_operator_value: number | null;
  confidence_score: "high" | "medium" | "low";
  is_core_biomarker: boolean;
}

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

function normalizeName(name: string): string {
  return SLUG_ALIASES[name] ?? name;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await checkAndIncrementRateLimit(supabaseAdmin, user.id, "extract-biomarkers", 20);

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { text } = body;

    if (!text || typeof text !== 'string') {
      return new Response(
        JSON.stringify({ error: "text parameter is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a medical lab data extraction specialist. Extract EVERY lab test result from the report — not just a fixed set.

CRITICAL RULES:
1. Extract ALL tests on the report, including CBC components, CMP components, ratios, panels, and any other items
2. Parse decimal points EXACTLY as shown (2.1 = 2.1, not 21)
3. For "<0.5" set value_numeric = 0.25, value_text = "<0.5"
4. For ">200" set value_numeric = 200, value_text = ">200"
5. For "> OR = 60" set value_numeric = 60, value_text = "> OR = 60"
6. value_numeric must always be a NUMBER, never a string
7. Extract units exactly as shown; use null if not present
8. Preserve reference ranges exactly as shown in raw_reference_range

CANONICAL SLUG MAPPING (use these slugs when the test matches, null otherwise):
Hormones: estradiol, progesterone, lh, fsh, amh, total_testosterone, free_testosterone, dheas, prolactin, fasting_insulin, shbg
Thyroid: tsh, free_t4, free_t3, total_t4, reverse_t3, tpo_antibodies, tg_antibodies
Metabolic: fasting_glucose, hemoglobin_a1c, c_peptide
Lipids/CV: total_cholesterol, ldl_cholesterol, hdl_cholesterol, triglycerides, non_hdl_cholesterol, apob, lpa
Liver: alt, ast, ggt, alkaline_phosphatase, bilirubin_total
Kidney: creatinine, egfr, bun
Inflammation: hs_crp, esr
Nutrients: ferritin, iron_saturation, vitamin_d_25_oh, vitamin_b12, folate, magnesium

ALIAS MAPPING:
"Testosterone, Total" → total_testosterone, "Testosterone, Free" → free_testosterone
"DHEA-S", "DHEA Sulfate" → dheas, "Insulin", "Fasting Insulin" → fasting_insulin
"TSH" → tsh, "Free T4", "T4, Free" → free_t4, "Free T3", "T3, Free" → free_t3
"Glucose", "Glucose, Serum" → fasting_glucose, "HbA1c", "A1C" → hemoglobin_a1c
"LDL Chol Calc", "LDL-C" → ldl_cholesterol, "HDL Chol Direct" → hdl_cholesterol
"ALT (SGPT)", "SGPT" → alt, "AST (SGOT)", "SGOT" → ast
"Creatinine, Serum" → creatinine, "eGFR", "GFR Estimated" → egfr
"hs-CRP", "C-Reactive Protein, Cardiac" → hs_crp
"Ferritin, Serum" → ferritin, "Iron, % Saturation" → iron_saturation
"Vitamin D, 25-Hydroxy", "Vitamin D (25-OH)" → vitamin_d_25_oh
"Vitamin B12, Serum" → vitamin_b12, "Folate, Serum" → folate, "Magnesium, Serum" → magnesium
"Bilirubin, Total" → bilirubin_total, "Urea Nitrogen (BUN)", "Blood Urea Nitrogen" → bun
"TPO Ab", "Thyroid Peroxidase Antibodies" → tpo_antibodies

REFERENCE RANGE FORMATS - preserve exactly in raw_reference_range:
- Min-max: "65-99" → normalized_reference_min: 65, normalized_reference_max: 99, reference_operator: null
- Comparator: "<200" → normalized_reference_min: null, normalized_reference_max: null, reference_operator: "<", reference_operator_value: 200
- Comparator: "> OR = 60" → reference_operator: "> OR =", reference_operator_value: 60
- Comparator: ">= 60" → reference_operator: ">=", reference_operator_value: 60
- Comparator: "<= 9" → reference_operator: "<=", reference_operator_value: 9

EXTENDED ITEMS — extract ALL of these too, with canonical_slug = null, category = null:

CBC: WBC (White Blood Cells), RBC (Red Blood Cells), Hemoglobin (Hgb), Hematocrit (Hct), MCV, MCH, MCHC, RDW (Red Cell Distribution Width), Platelet Count (PLT), Neutrophils, Lymphocytes, Monocytes, Eosinophils, Basophils

CMP electrolytes & proteins: Sodium (Na), Potassium (K), Chloride (Cl), CO2 (Carbon Dioxide / Bicarbonate), Calcium, Total Protein, Albumin, Globulin, A/G Ratio, BUN/Creatinine Ratio

Thyroid extras: T3 Uptake, Free Thyroxine Index (FTI / T7), Total T3 (Triiodothyronine, Total)

Iron panel: Serum Iron, TIBC (Total Iron Binding Capacity), UIBC (Unsaturated Iron Binding Capacity)

Lipid extras: Cholesterol/HDL Ratio

Any other test on the report with a numeric value — do NOT skip any item.

IMPORTANT: For all CBC/CMP/iron/thyroid-extra items above: set canonical_slug = null (they are not in the core panel).

Return ONLY a JSON object: { "items": [...] }

Each item has these fields:
{
  "raw_name": string,         // test name exactly as on report
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

    const userPrompt = `Extract ALL lab test results from this report. Include every item with a numeric result.\n\n${text}\n\nReturn JSON: { "items": [...] }`;

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 4000,
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      console.error("OpenAI API error:", errorData);
      throw new Error(`OpenAI API error: ${errorData}`);
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices[0].message.content;

    let rawItems: any[];
    try {
      const parsedJson = JSON.parse(content);
      if (Array.isArray(parsedJson)) {
        rawItems = parsedJson;
      } else if (parsedJson.items && Array.isArray(parsedJson.items)) {
        rawItems = parsedJson.items;
      } else if (parsedJson.biomarkers && Array.isArray(parsedJson.biomarkers)) {
        rawItems = parsedJson.biomarkers;
      } else {
        rawItems = [];
      }
    } catch {
      rawItems = [];
    }

    const items: ReportItem[] = rawItems
      .filter(item => typeof item.value_numeric === 'number' && !isNaN(item.value_numeric))
      .map(item => {
        const rawSlug = item.canonical_slug ?? item.name ?? null;
        const normalizedSlug = rawSlug ? normalizeName(rawSlug) : null;
        const canonicalSlug = normalizedSlug && CORE_BIOMARKER_SLUGS.has(normalizedSlug) ? normalizedSlug : null;
        const isCore = canonicalSlug !== null;
        const category = canonicalSlug ? (CORE_BIOMARKER_CATEGORIES[canonicalSlug] ?? null) : null;

        return {
          raw_name: item.raw_name ?? item.name ?? 'Unknown',
          canonical_slug: canonicalSlug,
          category,
          value_numeric: typeof item.value_numeric === 'number' ? item.value_numeric : parseFloat(item.value_numeric),
          value_text: item.value_text ?? null,
          unit: item.unit ?? null,
          raw_reference_range: item.raw_reference_range ?? null,
          normalized_reference_min: item.normalized_reference_min ?? null,
          normalized_reference_max: item.normalized_reference_max ?? null,
          reference_operator: item.reference_operator ?? null,
          reference_operator_value: item.reference_operator_value ?? null,
          confidence_score: item.confidence_score ?? 'low',
          is_core_biomarker: isCore,
        };
      });

    const validatedItems = applySanityChecks(items);

    const coverage = {
      total_detected: validatedItems.length,
      total_core: validatedItems.filter(i => i.is_core_biomarker).length,
      total_extended: validatedItems.filter(i => !i.is_core_biomarker).length,
      needs_review: validatedItems.filter(i => i.confidence_score === 'low' || !i.unit).length,
    };

    await supabaseAdmin.from("audit_events").insert({
      user_id: user.id,
      event_type: "lab_uploaded",
      metadata: { ...coverage },
    }).then(() => {});

    return new Response(
      JSON.stringify({ items: validatedItems, coverage }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error extracting biomarkers:", error);

    if (error?.message === "RATE_LIMIT_EXCEEDED") {
      return new Response(
        JSON.stringify({ error: "Rate limit reached. Please try again tomorrow." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function checkAndIncrementRateLimit(
  supabase: any,
  userId: string,
  endpoint: string,
  limitPerDay: number
): Promise<void> {
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);

  const { data: existing } = await supabase
    .from("rate_limits")
    .select("id, count")
    .eq("user_id", userId)
    .eq("endpoint", endpoint)
    .gte("window_start", windowStart.toISOString())
    .maybeSingle();

  if (existing) {
    if (existing.count >= limitPerDay) throw new Error("RATE_LIMIT_EXCEEDED");
    await supabase.from("rate_limits").update({ count: existing.count + 1 }).eq("id", existing.id);
  } else {
    await supabase.from("rate_limits").insert({
      user_id: userId,
      endpoint,
      window_start: windowStart.toISOString(),
      count: 1,
    });
  }
}

function applySanityChecks(items: ReportItem[]): ReportItem[] {
  return items.map(item => {
    const b = { ...item };
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
    return b;
  });
}
