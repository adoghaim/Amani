import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ExtractedBiomarker {
  name: string;
  value: number;
  rawValue?: string;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  confidence: 'high' | 'medium' | 'low';
}

const SUPPORTED_BIOMARKERS = [
  'estradiol', 'progesterone', 'lh', 'fsh', 'amh',
  'total_testosterone', 'free_testosterone', 'dheas', 'prolactin', 'fasting_insulin', 'shbg',
  'tsh', 'free_t4', 'free_t3', 'total_t4', 'reverse_t3', 'tpo_antibodies', 'tg_antibodies',
  'fasting_glucose', 'hemoglobin_a1c', 'c_peptide',
  'total_cholesterol', 'ldl_cholesterol', 'hdl_cholesterol', 'triglycerides', 'non_hdl_cholesterol', 'apob', 'lpa',
  'alt', 'ast', 'ggt', 'alkaline_phosphatase', 'bilirubin_total',
  'creatinine', 'egfr', 'bun',
  'hs_crp', 'esr',
  'ferritin', 'iron_saturation', 'vitamin_d_25_oh', 'vitamin_b12', 'folate', 'magnesium',
];

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

    const systemPrompt = `You are a medical lab data extraction specialist. Your task is to extract biomarker data from lab reports with EXTREME precision.

CRITICAL RULES:
1. Parse decimal points EXACTLY as they appear (e.g., "2.1" = 2.1, NOT 21 or 210)
2. For values like "<0.5" or "< 0.5", set value = 0.25 (half of the limit) and rawValue = "<0.5"
3. For values like ">200", set value = 200 and rawValue = ">200"
4. value field must be a NUMBER, never a string
5. Extract units exactly as shown
6. Reference ranges: look for patterns like "30–400", "0.4–4.0", null if absent

CANONICAL BIOMARKER NAMES (use these EXACT slugs):
Hormones:
- "Estradiol", "E2", "Estrogen" → "estradiol"
- "Progesterone" → "progesterone"
- "LH", "Luteinizing Hormone" → "lh"
- "FSH", "Follicle Stimulating Hormone" → "fsh"
- "AMH", "Anti-Mullerian Hormone" → "amh"
- "Testosterone, Total", "Total Testosterone" → "total_testosterone"
- "Testosterone, Free", "Free Testosterone" → "free_testosterone"
- "DHEA-S", "DHEA Sulfate", "DHEAS" → "dheas"
- "Prolactin" → "prolactin"
- "Insulin", "Fasting Insulin" → "fasting_insulin"
- "SHBG", "Sex Hormone Binding Globulin" → "shbg"

Thyroid:
- "TSH", "Thyroid Stimulating Hormone" → "tsh"
- "Free T4", "FT4", "Free Thyroxine", "T4, Free" → "free_t4"
- "Free T3", "FT3", "Free Triiodothyronine", "T3, Free" → "free_t3"
- "T4 Total", "Total T4" → "total_t4"
- "Reverse T3", "RT3" → "reverse_t3"
- "TPO Antibodies", "Thyroid Peroxidase Antibodies", "TPO Ab", "Anti-TPO" → "tpo_antibodies"
- "Thyroglobulin Antibodies", "TgAb", "Thyroglobulin Ab" → "tg_antibodies"

Metabolic:
- "Glucose", "Fasting Glucose", "Glucose, Serum" → "fasting_glucose"
- "HbA1c", "A1C", "Hemoglobin A1c" → "hemoglobin_a1c"
- "C-Peptide" → "c_peptide"

Cardiovascular/Lipids:
- "Total Cholesterol", "Cholesterol, Total" → "total_cholesterol"
- "LDL Cholesterol", "LDL Chol Calc", "LDL-C" → "ldl_cholesterol"
- "HDL Cholesterol", "HDL Chol Direct", "HDL-C" → "hdl_cholesterol"
- "Triglycerides" → "triglycerides"
- "Non-HDL Cholesterol", "Non-HDL Chol" → "non_hdl_cholesterol"
- "ApoB", "Apolipoprotein B" → "apob"
- "Lp(a)", "Lipoprotein(a)" → "lpa"

Liver:
- "ALT", "Alanine Aminotransferase", "ALT (SGPT)", "SGPT" → "alt"
- "AST", "Aspartate Aminotransferase", "AST (SGOT)", "SGOT" → "ast"
- "GGT", "Gamma-Glutamyl Transferase", "GGT (Gamma Glutamyl Transpeptidase)" → "ggt"
- "Alkaline Phosphatase", "Alk Phos", "ALP" → "alkaline_phosphatase"
- "Total Bilirubin", "Bilirubin, Total" → "bilirubin_total"

Kidney:
- "Creatinine", "Serum Creatinine", "Creatinine, Serum" → "creatinine"
- "eGFR", "Estimated GFR", "eGFR Non-Afr. American", "GFR Estimated Non-African American" → "egfr"
- "BUN", "Blood Urea Nitrogen", "Urea Nitrogen" → "bun"

Inflammation:
- "hs-CRP", "High Sensitivity CRP", "hsCRP", "C-Reactive Protein, Cardiac" → "hs_crp"
- "ESR", "Sed Rate", "Sedimentation Rate" → "esr"

Nutrients:
- "Ferritin", "Ferritin, Serum" → "ferritin"
- "Iron Saturation", "Iron, % Saturation", "Transferrin Saturation" → "iron_saturation"
- "Vitamin D, 25-Hydroxy", "25-OH Vitamin D", "Vitamin D (25-OH)" → "vitamin_d_25_oh"
- "Vitamin B12", "B12", "Vitamin B12, Serum" → "vitamin_b12"
- "Folate", "Folic Acid", "Folate, Serum" → "folate"
- "Magnesium", "Magnesium, Serum" → "magnesium"

ONLY extract biomarkers from the above list. Return ONLY a JSON object with a "biomarkers" array.

CONFIDENCE:
- high: value + unit + reference range all extracted
- medium: value + unit, no reference range
- low: value only, unit unclear`;

    const userPrompt = `Extract all biomarker data from this lab report text:\n\n${text}\n\nReturn JSON: { "biomarkers": [...] }`;

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
        max_tokens: 3000,
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

    let biomarkers: ExtractedBiomarker[];
    try {
      const parsedJson = JSON.parse(content);
      if (Array.isArray(parsedJson)) {
        biomarkers = parsedJson;
      } else if (parsedJson.biomarkers && Array.isArray(parsedJson.biomarkers)) {
        biomarkers = parsedJson.biomarkers;
      } else {
        biomarkers = [];
      }
    } catch {
      biomarkers = [];
    }

    const normalizedBiomarkers = biomarkers.map(b => ({
      ...b,
      name: normalizeName(b.name),
    }));

    const validatedBiomarkers = applySanityChecks(
      normalizedBiomarkers.filter(b => SUPPORTED_BIOMARKERS.includes(b.name))
    );

    await supabaseAdmin.from("audit_events").insert({
      user_id: user.id,
      event_type: "lab_uploaded",
      metadata: { biomarker_count: validatedBiomarkers.length },
    }).then(() => {});

    return new Response(
      JSON.stringify({ biomarkers: validatedBiomarkers }),
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

function applySanityChecks(biomarkers: ExtractedBiomarker[]): ExtractedBiomarker[] {
  const validated = biomarkers.map(b => {
    const marker = { ...b };
    if (marker.name === 'tsh' && marker.value > 50) marker.confidence = 'low';
    if (marker.name === 'estradiol' && marker.value > 5000) marker.confidence = 'low';
    if (marker.name === 'progesterone' && marker.value > 100) marker.confidence = 'low';
    if (marker.name === 'ferritin' && marker.value > 10000) marker.confidence = 'low';
    if (marker.name === 'vitamin_d_25_oh' && marker.value > 500) marker.confidence = 'low';
    if (marker.name === 'free_t4' && marker.value > 10) marker.confidence = 'low';
    if (marker.name === 'fasting_glucose' && marker.value > 600) marker.confidence = 'low';
    if (marker.name === 'total_cholesterol' && marker.value > 1000) marker.confidence = 'low';
    if (marker.name === 'hemoglobin_a1c' && marker.value > 20) marker.confidence = 'low';
    if (marker.name === 'egfr' && marker.value > 200) marker.confidence = 'low';
    if (marker.value <= 0) marker.confidence = 'low';
    if (marker.reference_min !== null && marker.reference_max !== null) {
      if (marker.reference_min >= marker.reference_max) marker.confidence = 'low';
    }
    return marker;
  });

  const referenceRanges = new Map<string, number>();
  validated.forEach(b => {
    if (b.reference_min !== null && b.reference_max !== null) {
      const rangeKey = `${b.reference_min}-${b.reference_max}`;
      referenceRanges.set(rangeKey, (referenceRanges.get(rangeKey) || 0) + 1);
    }
  });

  referenceRanges.forEach((count, range) => {
    if (count > 3) {
      validated.forEach(b => {
        if (b.reference_min !== null && b.reference_max !== null) {
          if (`${b.reference_min}-${b.reference_max}` === range) {
            b.confidence = 'low';
          }
        }
      });
    }
  });

  return validated;
}
