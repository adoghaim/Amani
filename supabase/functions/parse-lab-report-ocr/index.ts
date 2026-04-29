import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export interface CanonicalAnalyte {
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

export interface ReportAnalyte {
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
  value_numeric?: number | null;
  value_text?: string | null;
  unit?: string | null;
  raw_reference_range?: string | null;
  normalized_reference_min?: number | null;
  normalized_reference_max?: number | null;
  reference_operator?: string | null;
  reference_operator_value?: number | null;
  source_snippet?: string | null;
  confidence_score?: "high" | "medium" | "low";
};

type OpenAIMessageContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

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
  const stripped = upper.replace(/[,\s]+(SERUM|PLASMA|WHOLE BLOOD|BLOOD|URINE|DIRECT|CALC|CALCULATED)$/i, '').trim();
  if (stripped !== upper) candidates.add(stripped);
  const noParens = upper.replace(/\s*\([^)]*\)/g, '').trim();
  if (noParens !== upper) candidates.add(noParens);
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
  }

  return { analyte: null, matchedVia: "none" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    console.log("DEPLOYMENT VERIFIED: parse-lab-report-ocr v2.1 (explicit auth). Auth Header Present:", !!req.headers.get("Authorization"));
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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { base64Images } = body; // Array of base64 strings with data URLs 'data:image/jpeg;base64,...'

    if (!base64Images || !Array.isArray(base64Images) || base64Images.length === 0) {
      return new Response(
        JSON.stringify({ error: "base64Images array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { analyteMap, synonymMap } = await loadCanonicalRegistry(supabaseAdmin);

    const systemPrompt = `You are a medical lab data extraction specialist. Extract EVERY lab test result from the provided lab report images.
You must return a STRICT JSON object with the following schema:
{ "items": [
  {
    "raw_name": "Test name exactly as it appears",
    "canonical_slug": "closest matching slug if known, else null",
    "value_numeric": 12.3,
    "value_text": "12.3 or <0.5",
    "unit": "mg/dL",
    "raw_reference_range": "10-20",
    "normalized_reference_min": 10,
    "normalized_reference_max": 20,
    "reference_operator": null,
    "reference_operator_value": null,
    "confidence_score": "high",
    "source_snippet": "the exact string of text surrounding this row on the page for UI context"
  }
] }

CRITICAL RULES:
1. Extract ALL tests on the report.
2. For "<0.5" set value_numeric = 0.25, value_text = "<0.5", reference_operator = "<", reference_operator_value = 0.5.
3. value_numeric MUST be a number.
4. If image is blurry or hard to read, mark "confidence_score": "low".
5. ALWAYS extract the 'source_snippet' which incorporates the text crop so the user can verify the OCR in our UI.`;

    const userMessagesContent: OpenAIMessageContent[] = [
      { type: "text", text: "Extract all lab test results from these images into the requested JSON format." }
    ];

    for (const b64 of base64Images) {
      userMessagesContent.push({
        type: "image_url",
        image_url: { url: b64 }
      });
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o", // Strongest model for OCR validation
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessagesContent }
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

    let rawItems: RawExtractedItem[];
    try {
      const parsedJson = JSON.parse(content) as unknown;
      if (
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
          item.value_numeric = op.startsWith('<') ? threshold / 2 : threshold;
        }
      }
    }

    const reportAnalytes: ReportAnalyte[] = rawItems
      .filter(item => typeof item.value_numeric === 'number' && !isNaN(item.value_numeric))
      .map(item => {
        const rawName = item.raw_name ?? item.name ?? 'Unknown';
        const gptSlug = item.canonical_slug ?? null;

        const { analyte, matchedVia } = resolveCanonicalByLabel(rawName, gptSlug, analyteMap, synonymMap);

        const canonicalSlug = analyte?.slug ?? null;
        const isCore = canonicalSlug ? CORE_BIOMARKER_SLUGS.has(canonicalSlug) : false;
        const category = canonicalSlug ? (CORE_BIOMARKER_CATEGORIES[canonicalSlug] ?? analyte?.category ?? null) : null;

        let parseStatus: "mapped" | "partial" | "unmapped" = "unmapped";
        if (analyte) parseStatus = matchedVia === "synonym" ? "mapped" : "partial";

        const needsReview = item.confidence_score === 'low' || !item.unit || parseStatus === 'unmapped';

        return {
          raw_name: rawName,
          raw_value_text: item.value_text ?? null,
          value_numeric: item.value_numeric,
          unit: item.unit ?? null,
          raw_reference_range: item.raw_reference_range ?? null,
          normalized_min: item.normalized_reference_min ?? null,
          normalized_max: item.normalized_reference_max ?? null,
          normalized_operator: item.reference_operator ?? null,
          normalized_operator_value: item.reference_operator_value ?? null,
          source_snippet: item.source_snippet ?? null,
          confidence_score: item.confidence_score ?? 'low',
          canonical_analyte_id: analyte?.id ?? null,
          canonical_slug: canonicalSlug,
          parse_status: parseStatus,
          needs_review: needsReview,
          is_core: isCore,
          category,
        } as ReportAnalyte;
      });

    return new Response(
      JSON.stringify({ items: reportAnalytes, _source_format: 'ocr', _parser_version: 'v2_vision_fallback' }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in OCR fallback:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
