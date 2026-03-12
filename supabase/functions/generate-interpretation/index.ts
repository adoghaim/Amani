import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BiomarkerData {
  name: string;
  value: number;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
}

interface ReportItemData {
  id: string;
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
  confidence_score: string;
  needs_review: boolean;
  is_core_biomarker: boolean;
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

async function processInterpretation(
  supabase: any,
  openaiApiKey: string | undefined,
  reportId: string,
  userId: string
): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    const { data: report, error: reportError } = await supabase
      .from("lab_reports")
      .select("*")
      .eq("id", reportId)
      .eq("user_id", userId)
      .maybeSingle();

    if (reportError || !report) {
      throw new Error("Report not found");
    }

    const [{ data: biomarkers }, { data: reportItems }] = await Promise.all([
      supabase.from("biomarkers").select("*").eq("lab_report_id", reportId),
      supabase.from("report_items").select("*").eq("lab_report_id", reportId).order("raw_name"),
    ]);

    const biomarkersList = (biomarkers ?? []) as BiomarkerData[];
    const reportItemsList = (reportItems ?? []) as ReportItemData[];
    const labReport = report as LabReportData;

    console.log(`[generate-interpretation] report_id=${reportId} biomarkers=${biomarkersList.length} report_items=${reportItemsList.length} openai=${openaiApiKey ? "yes" : "no"}`);

    let interpretationJson;
    let interpretationSource = "demo";

    if (openaiApiKey) {
      try {
        const prompt = generatePrompt(labReport, biomarkersList, reportItemsList);
        interpretationJson = await callOpenAIWithRetry(openaiApiKey, prompt, labReport, biomarkersList, reportItemsList);
        interpretationSource = "ai";
        console.log("[generate-interpretation] AI mode succeeded");
      } catch (openaiError) {
        console.error("[generate-interpretation] OpenAI failed, falling back to demo:", openaiError);
        interpretationJson = generateDemoInterpretation(labReport, biomarkersList, reportItemsList);
        interpretationSource = "demo";
      }
    } else {
      console.log("[generate-interpretation] No OpenAI key — using deterministic fallback");
      interpretationJson = generateDemoInterpretation(labReport, biomarkersList, reportItemsList);
      interpretationSource = "demo";
    }

    console.log("[generate-interpretation] Attempting upsert for report:", reportId);
    const { error: upsertError } = await supabase
      .from("interpretations")
      .upsert({
        lab_report_id: reportId,
        json_output: interpretationJson,
        interpretation_source: interpretationSource,
        generated_at: new Date().toISOString(),
        disclaimer_version: "1.0",
      }, { onConflict: "lab_report_id" });

    if (upsertError) {
      console.error("[generate-interpretation] Upsert error:", JSON.stringify(upsertError));
      throw new Error(`Failed to save interpretation: ${upsertError.message}`);
    }

    console.log("[generate-interpretation] Upsert succeeded, updating status to ready");
    const { error: statusError } = await supabase.from("lab_reports").update({ status: "ready" }).eq("id", reportId);
    if (statusError) console.error("[generate-interpretation] Status update error:", JSON.stringify(statusError));

