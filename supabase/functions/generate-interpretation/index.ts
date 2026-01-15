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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  let supabase: any;
  let reportId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    reportId = body.reportId;

    if (!reportId) {
      return new Response(
        JSON.stringify({ error: "reportId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: report, error: reportError } = await supabase
      .from("lab_reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();

    if (reportError || !report) {
      throw new Error("Report not found");
    }

    const { data: biomarkers, error: biomarkersError } = await supabase
      .from("biomarkers")
      .select("*")
      .eq("lab_report_id", reportId);

    if (biomarkersError) {
      throw new Error("Failed to fetch biomarkers");
    }

    const labReport = report as LabReportData;
    const biomarkersList = biomarkers as BiomarkerData[];

    let interpretationJson;
    let interpretationSource = "demo";

    // Try OpenAI if API key is available
    if (openaiApiKey) {
      try {
        const prompt = generatePrompt(labReport, biomarkersList);

        interpretationJson = await callOpenAIWithRetry(openaiApiKey, prompt, labReport, biomarkersList);
        interpretationSource = "ai";
      } catch (openaiError) {
        console.error("OpenAI request failed, using demo mode:", openaiError);
        interpretationJson = generateDemoInterpretation(labReport, biomarkersList);
        interpretationSource = "demo";
      }
    } else {
      // No API key, use demo mode
      interpretationJson = generateDemoInterpretation(labReport, biomarkersList);
      interpretationSource = "demo";
    }

    // Insert interpretation into interpretations table
    const { error: insertError } = await supabase
      .from("interpretations")
      .insert({
        lab_report_id: reportId,
        json_output: interpretationJson,
        interpretation_source: interpretationSource,
      });

    if (insertError) {
      throw new Error("Failed to insert interpretation");
    }

    // Update report status to ready
    const { error: updateError } = await supabase
      .from("lab_reports")
      .update({
        status: "ready",
      })
      .eq("id", reportId);

    if (updateError) {
      throw new Error("Failed to update report status");
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error generating interpretation:", error);

    // Update report status to error if we have the reportId
    if (supabase && reportId) {
      try {
        await supabase
          .from("lab_reports")
          .update({ status: "error" })
          .eq("id", reportId);
      } catch (updateError) {
        console.error("Failed to update report status to error:", updateError);
      }
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

async function callOpenAIWithRetry(
  apiKey: string,
  prompt: string,
  report: LabReportData,
  biomarkers: BiomarkerData[],
  maxOutputTokens = 1800
): Promise<any> {
  const systemPrompt = `You are Amani, a supportive women's health AI assistant. You provide calm, educational interpretations of lab results with cycle awareness. You NEVER diagnose, alarm, or replace medical advice.

Your communication style:
- Calm, educational, non-alarming
- Use uncertainty language (may, can, could, often, sometimes)
- Acknowledge cycle context and hormonal variation
- Emphasize that results are snapshots, not diagnoses
- Always include disclaimers about consulting healthcare providers
- Be warm and supportive while remaining educational

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
  "supportive_considerations": {
    "nutrition": ["string"],
    "sleep_stress": ["string"],
    "lifestyle": ["string"]
  },
  "questions_for_doctor": ["string"],
  "suggested_followups_to_discuss": ["string"],
  "safety_notes": ["string"],
  "disclaimer": "string"
}

Keep language accessible but scientifically accurate. Never use alarmist language like "concerning," "worrying," or "abnormal." Instead use "outside typical range" or "may benefit from discussion with your provider."`;

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
          { role: "user", content: prompt }
        ],
        max_tokens: maxOutputTokens,
        temperature: 0.7,
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

    try {
      const parsedJson = JSON.parse(content);
      return parsedJson;
    } catch (parseError) {
      console.error("Failed to parse JSON response, content:", content);

      if (maxOutputTokens > 1500) {
        console.log("Retrying with lower token limit (1500)...");
        return await callOpenAIWithRetry(apiKey, prompt, report, biomarkers, 1500);
      }

      throw new Error("Invalid JSON response from OpenAI");
    }
  } catch (error) {
    if (maxOutputTokens > 1500) {
      console.log("OpenAI call failed, retrying with lower token limit...");
      try {
        return await callOpenAIWithRetry(apiKey, prompt, report, biomarkers, 1500);
      } catch (retryError) {
        console.error("Retry also failed:", retryError);
        throw retryError;
      }
    }
    throw error;
  }
}

function generatePrompt(report: LabReportData, biomarkers: BiomarkerData[]): string {
  const cycleInfo = report.estimated_cycle_day && report.estimated_cycle_phase
    ? `Cycle Day ${report.estimated_cycle_day}, ${report.estimated_cycle_phase} phase`
    : "Cycle information not provided";

  const contextInfo = [];
  if (report.context.birth_control === "yes") {
    contextInfo.push("Currently using birth control");
  }
  if (report.context.pregnant === "yes") {
    contextInfo.push("Currently pregnant");
  }
  if (report.context.postpartum === "yes") {
    contextInfo.push("Postpartum");
  }
  if (report.context.top_symptoms && report.context.top_symptoms.length > 0) {
    contextInfo.push(`Experiencing: ${report.context.top_symptoms.join(", ")}`);
  }

  const biomarkersText = biomarkers
    .map((b) => {
      let text = `${b.name}: ${b.value} ${b.unit}`;
      if (b.reference_min !== null && b.reference_max !== null) {
        text += ` (Reference range: ${b.reference_min}-${b.reference_max} ${b.unit})`;
      }
      return text;
    })
    .join("\n");

  return `Please provide a supportive, educational interpretation of these lab results:

Report Date: ${report.report_date}
${cycleInfo}
${contextInfo.length > 0 ? `Context: ${contextInfo.join(", ")}` : ""}

Biomarkers:
${biomarkersText}

Remember to:
- Consider the cycle phase when interpreting hormone levels
- Use calm, educational language
- Provide context about what's normal variation vs. what might warrant discussion
- Include supportive questions they can bring to their doctor
- Emphasize this is educational information, not medical advice`;
}

function generateDemoInterpretation(report: LabReportData, biomarkers: BiomarkerData[]) {
  const cyclePhase = report.estimated_cycle_phase || "unknown";
  const cycleDay = report.estimated_cycle_day;

  const biomarkerInterpretations = biomarkers.map((b) => {
    let status: "in_range" | "borderline" | "out_of_range" | "unknown" = "unknown";
    let meaning = `${b.name} is a hormone that helps regulate your menstrual cycle and overall health.`;
    let timingNotes = "Hormone levels naturally fluctuate throughout your cycle.";
    let commonReasons = ["Natural cycle variation", "Time of day", "Recent diet or exercise"];
    let followUp = ["If you have concerning symptoms", "If values are significantly outside your normal range"];

    if (b.reference_min !== null && b.reference_max !== null) {
      if (b.value >= b.reference_min && b.value <= b.reference_max) {
        status = "in_range";
        meaning = `Your ${b.name} level is within the typical reference range for this test.`;
      } else if (b.value < b.reference_min * 0.8 || b.value > b.reference_max * 1.2) {
        status = "out_of_range";
        meaning = `Your ${b.name} level is outside the typical reference range. This may warrant a conversation with your healthcare provider.`;
      } else {
        status = "borderline";
        meaning = `Your ${b.name} level is slightly outside the typical reference range but may still be within normal variation.`;
      }
    }

    return {
      name: b.name,
      user_value: b.value.toString(),
      unit: b.unit,
      reference_range: b.reference_min !== null && b.reference_max !== null
        ? `${b.reference_min}-${b.reference_max} ${b.unit}`
        : "Reference range not provided",
      status_label: status,
      plain_english_meaning: meaning,
      timing_notes: timingNotes,
      common_non_alarm_reasons: commonReasons,
      when_clinicians_follow_up: followUp,
    };
  });

  const summaryBullets = [
    `Your lab results show ${biomarkers.length} biomarker${biomarkers.length > 1 ? 's' : ''} tested`,
    cycleDay ? `Results collected on cycle day ${cycleDay} (${cyclePhase} phase)` : "Cycle timing information helps contextualize hormone levels",
    "Remember that hormone levels naturally fluctuate throughout your cycle",
  ];

  return {
    summary_bullets: summaryBullets,
    cycle_context: {
      estimated_cycle_day: cycleDay,
      estimated_cycle_phase: cyclePhase,
      confidence: cycleDay ? "medium" : "low",
      explanation: cycleDay
        ? `Based on your cycle information, you appear to be in the ${cyclePhase} phase. Hormone levels can vary significantly depending on where you are in your cycle, so it's important to interpret these results in that context.`
        : "Without cycle timing information, it's more difficult to interpret hormone levels accurately. Consider tracking your cycle to provide more context for future lab work.",
    },
    biomarkers: biomarkerInterpretations,
    supportive_considerations: {
      nutrition: [
        "Maintain a balanced diet with adequate protein, healthy fats, and complex carbohydrates",
        "Consider foods rich in nutrients that support hormone health",
        "Stay hydrated throughout the day",
      ],
      sleep_stress: [
        "Aim for 7-9 hours of quality sleep per night",
        "Practice stress management techniques like deep breathing or meditation",
        "Consider how sleep patterns may affect hormone levels",
      ],
      lifestyle: [
        "Regular moderate exercise can support hormonal balance",
        "Track your cycle to better understand your body's patterns",
        "Be mindful of factors that may influence lab results like time of day and recent meals",
      ],
    },
    questions_for_doctor: [
      "What do these results mean in the context of my overall health and symptoms?",
      "Are there any follow-up tests you'd recommend?",
      "How does my cycle timing affect the interpretation of these results?",
      "What lifestyle factors might be influencing these values?",
    ],
    suggested_followups_to_discuss: [
      "Retesting at a different point in your cycle if timing was unclear",
      "Additional biomarkers that might provide more context",
      "Tracking symptoms alongside cycle phase for better pattern recognition",
    ],
    safety_notes: [
      "Seek immediate care if you experience severe symptoms like intense pain, heavy bleeding, or signs of infection",
      "Contact your provider if you have concerning symptoms that interfere with daily life",
      "Remember that lab values are just one piece of your health picture",
    ],
    disclaimer: "This interpretation is for educational purposes only and is not medical advice. Please consult with your healthcare provider to discuss your results and any questions or concerns you may have. Lab values should always be interpreted in the context of your complete health history and symptoms.",
  };
}
