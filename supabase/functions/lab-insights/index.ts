import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchWithBackoff } from "../_shared/fetchWithBackoff.ts";
import { errorMessage } from "../_shared/errors.ts";
import { LabInsightsRequestSchema } from "../_shared/schemas/requests.ts";
import { entitlementUnavailable } from "../_shared/entitlement-response.ts";
import { checkUserSubscription } from "../_shared/subscription-guard.ts";
import { parseLabInsightsCompletion } from "../_shared/lab-insights-output.ts";
import { enforceRateLimit, isRateLimitExceeded } from "../_shared/rate-limit.ts";
import { createRateLimitStore } from "../_shared/rate-limit-store.ts";

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

type BiomarkerChange = {
  name: string;
  previous_value: number;
  current_value: number;
  unit: string;
  delta: number;
  percent_change: number;
};

type InterventionRow = {
  title: string;
  category: string;
  start_date: string;
  end_date?: string | null;
};

const normalizeName = (s: string) => s.toLowerCase().trim();

// Keep this conservative to avoid noise.
// Many lab units vary widely, so we primarily rely on percent change.
const isSignificantChange = (change: BiomarkerChange): boolean => {
  const absPct = Math.abs(change.percent_change);
  // Treat tiny baselines carefully: percent changes can explode.
  // If previous value is very small, require a meaningful absolute delta too.
  if (Math.abs(change.previous_value) < 0.01) {
    return Math.abs(change.delta) >= 0.5;
  }
  return absPct >= 10;
};