    await supabase.from("audit_events").insert({
      user_id: userId,
      event_type: "insights_generated",
      metadata: { report_id: reportId, source: interpretationSource },
    }).catch((auditErr: any) => console.error("[generate-interpretation] Audit insert error:", auditErr?.message));
  } catch (err: any) {
    console.error("[generate-interpretation] Background processing error:", err?.message ?? err);
    await supabase.from("lab_reports").update({ status: "error" }).eq("id", reportId).catch(() => {});
  }
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user: authUser }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !authUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    await checkAndIncrementRateLimit(supabase, authUser.id, "generate-interpretation", 20);

    const body = await req.json();
    const reportId: string = body.reportId;

    if (!reportId) {
      return new Response(
        JSON.stringify({ error: "reportId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    EdgeRuntime.waitUntil(processInterpretation(supabase, openaiApiKey, reportId, authUser.id));

    return new Response(
      JSON.stringify({ queued: true }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[generate-interpretation] Fatal error:", error?.message ?? error);

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
    if (existing.count >= limitPerDay) {
      throw new Error("RATE_LIMIT_EXCEEDED");
    }
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

function validateNutrientContent(jsonOutput: any): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const allowedNutrients = ["vitamin_d", "iron", "b12", "folate", "magnesium", "omega_3", "iodine"];
  const bannedDosageUnits = [/\bIU\b/gi, /\bmg\b/gi, /\bmcg\b/gi, /\b\d+\s*g\b/gi, /\bmL\b/gi];
  const bannedDirectiveVerbs = [/\btake\b/gi, /\bstart\b/gi, /\bincrease\b/gi, /\bdecrease\b/gi, /\brecommended\b/gi, /\bprescribe\b/gi];
  const bannedFrequencyWords = [/\bdaily\b/gi, /\btwice\b/gi, /\bper day\b/gi, /\bevery day\b/gi];

  const jsonString = JSON.stringify(jsonOutput);
  bannedDosageUnits.forEach(p => { const m = jsonString.match(p); if (m) violations.push(`Contains banned dosage unit: ${m.join(", ")}`); });
  bannedDirectiveVerbs.forEach(p => { const m = jsonString.match(p); if (m) violations.push(`Contains banned directive verb: ${m.join(", ")}`); });
  bannedFrequencyWords.forEach(p => { const m = jsonString.match(p); if (m) violations.push(`Contains banned frequency word: ${m.join(", ")}`); });

  if (jsonOutput.nutrient_topics_to_discuss && Array.isArray(jsonOutput.nutrient_topics_to_discuss)) {
    jsonOutput.nutrient_topics_to_discuss.forEach((item: any, index: number) => {
      if (item.nutrient && !allowedNutrients.includes(item.nutrient)) {
        violations.push(`Nutrient at index ${index} not in allow-list: ${item.nutrient}`);
      }
    });
  }

  return { valid: violations.length === 0, violations };
}

function sanitizeNutrientSection(jsonOutput: any): any {
  const sanitized = { ...jsonOutput };
  if (!jsonOutput.nutrient_topics_to_discuss || !Array.isArray(jsonOutput.nutrient_topics_to_discuss)) {
    return sanitized;
  }

  const safeFallback = "Some clinicians may discuss options. Ask your provider what's appropriate for you.";
  const allowedNutrients = ["vitamin_d", "iron", "b12", "folate", "magnesium", "omega_3", "iodine"];
  const bannedPatterns = [/\bIU\b/gi, /\bmg\b/gi, /\bmcg\b/gi, /\b\d+\s*g\b/gi, /\bmL\b/gi, /\btake\b/gi, /\bstart\b/gi, /\bincrease\b/gi, /\bdecrease\b/gi, /\brecommended\b/gi, /\bprescribe\b/gi, /\bdaily\b/gi, /\btwice\b/gi, /\bper day\b/gi, /\bevery day\b/gi];

  sanitized.nutrient_topics_to_discuss = jsonOutput.nutrient_topics_to_discuss
    .filter((item: any) => {
      if (item.nutrient && !allowedNutrients.includes(item.nutrient)) return false;
      return true;
    })
    .map((item: any) => {
      const itemString = JSON.stringify(item);
      const hasBanned = bannedPatterns.some(p => p.test(itemString));
      return hasBanned ? { ...item, discussion_prompt: safeFallback } : item;
    });

  return sanitized;
}

async function callOpenAIWithRetry(
  apiKey: string,
  prompt: string,
  report: LabReportData,
  biomarkers: BiomarkerData[],
  reportItems: ReportItemData[],
  maxOutputTokens = 4000,
  attemptNumber = 1
): Promise<any> {
  const systemPrompt = `You are Amani, a women's health AI assistant. You provide clear, educational interpretations of lab results with cycle awareness. You NEVER diagnose, alarm, or replace medical advice.

CRITICAL LANGUAGE RULES - NEVER USE THESE WORDS:
- FORBIDDEN: "healthy", "normal", "indicates", "confirms", "shows that", "proves", "diagnoses", "recovery"
- FORBIDDEN: "concerning", "worrying", "abnormal", "problematic"
- REQUIRED: "may", "can", "could", "often", "commonly", "sometimes", "consistent with", "suggests"
- For out-of-range values: "outside typical range" or "may benefit from discussion with your provider"

CRITICAL CONTEXT GATING RULES:
- ONLY mention postpartum if postpartum = "yes"
- ONLY mention pregnancy if pregnant = "yes"

CRITICAL NUTRIENT & SUPPLEMENT RULES:
- ONLY include nutrients if DIRECTLY tied to a specific lab value or reported symptom
- NEVER recommend, prescribe, or suggest taking anything
- NEVER include dosages, frequencies, timing, or brands (BANNED: IU, mg, mcg, daily, weekly, twice, etc.)
- ONLY use consultative phrasing: "Some clinicians may discuss...", "You may want to ask your provider about..."
- ALLOWED nutrients: vitamin_d, iron, b12, folate, magnesium, omega_3, iodine

REPORTING SCOPE:
- Use the full lab panel (report_items) to build a comprehensive narrative
- Summary bullets should reflect findings across ALL systems in the uploaded report
- The biomarkers JSON array should use canonical core biomarker names
- Reference extended items in summary, questions, and considerations where clinically relevant

DATA RULES:
- user_value must NEVER include units
- Units provided ONLY in the separate unit field

You must respond with ONLY a valid JSON object matching this exact structure:
{
  "summary_bullets": ["string", "string", "string"],
  "cycle_context": {
    "estimated_cycle_day": number | null,
    "estimated_cycle_phase": "menstrual" | "follicular" | "ovulatory" | "luteal" | "unknown",
    "confidence": "low" | "medium" | "high",
    "explanation": "string"
  },
  "biomarkers": [{
    "name": "string",
    "user_value": "string",
    "unit": "string",
    "reference_range": "string",
    "status_label": "in_range" | "borderline" | "out_of_range" | "unknown",
    "plain_english_meaning": "string",
    "timing_notes": "string",
    "common_non_alarm_reasons": ["string"],
    "when_clinicians_follow_up": ["string"]
  }],
  "nutrient_topics_to_discuss": [{
    "nutrient": "vitamin_d" | "iron" | "b12" | "folate" | "magnesium" | "omega_3" | "iodine",
    "why_it_came_up": "string",
    "discussion_prompt": "string"
  }],
  "supportive_considerations": {
    "nutrition": ["string"],
    "sleep_stress": ["string"],
    "lifestyle": ["string"]
  },
  "questions_for_doctor": ["string"],
  "suggested_followups_to_discuss": ["string"],
  "safety_notes": ["string"],
  "disclaimer": "string"
}`;

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        max_tokens: maxOutputTokens,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.text();
      console.error("[generate-interpretation] OpenAI API error:", errorData);
      throw new Error(`OpenAI API error: ${errorData}`);
    }

    const openaiData = await openaiResponse.json();
    const choice = openaiData.choices[0];
    const content = choice.message.content;
    const finishReason = choice.finish_reason;

    if (finishReason === "length") {
      console.warn("[generate-interpretation] Response truncated (finish_reason=length), retrying with higher token limit");
      if (attemptNumber === 1) {
        return await callOpenAIWithRetry(apiKey, prompt, report, biomarkers, reportItems, 6000, 2);
      }
      console.error("[generate-interpretation] Still truncated on retry — falling back to demo");
      throw new Error("OpenAI response truncated even with increased token limit");
    }

    try {
      const parsedJson = JSON.parse(content);
      const validation = validateNutrientContent(parsedJson);

      if (!validation.valid) {
        console.warn("[generate-interpretation] Nutrient validation failed:", validation.violations);
        if (attemptNumber === 1) {
          return await callOpenAIWithRetry(apiKey, prompt, report, biomarkers, reportItems, maxOutputTokens, 2);
        } else {
          return sanitizeNutrientSection(parsedJson);
        }
      }

      return parsedJson;
    } catch (parseError) {
      console.error("[generate-interpretation] Failed to parse JSON response from OpenAI");
      if (attemptNumber === 1) {
        return await callOpenAIWithRetry(apiKey, prompt, report, biomarkers, reportItems, maxOutputTokens, 2);
      }
      throw new Error("Invalid JSON response from OpenAI");
    }
  } catch (error: any) {
    if (error?.message?.startsWith("OpenAI API error") || error?.message?.startsWith("OpenAI response truncated") || error?.message?.startsWith("Invalid JSON")) {
      throw error;
    }
    if (attemptNumber === 1) {
      try {
        return await callOpenAIWithRetry(apiKey, prompt, report, biomarkers, reportItems, maxOutputTokens, 2);
      } catch (retryError) {
        console.error("[generate-interpretation] Retry also failed:", retryError);
        throw retryError;
      }
    }
    throw error;
  }
}

function generatePrompt(report: LabReportData, biomarkers: BiomarkerData[], reportItems: ReportItemData[]): string {
  const cycleInfo = report.estimated_cycle_day && report.estimated_cycle_phase
    ? `Cycle Day ${report.estimated_cycle_day}, ${report.estimated_cycle_phase} phase`
    : "Cycle information not provided";

  const contextInfo = [];
  if (report.context.birth_control === "yes") contextInfo.push("User is currently using birth control");
  if (report.context.pregnant === "yes") contextInfo.push("User is currently pregnant");
  if (report.context.postpartum === "yes") contextInfo.push("User is postpartum");
  if (report.context.top_symptoms && report.context.top_symptoms.length > 0) {
    contextInfo.push(`Reported symptoms: ${report.context.top_symptoms.join(", ")}`);
  }

  const coreBiomarkersText = biomarkers.length > 0
    ? biomarkers.map((b) => {
        let text = `${b.name}: ${b.value} ${b.unit}`;
        if (b.reference_min !== null && b.reference_max !== null) {
          text += ` (ref: ${b.reference_min}–${b.reference_max})`;
        }
        return text;
      }).join("\n")
    : "No core biomarkers mapped";

  const extendedItems = reportItems.filter(i => !i.is_core_biomarker);
  const extendedText = extendedItems.length > 0
    ? extendedItems.slice(0, 60).map((item) => {
        let text = `${item.raw_name}: ${item.value_text ?? item.value_numeric}${item.unit ? " " + item.unit : ""}`;
        if (item.raw_reference_range) text += ` (ref: ${item.raw_reference_range})`;
        else if (item.normalized_reference_min !== null && item.normalized_reference_max !== null) {
          text += ` (ref: ${item.normalized_reference_min}–${item.normalized_reference_max})`;
        }
        if (item.needs_review) text += " [flagged for review]";
        return text;
      }).join("\n")
    : "No additional lab items";

  return `Please provide a clear, educational interpretation of these lab results:

Report Date: ${report.report_date}
${cycleInfo}
${contextInfo.length > 0 ? `Context: ${contextInfo.join(", ")}` : ""}

CORE BIOMARKERS (use these for the structured biomarkers JSON array):
${coreBiomarkersText}

FULL LAB PANEL (use these for summary bullets, narrative, questions, and lifestyle considerations):
${extendedText}

Instructions:
- Use the full lab panel to tell the complete story of this report
- Reference specific items by name in summary bullets where meaningful
- Focus the biomarkers JSON array on the canonical core biomarker names above
- Include practical, specific questions for the doctor
- This is educational information, not medical advice`;
}

function classifyItem(item: ReportItemData): "in_range" | "out_of_range" | "borderline" | "unknown" {
  const v = item.value_numeric;
  if (item.normalized_reference_min !== null && item.normalized_reference_max !== null) {
    const range = item.normalized_reference_max - item.normalized_reference_min;
    const buf = range * 0.08;
    if (v < item.normalized_reference_min - buf || v > item.normalized_reference_max + buf) return "out_of_range";
    if (v < item.normalized_reference_min || v > item.normalized_reference_max) return "borderline";
    return "in_range";
  }
  if (item.reference_operator && item.reference_operator_value !== null) {
    const val = item.reference_operator_value;
    const op = item.reference_operator;
    if (op === "<" || op === "<=" || op === "< OR =") return v <= val ? "in_range" : "out_of_range";
    if (op === ">" || op === ">=" || op === "> OR =") return v >= val ? "in_range" : "out_of_range";
  }
  return "unknown";
}

const NUTRIENT_SLUG_MAP: Record<string, string> = {
  ferritin: "iron",
  iron: "iron",
  "vitamin_d": "vitamin_d",
  "vitamin d": "vitamin_d",
  "vit d": "vitamin_d",
  "25-oh": "vitamin_d",
  "vitamin_b12": "b12",
  "vitamin b12": "b12",
  "b12": "b12",
  cobalamin: "b12",
  folate: "folate",
  "folic acid": "folate",
  magnesium: "magnesium",
  "omega-3": "omega_3",
  omega_3: "omega_3",
  iodine: "iodine",
};

function generateDemoInterpretation(report: LabReportData, biomarkers: BiomarkerData[], reportItems: ReportItemData[]) {
  const cyclePhase = report.estimated_cycle_phase || "unknown";
  const cycleDay = report.estimated_cycle_day;
  const symptoms = report.context.top_symptoms ?? [];

  const outOfRange = reportItems.filter(i => classifyItem(i) === "out_of_range");
  const borderline = reportItems.filter(i => classifyItem(i) === "borderline");

  const categoryCounts: Record<string, { total: number; flagged: number; items: ReportItemData[] }> = {};
  for (const item of reportItems) {
    const cat = item.category ?? "other";
    if (!categoryCounts[cat]) categoryCounts[cat] = { total: 0, flagged: 0, items: [] };
    categoryCounts[cat].total++;
    const status = classifyItem(item);
    if (status === "out_of_range" || status === "borderline") {
      categoryCounts[cat].flagged++;
      categoryCounts[cat].items.push(item);
    }
  }

  const topFindings = [...outOfRange, ...borderline].slice(0, 5);
  const summaryBullets: string[] = [];

  if (reportItems.length > 0) {
    const totalFlagged = outOfRange.length + borderline.length;
    if (totalFlagged === 0) {
      summaryBullets.push(`Your ${reportItems.length}-item panel shows values largely within typical reference ranges across all systems tested.`);
    } else {
      summaryBullets.push(`Your ${reportItems.length}-item panel includes ${outOfRange.length} value${outOfRange.length !== 1 ? "s" : ""} outside typical ranges and ${borderline.length} borderline result${borderline.length !== 1 ? "s" : ""} — see below for a breakdown by system.`);
    }
  } else if (biomarkers.length > 0) {
    summaryBullets.push(`Your panel includes ${biomarkers.length} biomarker${biomarkers.length !== 1 ? "s" : ""} across key systems.`);
  } else {
    summaryBullets.push("Your lab report has been saved. Add your results manually if automatic extraction did not capture them.");
  }

  if (cycleDay && cyclePhase !== "unknown") {
    summaryBullets.push(`Results collected on cycle day ${cycleDay} (${cyclePhase} phase) — hormone values are expected to vary naturally at this stage of your cycle.`);
  } else {
    summaryBullets.push("Providing your last period start date at upload helps contextualize hormone results, especially estradiol, progesterone, LH, and FSH.");
  }

  if (topFindings.length > 0) {
    const names = topFindings.slice(0, 3).map(i => i.raw_name).join(", ");
    const more = topFindings.length > 3 ? ` and ${topFindings.length - 3} more` : "";
    summaryBullets.push(`Values worth discussing with your provider: ${names}${more}.`);
  } else {
    summaryBullets.push("No values stood out as significantly outside reference ranges — this serves as a useful baseline for tracking trends over time.");
  }

  const biomarkerInterpretations = biomarkers.map((b) => {
    let status: "in_range" | "borderline" | "out_of_range" | "unknown" = "unknown";
    let meaning = `${b.name} plays a role in regulating your menstrual cycle and overall hormonal health.`;
    const timingNotes = cyclePhase !== "unknown"
      ? `In the ${cyclePhase} phase (around day ${cycleDay ?? "?"}), this value is expected to ${cyclePhase === "luteal" ? "be elevated relative to follicular phase" : cyclePhase === "ovulatory" ? "peak briefly around ovulation" : "be near its baseline range"}.`
      : "Hormone levels vary significantly throughout the cycle — cycle day context helps with interpretation.";

    if (b.reference_min !== null && b.reference_max !== null) {
      const range = b.reference_max - b.reference_min;
      const buf = range * 0.08;
      if (b.value >= b.reference_min && b.value <= b.reference_max) {
        status = "in_range";
        meaning = `Your ${b.name} level is often consistent with the reference range for this test.`;
      } else if (b.value < b.reference_min - buf || b.value > b.reference_max + buf) {
        status = "out_of_range";
        meaning = `Your ${b.name} is outside the typical reference range — this may benefit from discussion with your provider, especially in the context of your symptoms.`;
      } else {
        status = "borderline";
        meaning = `Your ${b.name} is slightly outside the typical reference range but may align with individual variation, particularly given cycle timing.`;
      }
    }

    return {
      name: b.name,
      user_value: b.value.toString(),
      unit: b.unit,
      reference_range: b.reference_min !== null && b.reference_max !== null
        ? `${b.reference_min}–${b.reference_max}`
        : "Reference range not provided",
      status_label: status,
      plain_english_meaning: meaning,
      timing_notes: timingNotes,
      common_non_alarm_reasons: [
        "Natural variation within your cycle",
        "Time of day the sample was collected",
        "Recent stress, sleep changes, or intense exercise",
      ],
      when_clinicians_follow_up: [
        "If levels are persistently outside range on repeat testing",
        "If you have symptoms that significantly affect quality of life",
      ],
    };
  });

  const nutrientTopics: any[] = [];
  const seenNutrients = new Set<string>();

  for (const item of reportItems) {
    if (nutrientTopics.length >= 2) break;
    const status = classifyItem(item);
    if (status !== "out_of_range" && status !== "borderline") continue;

    const nameLower = (item.canonical_slug ?? item.raw_name).toLowerCase();
    let nutrient: string | null = null;
    for (const [key, val] of Object.entries(NUTRIENT_SLUG_MAP)) {
      if (nameLower.includes(key)) { nutrient = val; break; }
    }

    if (nutrient && !seenNutrients.has(nutrient)) {
      seenNutrients.add(nutrient);
      nutrientTopics.push({
        nutrient,
        why_it_came_up: `${item.raw_name} was ${status === "out_of_range" ? "outside" : "near the edge of"} the reference range on your panel.`,
        discussion_prompt: `Some clinicians may discuss whether your ${nutrient.replace(/_/g, " ")} level warrants further evaluation — you may want to ask your provider what's appropriate given your full history.`,
      });
    }
  }

  if (nutrientTopics.length === 0 && symptoms.some(s => ["fatigue", "hair_loss", "mood_changes"].includes(s))) {
    nutrientTopics.push({
      nutrient: "iron",
      why_it_came_up: "Fatigue, hair loss, or mood changes are sometimes associated with iron or ferritin levels, especially in people who menstruate.",
      discussion_prompt: "You may want to ask your provider whether checking ferritin and iron stores would be useful given your reported symptoms.",
    });
  }

  const systemsWithFindings = new Set(
    Object.entries(categoryCounts).filter(([, v]) => v.flagged > 0).map(([cat]) => cat)
  );

  const nutritionRecs: string[] = [];
  const sleepStressRecs: string[] = [];
  const lifestyleRecs: string[] = [];

  if (systemsWithFindings.has("metabolic")) {
    nutritionRecs.push("A diet lower in refined carbohydrates and higher in fiber may support blood sugar balance — worth discussing with your provider.");
  }
  if (systemsWithFindings.has("lipids")) {
    nutritionRecs.push("Foods rich in omega-3 fatty acids (like fatty fish, walnuts, and flaxseed) often come up in conversations about cardiovascular health.");
  }
  if (systemsWithFindings.has("thyroid") || symptoms.includes("fatigue")) {
    sleepStressRecs.push("Thyroid function can be sensitive to chronic stress and poor sleep — prioritizing consistent sleep timing may be beneficial.");
  }
  if (systemsWithFindings.has("liver")) {
    lifestyleRecs.push("Limiting alcohol and supporting liver health through a varied, nutrient-dense diet are often discussed in the context of liver markers.");
  }

  nutritionRecs.push("Balanced meals with adequate protein, healthy fats, and complex carbohydrates support overall hormone production.");
  sleepStressRecs.push("Quality sleep of 7–9 hours supports hormonal rhythm and cortisol regulation.");
  lifestyleRecs.push("Tracking your cycle alongside symptoms between now and your next visit can give your provider valuable context.");
  lifestyleRecs.push("Regular moderate movement is commonly associated with improved hormonal and metabolic wellbeing.");

  const questions: string[] = [
    "What do these results mean in the context of my full health history and current symptoms?",
    "Are there any values you'd recommend retesting — and if so, at what point in my cycle?",
  ];
  if (topFindings.length > 0) {
    questions.push(`Can you help me understand the ${topFindings[0].raw_name} result and what it might mean for me?`);
  }
  if (systemsWithFindings.size > 0) {
    const sys = [...systemsWithFindings][0];
    questions.push(`Given the ${sys} results, are there any further tests or follow-ups you'd suggest?`);
  }
  questions.push("How does my cycle timing affect how we should interpret the hormone values in this panel?");

  return {
    summary_bullets: summaryBullets,
    cycle_context: {
      estimated_cycle_day: cycleDay,
      estimated_cycle_phase: cyclePhase,
      confidence: cycleDay ? "medium" : "low",
      explanation: cycleDay
        ? `Based on your cycle information, you may be in the ${cyclePhase} phase around day ${cycleDay}. Hormone levels can vary significantly across the cycle, which is important context for interpreting results — especially estradiol, progesterone, LH, and FSH.`
        : "Without cycle timing information, hormone level interpretation is limited. Consider noting your last period start date at your next upload.",
    },
    biomarkers: biomarkerInterpretations,
    nutrient_topics_to_discuss: nutrientTopics,
    supportive_considerations: {
      nutrition: nutritionRecs,
      sleep_stress: sleepStressRecs,
      lifestyle: lifestyleRecs,
    },
    questions_for_doctor: questions,
    suggested_followups_to_discuss: [
      "Retesting any borderline values at a different cycle phase for comparison",
      "Adding a ferritin or full iron panel if not already included, especially if fatigue is a concern",
      "Tracking symptoms between now and your next appointment to give your provider more context",
    ],
    safety_notes: [
      "Seek immediate care if you experience severe abdominal or pelvic pain that is sudden or worsening",
      "Contact your provider if you have unusually heavy bleeding (soaking through a pad within an hour for several hours)",
      "Seek care for sudden severe headaches, vision changes, or confusion",
      "Get urgent care if you develop a high fever (over 101°F / 38.3°C) with chills or signs of infection",
      "If any symptom feels dramatically different from your baseline, trust your instincts and seek care promptly",
    ],
    disclaimer: "This report is for educational purposes only and is not medical advice. Please consult your healthcare provider to discuss your results and any questions or concerns. Lab values should always be interpreted in the context of your complete health history, symptoms, and clinical examination.",
  };
}
