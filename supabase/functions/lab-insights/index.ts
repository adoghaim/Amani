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
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const { currentReportId, previousReportId, userId } = body;

    if (!currentReportId || !userId) {
      throw new Error("Missing required parameters");
    }

    const { data: currentReport, error: currentError } = await supabase
      .from("lab_reports")
      .select("*")
      .eq("id", currentReportId)
      .eq("user_id", userId)
      .single();

    if (currentError || !currentReport) {
      throw new Error("Current report not found");
    }

    let previousReport = null;
    if (previousReportId) {
      const { data, error } = await supabase
        .from("lab_reports")
        .select("*")
        .eq("id", previousReportId)
        .eq("user_id", userId)
        .single();

      if (!error && data) {
        previousReport = data;
      }
    }

    if (!previousReport) {
      return new Response(
        JSON.stringify({
          error: "Previous report not found. Need at least two reports to compare.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: currentBiomarkers } = await supabase
      .from("biomarkers")
      .select("name, value, unit")
      .eq("lab_report_id", currentReportId);

    const { data: previousBiomarkers } = await supabase
      .from("biomarkers")
      .select("name, value, unit")
      .eq("lab_report_id", previousReportId);

    const biomarkerChanges = (currentBiomarkers || []).map((current: BiomarkerData) => {
      const previous = (previousBiomarkers || []).find(
        (p: BiomarkerData) => p.name.toLowerCase() === current.name.toLowerCase()
      );

      if (previous && previous.unit === current.unit) {
        const delta = current.value - previous.value;
        const percentChange = previous.value !== 0 ? (delta / previous.value) * 100 : 0;
        return {
          name: current.name,
          previous_value: previous.value,
          current_value: current.value,
          unit: current.unit,
          delta,
          percent_change: percentChange,
        };
      }
      return null;
    }).filter(Boolean);

    const { data: interventions } = await supabase
      .from("interventions")
      .select("title, category, start_date, end_date")
      .eq("user_id", userId)
      .lte("start_date", currentReport.report_date)
      .gte("start_date", previousReport.report_date);

    const daysBetween = Math.floor(
      (new Date(currentReport.report_date).getTime() -
        new Date(previousReport.report_date).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    const prompt = `You are a health education assistant analyzing lab results over time. Provide educational insights only - never diagnose or prescribe.

Previous lab: ${new Date(previousReport.report_date).toLocaleDateString()}
Current lab: ${new Date(currentReport.report_date).toLocaleDateString()}
Time between labs: ${daysBetween} days

Biomarker changes:
${biomarkerChanges.map((bc: any) => `- ${bc.name}: ${bc.previous_value} → ${bc.current_value} ${bc.unit} (${bc.delta > 0 ? '+' : ''}${bc.delta.toFixed(1)}, ${bc.percent_change.toFixed(0)}%)`).join('\n')}

Interventions started between labs:
${interventions && interventions.length > 0 ? interventions.map((i: any) => `- ${i.title} (${i.category})`).join('\n') : 'None tracked'}

Please provide:
1. A brief summary of notable changes (2-3 sentences)
2. Notable changes in key biomarkers (mention only significant changes)
3. Possible contributing factors (educational only, mention tracked interventions if relevant)
4. Questions to ask a healthcare provider

Format as JSON:
{
  "summary": "string",
  "notable_changes": [{"biomarker": "string", "change": "string", "possible_factors": ["string"]}],
  "questions_to_ask": ["string"],
  "next_steps_general": ["string"]
}

Remember:
- Use cautious, educational language
- Encourage consulting with healthcare providers
- Do not diagnose conditions
- Keep explanations accessible`;

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a health education assistant. Provide educational insights only. Never diagnose or prescribe treatment.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.statusText}`);
    }

    const openaiData = await openaiResponse.json();
    const insights = JSON.parse(openaiData.choices[0].message.content);

    return new Response(
      JSON.stringify({
        insights,
        report_dates: {
          previous: previousReport.report_date,
          current: currentReport.report_date,
          days_between: daysBetween,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error generating insights:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to generate insights",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
