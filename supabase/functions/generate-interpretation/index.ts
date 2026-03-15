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

function generateFallbackInterpretation(report: LabReportData, analytes: AnalyteData[]) {
  const cyclePhase = report.estimated_cycle_phase || "unknown";
  const cycleDay = report.estimated_cycle_day;
  const symptoms = report.context?.top_symptoms ?? [];

  const outOfRange = analytes.filter(a => classifyAnalyte(a) === "out_of_range");
  const borderline = analytes.filter(a => classifyAnalyte(a) === "borderline");
  const topFlagged = [...outOfRange, ...borderline].slice(0, 5);
  const totalFlagged = outOfRange.length + borderline.length;

  let headline = "";
  if (totalFlagged === 0) {
    headline = `Your ${analytes.length}-marker panel looks largely within range — a useful baseline for tracking.`;
  } else if (outOfRange.length > 0) {
    const firstName = outOfRange[0].raw_name;
    headline = `${outOfRange.length} value${outOfRange.length > 1 ? "s" : ""} worth discussing — ${firstName} is the most notable.`;
  } else {
    headline = `${borderline.length} borderline result${borderline.length > 1 ? "s" : ""} worth keeping an eye on.`;
  }

  const summaryBullets: string[] = [];

  if (totalFlagged === 0) {
    summaryBullets.push(`All ${analytes.length} markers are within their reference ranges.`);
  } else {
    summaryBullets.push(
      `${outOfRange.length} value${outOfRange.length !== 1 ? "s" : ""} outside reference range, ${borderline.length} borderline.`
    );
  }

  if (cycleDay && cyclePhase !== "unknown") {
    summaryBullets.push(
      `Drawn on cycle day ${cycleDay} (${cyclePhase} phase). Hormone values — especially estradiol, progesterone, LH, and FSH — vary significantly by phase.`
    );
  } else {
    summaryBullets.push(
      "Adding your last period date would help contextualize hormone markers like estradiol, progesterone, LH, and FSH."
    );
  }

  if (symptoms.length > 0) {
    summaryBullets.push(
      `You reported ${symptoms.slice(0, 3).join(", ")}. Bring this symptom history to your provider — context often changes how labs are interpreted.`
    );
  }

  const top_findings = topFlagged.map(a => {
    const status = classifyAnalyte(a);
    const val = a.raw_value_text ?? String(a.value_numeric);
    const slug = a.canonical_slug ?? a.raw_name.toLowerCase().replace(/\s+/g, "_");
    let explanation = `Your ${a.raw_name} result was ${val}${a.unit ? " " + a.unit : ""}.`;
    if (status === "out_of_range") {
      explanation += " This is outside the reference range — worth discussing with your provider.";
    } else if (status === "borderline") {
      explanation += " This is near the edge of the reference range — worth monitoring.";
    }
    return {
      biomarker_slug: slug,
      title: a.raw_name,
      status: status === "out_of_range" ? "discuss" as const : "monitor" as const,
      explanation,
    };
  });

  const questions: string[] = [
    "What do these results mean given my full health history and current symptoms?",
    "Are there any values you'd recommend retesting — and if so, at what point in my cycle?",
  ];
  if (topFlagged.length > 0) {
    questions.push(`Can you walk me through the ${topFlagged[0].raw_name} result and what it might mean?`);
  }
  questions.push("How does my cycle timing affect how we interpret hormone markers on this panel?");

  return {
    headline,
    summary_bullets: summaryBullets,
    top_findings,
    pattern_signals: [],
    cycle_context: {
      estimated_cycle_day: cycleDay,
      estimated_cycle_phase: cyclePhase,
      confidence: cycleDay ? "medium" : "low",
      explanation: cycleDay
        ? `Based on your cycle information, you may be in the ${cyclePhase} phase around day ${cycleDay}. Hormone levels vary naturally across each phase.`
        : "Without a period date, hormone level interpretation is limited.",
    },
    questions_for_doctor: questions,
    disclaimer:
      "This report is for educational purposes only and does not constitute medical advice. Discuss all results with your healthcare provider in the context of your full health history.",
  };
}