const topChanges = (changes: BiomarkerChange[], n = 10): BiomarkerChange[] => {
  return [...changes]
    .sort((a, b) => Math.abs(b.percent_change) - Math.abs(a.percent_change))
    .slice(0, n);
};

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    // This function bills us for an OpenAI call, so it gates on entitlement
    // exactly like generate-interpretation / extract-biomarkers /
    // parse-lab-report-ocr. Without this an expired trial kept generating.
    const subCheck = await checkUserSubscription(supabaseAuth, userId, undefined, true);
    if (!subCheck.allowed && subCheck.reason === "error") return entitlementUnavailable(corsHeaders);
    if (subCheck.allowed && subCheck.plan === "free") {
      return new Response(JSON.stringify({ code: "premium_required" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!subCheck.allowed) {
      console.log("[lab-insights] subscription check blocked:", subCheck.reason);
      return new Response(
        JSON.stringify({ error: "subscription_required", reason: subCheck.reason }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    await enforceRateLimit(createRateLimitStore(supabase), {
      userId,
      endpoint: "lab-insights",
      limitPerDay: 30,
    });

    const body = await req.json().catch(() => null);
    const parsedBody = LabInsightsRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request body", detail: parsedBody.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { currentReportId, previousReportId } = parsedBody.data;

    const { data: currentReport, error: currentError } = await supabaseAuth
      .from("lab_reports")
      .select("*")
      .eq("id", currentReportId)
      .single();

    if (currentError || !currentReport) {
      throw new Error("Current report not found");
    }

    let previousReport = null;
    if (previousReportId) {
      const { data, error } = await supabaseAuth
        .from("lab_reports")
        .select("*")
        .eq("id", previousReportId)
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

    const { data: currentBiomarkers } = await supabaseAuth
      .from("biomarkers")
      .select("name, value, unit")
      .eq("lab_report_id", currentReportId);

    const { data: previousBiomarkers } = await supabaseAuth
      .from("biomarkers")
      .select("name, value, unit")
      .eq("lab_report_id", previousReportId);

    const biomarkerChangesAll: BiomarkerChange[] = (currentBiomarkers || [])
      .map((current: BiomarkerData) => {
        const previous = (previousBiomarkers || []).find(
          (p: BiomarkerData) => normalizeName(p.name) === normalizeName(current.name)
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
          } as BiomarkerChange;
        }
        return null;
      })
      .filter((x): x is BiomarkerChange => Boolean(x));

    const significantChanges = biomarkerChangesAll.filter(isSignificantChange);
    const mostNotable = topChanges(significantChanges.length > 0 ? significantChanges : biomarkerChangesAll, 12);

    // Interventions relevant to the comparison window:
    // - started before/current
    // - and active at any point between previous and current (end_date null or end_date >= previous)
    const { data: interventions } = await supabaseAuth
      .from("interventions")
      .select("title, category, start_date, end_date")
      .lte("start_date", currentReport.report_date)
      .or(`end_date.is.null,end_date.gte.${previousReport.report_date}`);

    const daysBetween = Math.floor(
      (new Date(currentReport.report_date).getTime() -
        new Date(previousReport.report_date).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    const cycleContext = {
      previous: {
        phase: previousReport.estimated_cycle_phase ?? null,
        day: previousReport.estimated_cycle_day ?? null,
      },
      current: {
        phase: currentReport.estimated_cycle_phase ?? null,
        day: currentReport.estimated_cycle_day ?? null,
      },
    };

    const prompt = `You are a health education assistant analyzing lab results over time.
Provide educational insights only — never diagnose, prescribe, or claim certainty.

Previous lab: ${new Date(previousReport.report_date).toLocaleDateString()}
Current lab: ${new Date(currentReport.report_date).toLocaleDateString()}
Time between labs: ${daysBetween} days

Most notable biomarker changes (focus on significance; do not mention every small change):
${mostNotable.map((bc) => `- ${bc.name}: ${bc.previous_value} → ${bc.current_value} ${bc.unit} (${bc.delta > 0 ? '+' : ''}${bc.delta.toFixed(1)}, ${bc.percent_change.toFixed(0)}%)`).join('\n')}

All significant changes count: ${significantChanges.length}

Cycle context (if available; use only as possible context, not as an explanation):
- Previous cycle phase/day: ${cycleContext.previous.phase ?? 'unknown'} / ${cycleContext.previous.day ?? 'unknown'}
- Current cycle phase/day: ${cycleContext.current.phase ?? 'unknown'} / ${cycleContext.current.day ?? 'unknown'}

Tracked interventions active during this window:
${interventions && interventions.length > 0 ? (interventions as InterventionRow[]).map((i) => `- ${i.title} (${i.category}) start ${i.start_date}${i.end_date ? `, end ${i.end_date}` : ''}`).join('\n') : 'None tracked'}

Please provide:
1) A brief summary (2–4 sentences) that highlights the most meaningful changes and what they may imply generally.
2) Notable changes: include 3–6 items max. Prefer bigger changes and clinically-relevant markers.
3) Possible factors: keep it cautious. Mention interventions as hypotheses ("may", "could").
4) Questions to ask a healthcare provider.
5) General next steps (non-prescriptive, educational). Keep it practical.

Format as JSON:
{
  "summary": "string",
  "notable_changes": [{"biomarker": "string", "change": "string", "possible_factors": ["string"]}],
  "questions_to_ask": ["string"],
  "next_steps_general": ["string"]
}

Remember:
- Use cautious, educational language.
- Avoid diagnosis, treatment advice, or urgency language.
- If cycle context is present, treat it as possible context only.
- Keep explanations accessible and action-neutral ("consider discussing", "ask about").`;

    const openaiResponse = await fetchWithBackoff(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
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
      },
      { attemptTimeoutMs: 18000 },
    );

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.statusText}`);
    }

    const openaiData = await openaiResponse.json();

    /*
      Previously: `JSON.parse(openaiData.choices[0].message.content)` straight
      into the response body. That threw a TypeError on an empty `choices`
      array, and — worse — shipped unvalidated model output to the client. A
      `notable_changes` element missing its `change` field crashes
      InsightsModal's ChangeIcon, which blanks the whole app because
      ErrorBoundary is mounted at the root. The shipped 1.0.3 native builds have
      that unguarded call and cannot be updated, so the guarantee has to be made
      here.
    */
    const insights = parseLabInsightsCompletion(openaiData);
    if (!insights) {
      console.error("[lab-insights] Unusable model response");
      return new Response(
        JSON.stringify({ error: "Could not generate insights. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
  } catch (error: unknown) {
    console.error("Error generating insights:", error);
    if (isRateLimitExceeded(error)) {
      return new Response(
        JSON.stringify({ error: "Rate limit reached. Please try again tomorrow." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const message = errorMessage(error, "Failed to generate insights");
    return new Response(
      JSON.stringify({
        error: message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
