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

    // Upsert interpretation into interpretations table (insert or update if exists)
    const { error: upsertError } = await supabase
      .from("interpretations")
      .upsert({
        lab_report_id: reportId,
        json_output: interpretationJson,
        interpretation_source: interpretationSource,
      }, {
        onConflict: 'lab_report_id'
      });

    if (upsertError) {
      throw new Error("Failed to save interpretation");
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

// Validation functions for nutrient safety
function validateNutrientContent(jsonOutput: any): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const allowedNutrients = ['vitamin_d', 'iron', 'b12', 'folate', 'magnesium', 'omega_3', 'iodine'];

  // Banned dosage units
  const bannedDosageUnits = [
    /\bIU\b/gi,
    /\bmg\b/gi,
    /\bmcg\b/gi,
    /\b\d+\s*g\b/gi,  // numbers followed by 'g'
    /\bmL\b/gi,
  ];

  // Banned directive verbs
  const bannedDirectiveVerbs = [
    /\btake\b/gi,
    /\bstart\b/gi,
    /\bincrease\b/gi,
    /\bdecrease\b/gi,
    /\brecommended\b/gi,
    /\bprescribe\b/gi,
  ];

  // Banned frequency words
  const bannedFrequencyWords = [
    /\bdaily\b/gi,
    /\btwice\b/gi,
    /\bper day\b/gi,
    /\bevery day\b/gi,
  ];

  const jsonString = JSON.stringify(jsonOutput);

  // Check for banned dosage units
  bannedDosageUnits.forEach(pattern => {
    const matches = jsonString.match(pattern);
    if (matches) {
      violations.push(`Contains banned dosage unit: ${matches.join(', ')}`);
    }
  });

  // Check for banned directive verbs
  bannedDirectiveVerbs.forEach(pattern => {
    const matches = jsonString.match(pattern);
    if (matches) {
      violations.push(`Contains banned directive verb: ${matches.join(', ')}`);
    }
  });

  // Check for banned frequency words
  bannedFrequencyWords.forEach(pattern => {
    const matches = jsonString.match(pattern);
    if (matches) {
      violations.push(`Contains banned frequency word: ${matches.join(', ')}`);
    }
  });

  // Validate allow-list for nutrients
  if (jsonOutput.nutrient_topics_to_discuss && Array.isArray(jsonOutput.nutrient_topics_to_discuss)) {
    jsonOutput.nutrient_topics_to_discuss.forEach((item: any, index: number) => {
      if (item.nutrient && !allowedNutrients.includes(item.nutrient)) {
        violations.push(`Nutrient at index ${index} not in allow-list: ${item.nutrient}`);
      }
    });
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

function sanitizeNutrientSection(jsonOutput: any): any {
  // Set nutrient_topics_to_discuss to empty array due to validation failures
  const sanitized = { ...jsonOutput };
  console.log("Setting nutrient_topics_to_discuss to empty array due to validation failures");
  sanitized.nutrient_topics_to_discuss = [];
  return sanitized;
}

async function callOpenAIWithRetry(
  apiKey: string,
  prompt: string,
  report: LabReportData,
  biomarkers: BiomarkerData[],
  maxOutputTokens = 1800,
  attemptNumber = 1
): Promise<any> {
  const systemPrompt = `You are Amani, a supportive women's health AI assistant. You provide calm, educational interpretations of lab results with cycle awareness. You NEVER diagnose, alarm, or replace medical advice.

CRITICAL LANGUAGE RULES - NEVER USE THESE WORDS:
- FORBIDDEN: "healthy", "normal", "indicates", "confirms", "shows that", "proves", "diagnoses", "recovery"
- FORBIDDEN: "concerning", "worrying", "abnormal", "problematic"
- REQUIRED: "may", "can", "could", "often", "commonly", "sometimes", "consistent with", "suggests"
- REQUIRED: Use phrases like "often consistent with", "commonly seen", "may align with", "can be associated with"
- For out-of-range values: "outside typical range" or "may benefit from discussion with your provider"

CRITICAL CONTEXT GATING RULES:
- ONLY mention postpartum if postpartum = "yes". If postpartum = "no" OR "unsure", you MUST NOT mention postpartum, recovery, childbirth, or post-birth changes. This is an error.
- ONLY mention pregnancy if pregnant = "yes". If pregnant = "no" OR "unsure", you MUST NOT mention pregnancy.
- Do NOT assume or infer pregnancy or postpartum status from symptoms or biomarker values
- If a context field is unknown, do NOT reference it at all

CRITICAL NUTRIENT & SUPPLEMENT RULES (HARD CONSTRAINTS):
- ONLY include nutrients if DIRECTLY tied to a specific lab value or reported symptom
- NEVER include nutrients as general wellness advice
- NEVER recommend, prescribe, or suggest taking anything
- NEVER include dosages, frequencies, timing, or brands (BANNED: IU, mg, mcg, daily, weekly, twice, etc.)
- NEVER use prescriptive language (BANNED: "take", "start", "increase", "decrease", "recommended", "prescribe")
- ONLY use consultative phrasing: "Some clinicians may discuss...", "You may want to ask your provider about..."
- NEVER include alternative, herbal, adaptogen, or hormone-modulating supplements (BANNED: ashwagandha, maca, vitex, DIM, evening primrose, black cohosh, etc.)
- ALLOWED nutrients (ONLY if tied to lab/symptom): vitamin_d, iron, b12, folate, magnesium, omega_3, iodine
- Each nutrient must include clear reasoning for why it came up based on specific data

RANGE INTERPRETATION RULES:
- If a value is in range but near the low/high end, you may say "within range, though near the lower/higher end" and suggest discussing in context of symptoms
- Always contextualize with cycle phase when relevant
- Emphasize natural variation throughout the menstrual cycle

SAFETY NOTES REQUIREMENTS:
- safety_notes MUST include 3-5 concrete examples of when to seek urgent care
- Examples should be general, non-diagnostic, actionable
- Examples: "Seek immediate care if you experience severe abdominal pain", "Contact your provider if you have unusually heavy bleeding (soaking through a pad in an hour)", "Seek care for sudden severe headaches or vision changes"
- Do not make these specific to the user's lab values

DATA RULES:
- user_value must NEVER include units (e.g., "45.2" not "45.2 ng/mL")
- Units must be provided ONLY in the separate unit field
- Ensure user_value is always a string containing only the numeric value

Your communication style:
- Calm, educational, non-alarming
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
  "nutrient_topics_to_discuss": [{
    "nutrient": "vitamin_d" | "iron" | "b12" | "folate" | "magnesium" | "omega_3" | "iodine",
    "why_it_came_up": "string explaining which specific lab value or symptom triggered this",
    "discussion_prompt": "string using ONLY consultative language like 'Some clinicians may discuss...' or 'You may want to ask your provider about...'"
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

      // Validate nutrient content
      const validation = validateNutrientContent(parsedJson);

      if (!validation.valid) {
        console.warn("Nutrient content validation failed:", validation.violations);

        // Allow one retry on first attempt
        if (attemptNumber === 1) {
          console.log("Attempting regeneration with stricter prompt...");
          return await callOpenAIWithRetry(apiKey, prompt, report, biomarkers, maxOutputTokens, 2);
        } else {
          // Second attempt failed, sanitize by removing nutrient section
          console.log("Second attempt also failed validation, removing nutrient section");
          return sanitizeNutrientSection(parsedJson);
        }
      }

      return parsedJson;
    } catch (parseError) {
      console.error("Failed to parse JSON response, content:", content);

      if (maxOutputTokens > 1500) {
        console.log("Retrying with lower token limit (1500)...");
        return await callOpenAIWithRetry(apiKey, prompt, report, biomarkers, 1500, attemptNumber);
      }

      throw new Error("Invalid JSON response from OpenAI");
    }
  } catch (error) {
    if (maxOutputTokens > 1500) {
      console.log("OpenAI call failed, retrying with lower token limit...");
      try {
        return await callOpenAIWithRetry(apiKey, prompt, report, biomarkers, 1500, attemptNumber);
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
    contextInfo.push("User is currently using birth control");
  }
  if (report.context.pregnant === "yes") {
    contextInfo.push("User is currently pregnant");
  }
  if (report.context.postpartum === "yes") {
    contextInfo.push("User is postpartum");
  }
  if (report.context.top_symptoms && report.context.top_symptoms.length > 0) {
    contextInfo.push(`Top symptoms: ${report.context.top_symptoms.join(", ")}`);
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
    let meaning = `${b.name} is a hormone that may play a role in regulating your menstrual cycle and overall health.`;
    let timingNotes = "Hormone levels naturally fluctuate throughout your cycle.";
    let commonReasons = ["Natural cycle variation", "Time of day", "Recent diet or exercise"];
    let followUp = ["If you have symptoms that interfere with daily life", "If values are significantly outside your typical range"];

    if (b.reference_min !== null && b.reference_max !== null) {
      if (b.value >= b.reference_min && b.value <= b.reference_max) {
        status = "in_range";
        meaning = `Your ${b.name} level is often consistent with the typical reference range for this test.`;
      } else if (b.value < b.reference_min * 0.8 || b.value > b.reference_max * 1.2) {
        status = "out_of_range";
        meaning = `Your ${b.name} level is outside the typical reference range. This may benefit from discussion with your healthcare provider.`;
      } else {
        status = "borderline";
        meaning = `Your ${b.name} level is slightly outside the typical reference range but may align with individual variation.`;
      }
    }

    return {
      name: b.name,
      user_value: b.value.toString(),
      unit: b.unit,
      reference_range: b.reference_min !== null && b.reference_max !== null
        ? `${b.reference_min}-${b.reference_max}`
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
    "Hormone levels naturally fluctuate throughout your cycle",
  ];

  return {
    summary_bullets: summaryBullets,
    cycle_context: {
      estimated_cycle_day: cycleDay,
      estimated_cycle_phase: cyclePhase,
      confidence: cycleDay ? "medium" : "low",
      explanation: cycleDay
        ? `Based on your cycle information, you may be in the ${cyclePhase} phase. Hormone levels can vary significantly depending on where you are in your cycle, which is important context for interpreting these results.`
        : "Without cycle timing information, hormone level interpretation may be limited. Consider tracking your cycle to provide more context for future lab work.",
    },
    biomarkers: biomarkerInterpretations,
    nutrient_topics_to_discuss: [],
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
      "Seek immediate care if you experience severe abdominal pain",
      "Contact your provider if you have unusually heavy bleeding (soaking through a pad in an hour)",
      "Seek care for sudden severe headaches or vision changes",
      "Get urgent care if you experience signs of infection such as high fever (over 101°F) with chills",
      "Remember that lab values are just one piece of your health picture",
    ],
    disclaimer: "This interpretation is for educational purposes only and is not medical advice. Please consult with your healthcare provider to discuss your results and any questions or concerns you may have. Lab values should always be interpreted in the context of your complete health history and symptoms.",
  };
}