async function tryOpenAI(apiKey: string, report: LabReportData, analytes: AnalyteData[]): Promise<any | null> {
  const outOfRange = analytes.filter(a => classifyAnalyte(a) === "out_of_range");
  const borderline = analytes.filter(a => classifyAnalyte(a) === "borderline");

  const HIGH_VALUE_SLUGS = new Set([
    "estradiol", "progesterone", "lh", "fsh", "tsh", "free_t4", "free_t3",
    "fasting_glucose", "hemoglobin_a1c", "total_cholesterol", "ldl_cholesterol",
    "hdl_cholesterol", "triglycerides", "creatinine", "egfr", "alt", "ast",
    "ferritin", "vitamin_d_25_oh", "vitamin_b12", "hs_crp", "tpo_antibodies",
    "hemoglobin", "shbg", "total_testosterone", "dheas", "fasting_insulin",
  ]);

  const keyInRange = analytes.filter(a =>
    a.canonical_slug &&
    HIGH_VALUE_SLUGS.has(a.canonical_slug) &&
    !outOfRange.includes(a) &&
    !borderline.includes(a)
  );

  const selected = [...outOfRange, ...borderline, ...keyInRange].slice(0, 14);

  const labLines = selected.map(a => {
    const val = a.raw_value_text ?? String(a.value_numeric);
    const slug = a.canonical_slug ? ` [${a.canonical_slug}]` : "";
    let line = `${a.raw_name}${slug}: ${val}${a.unit ? " " + a.unit : ""}`;
    if (a.raw_reference_range) line += ` (ref: ${a.raw_reference_range})`;
    const status = classifyAnalyte(a);
    if (status === "out_of_range") line += " ← OUT OF RANGE";
    else if (status === "borderline") line += " ← BORDERLINE";
    return line;
  }).join("\n");

  const ctx: string[] = [];
  if (report.context?.birth_control === "yes") ctx.push("on hormonal birth control");
  if (report.context?.pregnant === "yes") ctx.push("currently pregnant");
  if (report.context?.postpartum === "yes") ctx.push("postpartum");
  if (report.context?.top_symptoms?.length) {
    ctx.push(`reported symptoms: ${report.context.top_symptoms.slice(0, 4).join(", ")}`);
  }

  const cycleInfo = report.estimated_cycle_day && report.estimated_cycle_phase
    ? `Day ${report.estimated_cycle_day} of cycle — ${report.estimated_cycle_phase} phase`
    : "cycle day unknown";

  const prompt = `You are Amani's clinical interpretation engine. Your role is to interpret women's lab results with precision, cycle awareness, and clinical nuance. You do not over-diagnose. You do not generate generic wellness advice. You flag what matters and contextualize it clearly.

PATIENT CONTEXT:
- Report date: ${report.report_date}
- Cycle: ${cycleInfo}
${ctx.length ? "- " + ctx.join("\n- ") : ""}

LAB PANEL: ${analytes.length} total analytes. Key values shown below:
${labLines}

INSTRUCTIONS:
1. Write a single-sentence headline that captures the most important clinical finding or reassurance. Be specific, not generic.
2. Write exactly 3 summary bullets. Each should be a specific, clinically grounded observation — not lifestyle advice. Reference actual values when helpful.
3. Identify up to 5 top findings (prioritize out-of-range and borderline). For each, use the canonical_slug as biomarker_slug when available. Status must be "discuss", "monitor", or "reassuring". Explanation should be 1–3 sentences, specific to this patient's result and cycle context.
4. Identify up to 3 pattern signals — multi-marker patterns that suggest a clinical theme (e.g., possible insulin resistance, thyroid autoimmunity). Only include if genuinely supported by the data. Each must have confidence level.
5. Write 3 specific, actionable questions for a doctor visit. These should reference the patient's actual results.
6. Summarize the cycle context in 1–2 sentences based on the data.
7. Do NOT generate nutrition, sleep, or exercise advice unless a specific lab value directly necessitates it.
8. Tone: calm, intelligent, direct. Not alarmist. Not chatty. Not generic.

Return ONLY a valid JSON object. No markdown. No preamble. Every array field MUST be an array, never a string.

Required schema:
{
  "headline": "string",
  "summary_bullets": ["string", "string", "string"],
  "top_findings": [
    {
      "biomarker_slug": "string",
      "title": "string",
      "status": "discuss" | "monitor" | "reassuring",
      "explanation": "string"
    }
  ],
  "pattern_signals": [
    {
      "title": "string",
      "confidence": "low" | "medium" | "high",
      "explanation": "string",
      "related_biomarkers": ["string"]
    }
  ],
  "cycle_context": {
    "estimated_cycle_day": number | null,
    "estimated_cycle_phase": "menstrual" | "follicular" | "ovulatory" | "luteal" | "unknown",
    "confidence": "low" | "medium" | "high",
    "explanation": "string"
  },
  "questions_for_doctor": ["string", "string", "string"],
  "disclaimer": "string"
}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are Amani's clinical engine. Return ONLY the JSON object. No markdown, no code blocks, no preamble. Educational use only — not medical advice.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 1400,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn("[generate-interpretation] OpenAI status:", res.status, errBody);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (typeof parsed.headline !== "string") return null;
    return parsed;
  } catch (e: any) {
    clearTimeout(tid);
    console.warn("[generate-interpretation] OpenAI failed:", e?.message);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

  const supabase = createClient(supabaseUrl, serviceKey);

  let reportId: string | null = null;

  try {
    const body = await req.json();
    reportId = body?.reportId ?? null;

    if (!reportId || typeof reportId !== "string") {
      return new Response(JSON.stringify({ error: "reportId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    await supabase.from("lab_reports").update({ status: "processing" }).eq("id", reportId);

    const { data: report } = await supabase
      .from("lab_reports")
      .select("id, report_date, estimated_cycle_day, estimated_cycle_phase, context")
      .eq("id", reportId)
      .maybeSingle();

    const { data: rawAnalytes } = await supabase
      .from("report_analytes")
      .select("id, raw_name, canonical_slug, value_numeric, raw_value_text, unit, raw_reference_range, normalized_min, normalized_max, normalized_operator, normalized_operator_value, is_core")
      .eq("lab_report_id", reportId)
      .order("raw_name");

    const analytes: AnalyteData[] = (rawAnalytes ?? []) as AnalyteData[];
    console.log(`[generate-interpretation] ${analytes.length} analytes for report ${reportId}`);

    let interpretationJson: any;
    let source = "fallback";

    if (openaiApiKey && analytes.length > 0 && report) {
      console.log("[generate-interpretation] Trying OpenAI...");
      const aiResult = await tryOpenAI(openaiApiKey, report as LabReportData, analytes);
      if (aiResult) {
        interpretationJson = aiResult;
        source = "ai";
        console.log("[generate-interpretation] OpenAI succeeded");
      } else {
        console.log("[generate-interpretation] OpenAI failed, using fallback");
        interpretationJson = generateFallbackInterpretation(report as LabReportData, analytes);
      }
    } else {
      console.log("[generate-interpretation] Using fallback (no key or no analytes)");
      interpretationJson = report
        ? generateFallbackInterpretation(report as LabReportData, analytes)
        : {
            headline: "Report data unavailable.",
            summary_bullets: [],
            top_findings: [],
            pattern_signals: [],
            cycle_context: { estimated_cycle_day: null, estimated_cycle_phase: "unknown", confidence: "low", explanation: "" },
            questions_for_doctor: [],
            disclaimer: "Educational use only.",
          };
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

    if (upsertError) {
      console.error("[generate-interpretation] Upsert error:", upsertError.message);
      await supabase.from("lab_reports").update({ status: "error" }).eq("id", reportId);
      return new Response(JSON.stringify({ error: "Failed to save interpretation" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("lab_reports").update({ status: "ready" }).eq("id", reportId);
    console.log("[generate-interpretation] Done — status: ready, source:", source);

    return new Response(JSON.stringify({ success: true, source }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[generate-interpretation] Fatal error:", err?.message ?? err);
    if (reportId) {
      try {
        await supabase.from("lab_reports").update({ status: "error" }).eq("id", reportId);
      } catch (_) {}
    }
    return new Response(JSON.stringify({ error: "Internal server error", detail: err?.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
