import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ExtractedBiomarker {
  name: 'estradiol' | 'progesterone' | 'lh' | 'fsh' | 'amh' | 'tsh' | 'free_t4' | 'ferritin' | 'vitamin_d';
  value: number;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  confidence: 'high' | 'medium' | 'low';
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
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
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const { text } = body;

    if (!text || typeof text !== 'string') {
      return new Response(
        JSON.stringify({ error: "text parameter is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const systemPrompt = `You are a medical lab data extraction specialist. Your task is to extract biomarker data from lab reports with EXTREME precision.

CRITICAL DECIMAL PARSING RULES:
- Parse decimal points EXACTLY as they appear (e.g., "2.1" = 2.1, NOT 21 or 210)
- "0.9" = 0.9, NOT 9 or 90
- "1.2" = 1.2, NOT 12 or 120
- "24" = 24, NOT 2.4 or 240
- If you see "TSH 2.1", the value is 2.1
- If you see "Progesterone 0.9", the value is 0.9

BIOMARKER NAME MAPPING (use these EXACT canonical names):
- "Estradiol", "E2", "Estrogen" → "estradiol"
- "Progesterone", "Prog" → "progesterone"
- "LH", "Luteinizing Hormone" → "lh"
- "FSH", "Follicle Stimulating Hormone" → "fsh"
- "AMH", "Anti-Mullerian Hormone" → "amh"
- "TSH", "Thyroid Stimulating Hormone" → "tsh"
- "Free T4", "Free Thyroxine", "FT4" → "free_t4"
- "Ferritin", "Serum Ferritin" → "ferritin"
- "Vitamin D", "25-OH Vitamin D", "25(OH)D" → "vitamin_d"

VALUE EXTRACTION RULES:
- Extract ONLY the numeric value (e.g., from "240 pg/mL" extract 240)
- value field must be a NUMBER, not a string
- Never include units in the value field
- Extract decimals precisely as shown

UNIT EXTRACTION RULES:
- Extract the unit exactly as shown (e.g., "pg/mL", "ng/mL", "μIU/mL")
- Common units: pg/mL, ng/mL, ng/dL, μIU/mL, mIU/mL, IU/L

REFERENCE RANGE EXTRACTION:
- Look for patterns like "30–400", "0.4–4.0", "15-150"
- reference_min and reference_max should be numbers
- If no reference range is found, use null for both

CONFIDENCE LEVELS:
- high: Clear value, unit, and reference range all extracted
- medium: Value and unit extracted, but no reference range
- low: Value extracted but unit is unclear or ambiguous

SANITY CHECKS (flag as low confidence if):
- TSH > 50 (extremely unlikely unless severe thyroid disorder)
- Estradiol > 5000 (implausible)
- Progesterone > 100 (implausible)
- Any value that seems like a decimal parsing error

Return ONLY a JSON array of extracted biomarkers. Example:
[
  {
    "name": "estradiol",
    "value": 240,
    "unit": "pg/mL",
    "reference_min": 30,
    "reference_max": 400,
    "confidence": "high"
  },
  {
    "name": "tsh",
    "value": 2.1,
    "unit": "μIU/mL",
    "reference_min": 0.4,
    "reference_max": 4.0,
    "confidence": "high"
  }
]

If no biomarkers can be extracted, return an empty array: []`;

    const userPrompt = `Extract all biomarker data from this lab report text:

${text}

Remember:
- Parse decimals EXACTLY as shown
- Use canonical biomarker names
- Extract values as numbers (not strings)
- Flag any suspicious values as low confidence`;

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
        max_tokens: 1200,
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
        console.error("Unexpected JSON structure:", parsedJson);
        biomarkers = [];
      }
    } catch (parseError) {
      console.error("Failed to parse JSON response:", content);
      biomarkers = [];
    }

    const validatedBiomarkers = applySanityChecks(biomarkers);

    await supabaseAdmin.from("audit_events").insert({
      user_id: user.id,
      event_type: "lab_uploaded",
      metadata: { biomarker_count: validatedBiomarkers.length },
    }).then(() => {});

    return new Response(
      JSON.stringify({ biomarkers: validatedBiomarkers }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
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
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error occurred",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
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
    if (existing.count >= limitPerDay) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }
    await supabase
      .from("rate_limits")
      .update({ count: existing.count + 1 })
      .eq("id", existing.id);
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

    if (marker.name === 'tsh' && marker.value > 50) {
      marker.confidence = 'low';
    }

    if (marker.name === 'estradiol' && marker.value > 5000) {
      marker.confidence = 'low';
    }

    if (marker.name === 'progesterone' && marker.value > 100) {
      marker.confidence = 'low';
    }

    if (marker.name === 'ferritin' && marker.value > 10000) {
      marker.confidence = 'low';
    }

    if (marker.name === 'vitamin_d' && marker.value > 500) {
      marker.confidence = 'low';
    }

    if (marker.name === 'free_t4' && marker.value > 10) {
      marker.confidence = 'low';
    }

    if (marker.value <= 0) {
      marker.confidence = 'low';
    }

    if (marker.reference_min !== null && marker.reference_max !== null) {
      if (marker.reference_min >= marker.reference_max) {
        marker.confidence = 'low';
      }
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
          const markerRange = `${b.reference_min}-${b.reference_max}`;
          if (markerRange === range) {
            b.confidence = 'low';
          }
        }
      });
    }
  });

  return validated;
}
