import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

function classifyAnalyte(a: AnalyteData): "in_range" | "out_of_range" | "borderline" | "unknown" {
  const v = a.value_numeric;
  if (a.normalized_min !== null && a.normalized_max !== null) {
    const buf = (a.normalized_max - a.normalized_min) * 0.08;
    if (v < a.normalized_min - buf || v > a.normalized_max + buf) return "out_of_range";
    if (v < a.normalized_min || v > a.normalized_max) return "borderline";
    return "in_range";
  }
  if (a.normalized_operator && a.normalized_operator_value !== null) {
    const val = a.normalized_operator_value;
    const op = a.normalized_operator;
    if (op === "<" || op === "<=" || op === "< OR =") return v <= val ? "in_range" : "out_of_range";
    if (op === ">" || op === ">=" || op === "> OR =") return v >= val ? "in_range" : "out_of_range";
  }
  return "unknown";
}

function buildPrompt(report: LabReportData, analytes: AnalyteData[]): string {
  const cycleInfo = report.estimated_cycle_day && report.estimated_cycle_phase
    ? `Cycle Day ${report.estimated_cycle_day}, ${report.estimated_cycle_phase} phase`
    : "Cycle information not provided";

  const ctx: string[] = [];
  if (report.context.birth_control === "yes") ctx.push("on birth control");
  if (report.context.pregnant === "yes") ctx.push("pregnant");
  if (report.context.postpartum === "yes") ctx.push("postpartum");
  if (report.context.top_symptoms?.length) ctx.push(`symptoms: ${report.context.top_symptoms.join(", ")}`);

  const KEY_SLUGS = new Set([
    "estradiol","progesterone","lh","fsh","tsh","free_t4","free_t3",
    "fasting_glucose","hemoglobin_a1c","total_cholesterol","ldl_cholesterol",
    "hdl_cholesterol","triglycerides","creatinine","egfr","alt","ast",
    "ferritin","vitamin_d_25_oh","vitamin_b12","hs_crp","tpo_antibodies",
    "hemoglobin","shbg","total_testosterone","dhea_s",
  ]);

  const outOfRange = analytes.filter(a => classifyAnalyte(a) === "out_of_range");
  const borderline = analytes.filter(a => classifyAnalyte(a) === "borderline");
  const keyOther = analytes.filter(a =>
    a.canonical_slug && KEY_SLUGS.has(a.canonical_slug) &&
    !outOfRange.includes(a) && !borderline.includes(a)
  );

  const selected = [...outOfRange, ...borderline, ...keyOther].slice(0, 15);

  const labLines = selected.map(a => {
    const val = a.raw_value_text ?? String(a.value_numeric);
    let line = `${a.raw_name}: ${val}${a.unit ? " " + a.unit : ""}`;
    if (a.raw_reference_range) line += ` (ref: ${a.raw_reference_range})`;
    else if (a.normalized_min !== null && a.normalized_max !== null) line += ` (ref: ${a.normalized_min}–${a.normalized_max})`;
    const status = classifyAnalyte(a);
    if (status === "out_of_range") line += " [OUT OF RANGE]";
    else if (status === "borderline") line += " [BORDERLINE]";
    return line;
  }).join("\n");

  return `Interpret these lab results for a women's health context.

Report date: ${report.report_date}
${cycleInfo}${ctx.length ? "\nContext: " + ctx.join(", ") : ""}
Total analytes in panel: ${analytes.length}

KEY LAB VALUES (${selected.length} selected — prioritized by clinical significance):
${labLines}

Provide educational interpretation. Reference specific biomarker names and values. Not medical advice.`;
}

