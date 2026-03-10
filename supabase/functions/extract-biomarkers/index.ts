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
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  confidence: 'high' | 'medium' | 'low';
}

const SUPPORTED_BIOMARKERS = [
  'estradiol','progesterone','lh','fsh','amh',
  'testosterone_total','testosterone_free','dhea_s','cortisol','prolactin','insulin','shbg',
  'tsh','free_t4','free_t3','reverse_t3','tpo_antibodies','tgab',
  'glucose_fasting','hba1c',
  'total_cholesterol','ldl','hdl','triglycerides','apob','lpA',
  'alt','ast','ggt','total_bilirubin','albumin',
  'creatinine','egfr','bun','uric_acid',
  'ferritin','vitamin_d','b12','folate','magnesium','zinc','iron',
  'hscrp','homocysteine'
];

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

CRITICAL DECIMAL PARSING RULES:
- Parse decimal points EXACTLY as they appear (e.g., "2.1" = 2.1, NOT 21 or 210)
- "0.9" = 0.9, NOT 9 or 90
- If you see "TSH 2.1", the value is 2.1
- If you see "Progesterone 0.9", the value is 0.9

SUPPORTED BIOMARKER NAME MAPPING (use these EXACT canonical names):
Hormones:
- "Estradiol", "E2", "Estrogen" → "estradiol"
- "Progesterone" → "progesterone"
- "LH", "Luteinizing Hormone" → "lh"
- "FSH", "Follicle Stimulating Hormone" → "fsh"
- "AMH", "Anti-Mullerian Hormone" → "amh"
- "Testosterone Total", "Total Testosterone" → "testosterone_total"
- "Testosterone Free", "Free Testosterone" → "testosterone_free"
- "DHEA-S", "DHEA Sulfate" → "dhea_s"
- "Cortisol", "AM Cortisol" → "cortisol"
- "Prolactin" → "prolactin"
- "Insulin", "Fasting Insulin" → "insulin"
- "SHBG", "Sex Hormone Binding Globulin" → "shbg"

Thyroid:
- "TSH", "Thyroid Stimulating Hormone" → "tsh"
- "Free T4", "FT4", "Free Thyroxine" → "free_t4"
- "Free T3", "FT3", "Free Triiodothyronine" → "free_t3"
- "Reverse T3", "RT3" → "reverse_t3"
- "TPO Antibodies", "Thyroid Peroxidase Antibodies", "Anti-TPO" → "tpo_antibodies"
- "Thyroglobulin Antibodies", "TgAb" → "tgab"

Metabolic:
- "Glucose", "Fasting Glucose", "Blood Glucose" → "glucose_fasting"
- "HbA1c", "A1C", "Hemoglobin A1c" → "hba1c"

Lipids:
- "Total Cholesterol", "Cholesterol" → "total_cholesterol"
- "LDL", "LDL Cholesterol" → "ldl"
- "HDL", "HDL Cholesterol" → "hdl"
- "Triglycerides" → "triglycerides"
- "ApoB", "Apolipoprotein B" → "apob"
- "Lp(a)", "Lipoprotein(a)" → "lpA"

Liver:
- "ALT", "Alanine Aminotransferase", "SGPT" → "alt"
- "AST", "Aspartate Aminotransferase", "SGOT" → "ast"
- "GGT", "Gamma-Glutamyl Transferase" → "ggt"
- "Total Bilirubin", "Bilirubin Total" → "total_bilirubin"
- "Albumin" → "albumin"

Kidney:
- "Creatinine", "Serum Creatinine" → "creatinine"
- "eGFR", "Estimated GFR" → "egfr"
- "BUN", "Blood Urea Nitrogen" → "bun"
- "Uric Acid" → "uric_acid"

Nutrients:
- "Ferritin", "Serum Ferritin" → "ferritin"
- "Vitamin D", "25-OH Vitamin D", "25(OH)D" → "vitamin_d"
- "Vitamin B12", "B12", "Cobalamin" → "b12"
- "Folate", "Folic Acid", "RBC Folate" → "folate"
- "Magnesium", "RBC Magnesium" → "magnesium"
- "Zinc" → "zinc"
- "Iron", "Serum Iron" → "iron"

Inflammation:
- "hs-CRP", "High Sensitivity CRP", "hsCRP" → "hscrp"
- "Homocysteine" → "homocysteine"

ONLY extract biomarkers from the above list. Ignore anything not in this list.

VALUE EXTRACTION RULES:
- Extract ONLY the numeric value (e.g., from "240 pg/mL" extract 240)
- value field must be a NUMBER, not a string
- Never include units in the value field
- Extract decimals precisely as shown

UNIT EXTRACTION RULES:
- Extract the unit exactly as shown in the report

REFERENCE RANGE EXTRACTION:
- Look for patterns like "30–400", "0.4–4.0", "15-150"
- reference_min and reference_max should be numbers
- If no reference range is found, use null for both

CONFIDENCE LEVELS:
- high: Clear value, unit, and reference range all extracted
- medium: Value and unit extracted, but no reference range
- low: Value extracted but unit is unclear or ambiguous

Return ONLY a JSON array of extracted biomarkers. Return empty array [] if none found.`;

    const userPrompt = `Extract all biomarker data from this lab report text:\n\n${text}\n\nRemember: Parse decimals EXACTLY as shown, use canonical biomarker names, return values as numbers.`;

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
        max_tokens: 2500,
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

    const validatedBiomarkers = applySanityChecks(biomarkers.filter(b => SUPPORTED_BIOMARKERS.includes(b.name)));

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
    if (marker.name === 'vitamin_d' && marker.value > 500) marker.confidence = 'low';
    if (marker.name === 'free_t4' && marker.value > 10) marker.confidence = 'low';
    if (marker.name === 'glucose_fasting' && marker.value > 600) marker.confidence = 'low';
    if (marker.name === 'total_cholesterol' && marker.value > 1000) marker.confidence = 'low';
    if (marker.name === 'hba1c' && marker.value > 20) marker.confidence = 'low';
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
