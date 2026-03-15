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
  const topFindings = [...outOfRange, ...borderline].slice(0, 5);
  const totalFlagged = outOfRange.length + borderline.length;

  const summaryBullets: string[] = [];

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

  if (report.context?.postpartum === "yes") {
    summaryBullets.push("Postpartum hormonal shifts can affect thyroid, iron, and mood-related markers — timing of this panel relative to delivery is helpful context for your provider.");
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
    nutrient_topics_to_discuss: [],
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

async function tryOpenAI(apiKey: string, report: LabReportData, analytes: AnalyteData[]): Promise<any | null> {
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
  const selected = [...outOfRange, ...borderline, ...keyOther].slice(0, 12);

  const labLines = selected.map(a => {
    const val = a.raw_value_text ?? String(a.value_numeric);
    let line = `${a.raw_name}: ${val}${a.unit ? " " + a.unit : ""}`;
    if (a.raw_reference_range) line += ` (ref: ${a.raw_reference_range})`;
    const status = classifyAnalyte(a);
    if (status === "out_of_range") line += " [OUT]";
    else if (status === "borderline") line += " [BORDERLINE]";
    return line;
  }).join("\n");

  const ctx: string[] = [];
  if (report.context?.birth_control === "yes") ctx.push("on birth control");
  if (report.context?.pregnant === "yes") ctx.push("pregnant");
  if (report.context?.postpartum === "yes") ctx.push("postpartum");
  if (report.context?.top_symptoms?.length) ctx.push(`symptoms: ${report.context.top_symptoms.slice(0, 3).join(", ")}`);

  const cycleInfo = report.estimated_cycle_day && report.estimated_cycle_phase
    ? `Day ${report.estimated_cycle_day}, ${report.estimated_cycle_phase}`
    : "cycle info not provided";

  const prompt = `Women's health lab interpretation. Date: ${report.report_date}. Cycle: ${cycleInfo}.${ctx.length ? " Context: " + ctx.join(", ") + "." : ""}
Total panel: ${analytes.length} analytes. Key values (${selected.length}):
${labLines}

Return ONLY valid JSON matching this schema exactly:
{"summary_bullets":["3-4 strings"],"cycle_context":{"estimated_cycle_day":number|null,"estimated_cycle_phase":"menstrual"|"follicular"|"ovulatory"|"luteal"|"unknown","confidence":"low"|"medium"|"high","explanation":"string"},"biomarkers":[{"name":"string","user_value":"string","unit":"string","reference_range":"string","status_label":"in_range"|"borderline"|"out_of_range"|"unknown","plain_english_meaning":"string","timing_notes":"string","common_non_alarm_reasons":["string"],"when_clinicians_follow_up":["string"]}],"nutrient_topics_to_discuss":[],"supportive_considerations":{"nutrition":["string"],"sleep_stress":["string"],"lifestyle":["string"]},"questions_for_doctor":["3-4 strings"],"suggested_followups_to_discuss":["string"],"safety_notes":["string"],"disclaimer":"string"}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a women's health AI. Respond ONLY with the JSON object requested. No markdown. Educational use only — not medical advice." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1000,
        temperature: 0.4,
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
    return JSON.parse(content);
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
    let source = "demo";

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
        source = "fallback";
      }
    } else {
      console.log("[generate-interpretation] Using fallback (no key or no analytes)");
      interpretationJson = report
        ? generateFallbackInterpretation(report as LabReportData, analytes)
        : {
            summary_bullets: ["Report data unavailable."],
            cycle_context: { estimated_cycle_day: null, estimated_cycle_phase: "unknown", confidence: "low", explanation: "" },
            biomarkers: [],
            nutrient_topics_to_discuss: [],
            supportive_considerations: { nutrition: [], sleep_stress: [], lifestyle: [] },
            questions_for_doctor: [],
            suggested_followups_to_discuss: [],
            safety_notes: [],
            disclaimer: "Educational use only.",
          };
      source = "fallback";
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