function generateFallbackInterpretation(report: LabReportData, analytes: AnalyteData[]) {
  const cyclePhase = report.estimated_cycle_phase || "unknown";
  const cycleDay = report.estimated_cycle_day;
  const symptoms = report.context.top_symptoms ?? [];

  const outOfRange = analytes.filter(a => classifyAnalyte(a) === "out_of_range");
  const borderline = analytes.filter(a => classifyAnalyte(a) === "borderline");
  const topFindings = [...outOfRange, ...borderline].slice(0, 5);

  const summaryBullets: string[] = [];
  const totalFlagged = outOfRange.length + borderline.length;

  if (totalFlagged === 0) {
    summaryBullets.push(`Your ${analytes.length}-item panel shows values largely within typical reference ranges across all systems tested.`);
  } else {
    summaryBullets.push(`Your ${analytes.length}-item panel includes ${outOfRange.length} value${outOfRange.length !== 1 ? "s" : ""} outside typical ranges and ${borderline.length} borderline result${borderline.length !== 1 ? "s" : ""}.`);
  }

  if (cycleDay && cyclePhase !== "unknown") {
    summaryBullets.push(`Results collected on cycle day ${cycleDay} (${cyclePhase} phase) — hormone values naturally vary at each stage of your cycle.`);
  } else {
    summaryBullets.push("Providing your last period start date helps contextualize hormone results, especially estradiol, progesterone, LH, and FSH.");
  }

  if (topFindings.length > 0) {
    const names = topFindings.slice(0, 3).map(i => i.raw_name).join(", ");
    const more = topFindings.length > 3 ? ` and ${topFindings.length - 3} more` : "";
    summaryBullets.push(`Values worth discussing with your provider: ${names}${more}.`);
  } else {
    summaryBullets.push("No values stood out as significantly outside reference ranges — this serves as a useful baseline for tracking trends.");
  }

  const biomarkerInterpretations = analytes.filter(a => a.is_core).slice(0, 20).map(a => {
    const status = classifyAnalyte(a);
    const val = a.raw_value_text ?? String(a.value_numeric);
    let meaning = `${a.raw_name} plays a role in your overall health. Your result was ${val}${a.unit ? " " + a.unit : ""}.`;
    if (status === "out_of_range") meaning = `Your ${a.raw_name} (${val}${a.unit ? " " + a.unit : ""}) is outside the typical reference range — worth discussing with your provider.`;
    else if (status === "borderline") meaning = `Your ${a.raw_name} (${val}${a.unit ? " " + a.unit : ""}) is near the edge of the reference range — may be worth monitoring.`;
    else if (status === "in_range") meaning = `Your ${a.raw_name} (${val}${a.unit ? " " + a.unit : ""}) is within the typical reference range.`;

    let refRange = "Reference range not provided";
    if (a.raw_reference_range) refRange = a.raw_reference_range;
    else if (a.normalized_min !== null && a.normalized_max !== null) refRange = `${a.normalized_min}–${a.normalized_max}`;

    return {
      name: a.raw_name,
      user_value: val,
      unit: a.unit ?? "",
      reference_range: refRange,
      status_label: status,
      plain_english_meaning: meaning,
      timing_notes: cyclePhase !== "unknown"
        ? `In the ${cyclePhase} phase (around day ${cycleDay ?? "?"}), hormone values are expected to vary naturally.`
        : "Cycle day context helps with hormone interpretation.",
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
  const NUTRIENT_MAP: Record<string, string> = {
    ferritin: "iron", iron: "iron", vitamin_d: "vitamin_d", vitamin_b12: "b12",
    b12: "b12", folate: "folate", magnesium: "magnesium",
  };
  const seen = new Set<string>();
  for (const a of analytes) {
    if (nutrientTopics.length >= 2) break;
    const status = classifyAnalyte(a);
    if (status !== "out_of_range" && status !== "borderline") continue;
    const slug = (a.canonical_slug ?? a.raw_name).toLowerCase();
    const nutrient = Object.entries(NUTRIENT_MAP).find(([k]) => slug.includes(k))?.[1];
    if (nutrient && !seen.has(nutrient)) {
      seen.add(nutrient);
      nutrientTopics.push({
        nutrient,
        why_it_came_up: `${a.raw_name} was ${status === "out_of_range" ? "outside" : "near the edge of"} the reference range.`,
        discussion_prompt: `You may want to ask your provider whether your ${nutrient.replace(/_/g, " ")} level warrants further evaluation given your full history.`,
      });
    }
  }

  const questions: string[] = [
    "What do these results mean in the context of my full health history and current symptoms?",
    "Are there any values you'd recommend retesting — and if so, at what point in my cycle?",
  ];
  if (topFindings.length > 0) {
    questions.push(`Can you help me understand the ${topFindings[0].raw_name} result and what it might mean for me?`);
  }
  questions.push("How does my cycle timing affect how we should interpret the hormone values in this panel?");
  if (symptoms.length > 0) {
    questions.push(`Given my reported symptoms (${symptoms.slice(0, 3).join(", ")}), are there any additional tests you'd suggest?`);
  }

  return {
    summary_bullets: summaryBullets,
    cycle_context: {
      estimated_cycle_day: cycleDay,
      estimated_cycle_phase: cyclePhase,
      confidence: cycleDay ? "medium" : "low",
      explanation: cycleDay
        ? `Based on your cycle information, you may be in the ${cyclePhase} phase around day ${cycleDay}. Hormone levels can vary significantly across the cycle.`
        : "Without cycle timing information, hormone level interpretation is limited.",
    },
    biomarkers: biomarkerInterpretations,
    nutrient_topics_to_discuss: nutrientTopics,
    supportive_considerations: {
      nutrition: ["Balanced meals with adequate protein, healthy fats, and complex carbohydrates support overall hormone production."],
      sleep_stress: ["Quality sleep of 7–9 hours supports hormonal rhythm and cortisol regulation."],
      lifestyle: [
        "Tracking your cycle alongside symptoms between now and your next visit gives your provider valuable context.",
        "Regular moderate movement is commonly associated with improved hormonal and metabolic wellbeing.",
      ],
    },
    questions_for_doctor: questions,
    suggested_followups_to_discuss: [
      "Retesting any borderline values at a different cycle phase for comparison",
      "Tracking symptoms between now and your next appointment",
    ],
    safety_notes: [
      "Seek immediate care if you experience severe sudden abdominal or pelvic pain",
      "Contact your provider if you have unusually heavy bleeding (soaking through a pad within an hour for several hours)",
      "Get urgent care if you develop a high fever (over 101°F / 38.3°C) with signs of infection",
    ],
    disclaimer: "This report is for educational purposes only and is not medical advice. Please consult your healthcare provider to discuss your results in the context of your complete health history.",
  };
}

function sanitizeNutrients(json: any): any {
  const allowed = new Set(["vitamin_d","iron","b12","folate","magnesium","omega_3","iodine"]);
  const banned = [/\bIU\b/g,/\bmg\b/g,/\bmcg\b/g,/\b\d+\s*g\b/g,/\btake\b/gi,/\bstart\b/gi,/\bincrease\b/gi,/\bdecrease\b/gi,/\bdaily\b/gi,/\btwice\b/gi,/\bper day\b/gi];
  const fallback = "Some clinicians may discuss options. Ask your provider what's appropriate for you.";
  if (!Array.isArray(json.nutrient_topics_to_discuss)) return json;
  return {
    ...json,
    nutrient_topics_to_discuss: json.nutrient_topics_to_discuss
      .filter((i: any) => !i.nutrient || allowed.has(i.nutrient))
      .map((i: any) => {
        const str = JSON.stringify(i);
        return banned.some(p => p.test(str)) ? { ...i, discussion_prompt: fallback } : i;
      }),
  };
}

async function callOpenAI(apiKey: string, prompt: string): Promise<any> {
  const systemPrompt = `You are Amani, a women's health AI assistant. Provide clear, specific, educational lab interpretations with cycle awareness. NEVER diagnose or replace medical advice.

LANGUAGE: Avoid "healthy","normal","indicates","confirms","abnormal","concerning". Use "may","can","often","suggests","consistent with". Out-of-range: "outside typical reference range".
CONTEXT: Only mention postpartum if postpartum is in the context. Only mention pregnancy if pregnant is in the context.
NUTRIENTS: Only if tied to a specific lab value or symptom. No dosages/frequencies/brands. Consultative phrasing only. Allowed: vitamin_d, iron, b12, folate, magnesium, omega_3, iodine.
DATA: user_value must never include units. For comparators like "<0.5" use that exact string.

Respond with ONLY valid JSON:
{
  "summary_bullets": ["3-5 specific bullets referencing actual values"],
  "cycle_context": {"estimated_cycle_day": number|null, "estimated_cycle_phase": "menstrual"|"follicular"|"ovulatory"|"luteal"|"unknown", "confidence": "low"|"medium"|"high", "explanation": "string"},
  "biomarkers": [{"name":"string","user_value":"string","unit":"string","reference_range":"string","status_label":"in_range"|"borderline"|"out_of_range"|"unknown","plain_english_meaning":"string","timing_notes":"string","common_non_alarm_reasons":["string"],"when_clinicians_follow_up":["string"]}],
  "nutrient_topics_to_discuss": [{"nutrient":"vitamin_d"|"iron"|"b12"|"folate"|"magnesium"|"omega_3"|"iodine","why_it_came_up":"string","discussion_prompt":"string"}],
  "supportive_considerations": {"nutrition":["string"],"sleep_stress":["string"],"lifestyle":["string"]},
  "questions_for_doctor": ["3-5 specific questions referencing actual biomarker names"],
  "suggested_followups_to_discuss": ["string"],
  "safety_notes": ["string"],
  "disclaimer": "string"
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
        max_tokens: 1800,
        temperature: 0.6,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");

  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse OpenAI JSON response");
  }
}

async function checkRateLimit(supabase: any, userId: string): Promise<void> {
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("rate_limits")
    .select("id, count")
    .eq("user_id", userId)
    .eq("endpoint", "generate-interpretation")
    .gte("window_start", windowStart.toISOString())
    .maybeSingle();

  if (data) {
    if (data.count >= 20) throw new Error("RATE_LIMIT_EXCEEDED");
    await supabase.from("rate_limits").update({ count: data.count + 1 }).eq("id", data.id);
  } else {
    await supabase.from("rate_limits").insert({
      user_id: userId,
      endpoint: "generate-interpretation",
      window_start: windowStart.toISOString(),
      count: 1,
    });
  }
}

async function processInterpretation(
  supabase: any,
  openaiApiKey: string | undefined,
  reportId: string,
  userId: string
): Promise<void> {
  try {
    console.log("[generate-interpretation] Starting for", reportId);

    const { data: report, error: reportError } = await supabase
      .from("lab_reports")
      .select("id, report_date, estimated_cycle_day, estimated_cycle_phase, context, status")
      .eq("id", reportId)
      .maybeSingle();

    if (reportError) throw new Error(`Report fetch error: ${reportError.message}`);
    if (!report) throw new Error("Report not found: " + reportId);

    const { data: rawAnalytes, error: analytesError } = await supabase
      .from("report_analytes")
      .select("id, raw_name, canonical_slug, value_numeric, raw_value_text, unit, raw_reference_range, normalized_min, normalized_max, normalized_operator, normalized_operator_value, is_core")
      .eq("lab_report_id", reportId)
      .order("raw_name");

    if (analytesError) console.warn("[generate-interpretation] analytes fetch error:", analytesError.message);

    const analytes: AnalyteData[] = (rawAnalytes ?? []) as AnalyteData[];
    console.log(`[generate-interpretation] ${analytes.length} analytes loaded`);

    let interpretationJson: any;
    let source = "demo";

    if (openaiApiKey && analytes.length > 0) {
      try {
        const prompt = buildPrompt(report as LabReportData, analytes);
        console.log(`[generate-interpretation] Prompt chars: ${prompt.length}, calling OpenAI...`);
        interpretationJson = await callOpenAI(openaiApiKey, prompt);
        interpretationJson = sanitizeNutrients(interpretationJson);
        source = "ai";
        console.log("[generate-interpretation] OpenAI success");
      } catch (err: any) {
        console.error("[generate-interpretation] OpenAI failed:", err?.message ?? String(err), "— using fallback");
        interpretationJson = generateFallbackInterpretation(report as LabReportData, analytes);
        source = "demo";
      }
    } else {
      console.log("[generate-interpretation] No OpenAI key or no analytes — using fallback");
      interpretationJson = generateFallbackInterpretation(report as LabReportData, analytes);
      source = "demo";
    }

    const { error: upsertError } = await supabase
      .from("interpretations")
      .upsert({
        lab_report_id: reportId,
        json_output: interpretationJson,
        interpretation_source: source,
        generated_at: new Date().toISOString(),
        disclaimer_version: "1.0",
      }, { onConflict: "lab_report_id" });

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

    const { error: statusError } = await supabase
      .from("lab_reports")
      .update({ status: "ready" })
      .eq("id", reportId);

    if (statusError) console.error("[generate-interpretation] Status update error:", statusError.message);
    else console.log("[generate-interpretation] Done — status set to ready");

    await supabase.from("audit_events").insert({
      user_id: userId,
      event_type: "insights_generated",
      metadata: { report_id: reportId, source },
    }).catch((e: any) => console.error("[generate-interpretation] Audit error:", e?.message));

  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[generate-interpretation] Fatal error:", msg);

    const { data: existing } = await supabase
      .from("lab_reports")
      .select("context")
      .eq("id", reportId)
      .maybeSingle()
      .catch(() => ({ data: null }));

    const existingCtx = (existing?.context && typeof existing.context === "object") ? existing.context : {};
    await supabase.from("lab_reports").update({
      status: "error",
      context: { ...existingCtx, _last_error: msg },
    }).eq("id", reportId).catch(() => {});
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      await checkRateLimit(supabase, user.id);
    } catch (e: any) {
      if (e?.message === "RATE_LIMIT_EXCEEDED") {
        return new Response(JSON.stringify({ error: "Rate limit reached. Please try again tomorrow." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    const body = await req.json();
    const reportId = body?.reportId;
    if (!reportId || typeof reportId !== "string") {
      return new Response(JSON.stringify({ error: "reportId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: report, error: reportCheckError } = await supabase
      .from("lab_reports")
      .select("id, user_id")
      .eq("id", reportId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (reportCheckError || !report) {
      return new Response(JSON.stringify({ error: "Report not found or access denied" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("lab_reports").update({ status: "processing" }).eq("id", reportId);

    EdgeRuntime.waitUntil(processInterpretation(supabase, openaiApiKey, reportId, user.id));

    return new Response(JSON.stringify({ success: true, message: "Processing started" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[generate-interpretation] Request error:", err?.message ?? err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
