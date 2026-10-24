import "jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.3";
import { fetchWithBackoff } from "../_shared/fetchWithBackoff.ts";
import { errorType, scrubbedErrorMessage } from "../_shared/phi-scrub.ts";
import { chatCompletionParams, reasoningEffortParams, resolveOpenAiModel } from "../_shared/openai-models.ts";
import { enforceLabInsightsPolicy, labInsightsPolicyPrompt, MAX_PROMPT_INTERVENTIONS, promptInterventionLabel } from "../_shared/lab-insights-policy.ts";
import { redactLabText } from "../_shared/lab-text-redaction.ts";
import { consentRefusal } from "../_shared/consent.ts";
import { consentGateFor } from "../_shared/consent-gate-supabase.ts";
import { LabInsightsRequestSchema } from "../_shared/schemas/requests.ts";
import { entitlementUnavailable, premiumRequired } from "../_shared/entitlement-response.ts";
import { checkUserSubscription } from "../_shared/subscription-guard.ts";
import { parseLabInsightsCompletion } from "../_shared/lab-insights-output.ts";
import { enforceRateLimit, isRateLimitExceeded } from "../_shared/rate-limit.ts";
import { createRateLimitStore } from "../_shared/rate-limit-store.ts";
import {
  compareStoredBiomarkers, isSignificantChange, STORED_BIOMARKER_COLUMNS, topChanges, type BiomarkerChange,
} from "../_shared/trend-evidence.ts";
import { aiPausedBody } from "../_shared/ai-pause.ts";
import { aiPausedNow, edgeAiCostLedger, edgeErrorReporter, inBackground } from "../_shared/edge-ai-guards.ts";

// PK-FIX-01b: error capture (PHI-scrubbed, never blocking), the cross-function
// AI cost ledger, and the kill switch. Once per isolate.
const reporter = edgeErrorReporter("lab-insights");
const costLedger = edgeAiCostLedger("lab-insights");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type InterventionRow = {
  title: string;
  category: string;
  start_date: string;
  end_date?: string | null;
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
    if (premiumRequired(subCheck)) {
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

    // PK-FIX-01b (D12): while the owner's kill switch is on, no model call: 503
    // with the calm paused body. Before the rate limit, so it spends no quota.
    if (await aiPausedNow()) {
      return new Response(JSON.stringify(aiPausedBody()), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // PK-CONSENT-01: while features.consent_gate is on, uploads and AI processing
    // need her current consent (_shared/consent.ts). Off, this always allows.
    const consentRefused = consentRefusal(await consentGateFor(supabase).check(userId));
    if (consentRefused) {
      return new Response(JSON.stringify(consentRefused.body), {
        status: consentRefused.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      .select(STORED_BIOMARKER_COLUMNS)
      .eq("lab_report_id", currentReportId);

    const { data: previousBiomarkers } = await supabaseAuth
      .from("biomarkers")
      .select(STORED_BIOMARKER_COLUMNS)
      .eq("lab_report_id", previousReportId);

    // Same pairing rule as generation's stored trend evidence (_shared/trend-evidence.ts);
    // a censored result ('<8') is never compared or prompted with (F021).
    const biomarkerChangesAll: BiomarkerChange[] = compareStoredBiomarkers(
      currentBiomarkers || [],
      previousBiomarkers || [],
    );

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
${interventions && interventions.length > 0 ? (interventions as InterventionRow[]).slice(0, MAX_PROMPT_INTERVENTIONS).map((i) => `- ${promptInterventionLabel(i.title, i.category)} (${i.category}) start ${i.start_date}${i.end_date ? `, end ${i.end_date}` : ''}`).join('\n') : 'None tracked'}

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
- Keep explanations accessible and action-neutral ("consider discussing", "ask about").

${labInsightsPolicyPrompt()}`;

    const model = resolveOpenAiModel("labInsights", (name) => Deno.env.get(name));

    const openaiResponse = await fetchWithBackoff(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: "You are a health education assistant. Provide educational insights only. Never diagnose or prescribe treatment.",
            },
            {
              role: "user",
              // PK-PRIV-01: identifiers out before the prompt leaves for OpenAI.
              content: redactLabText(prompt).text,
            },
          ],
          // gpt-5-mini is a reasoning model: it rejects temperature (F131), and its
          // limit is max_completion_tokens. The rules live with the model id.
          ...chatCompletionParams(model, { maxOutputTokens: 3000, temperature: 0.7 }),
          response_format: { type: "json_object" },
          store: false,
          ...reasoningEffortParams("labInsights", model, (name) => Deno.env.get(name)),
        }),
      },
      { attemptTimeoutMs: 18000 },
    );

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: status ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    inBackground(costLedger.record({
      functionName: "lab-insights",
      userId,
      model: typeof openaiData?.model === "string" ? openaiData.model : model,
      usage: openaiData?.usage,
    }));

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
    const parsedInsights = parseLabInsightsCompletion(openaiData);
    // F017: the nutrient policy over every returned string. A violating summary
    // refuses the answer (null), exactly like an unusable completion.
    const insights = parsedInsights ? enforceLabInsightsPolicy(parsedInsights) : null;
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
    // F033: details go to the log scrubbed; the client gets a fixed message.
    console.error("Error generating insights:", errorType(error), scrubbedErrorMessage(error));
    if (isRateLimitExceeded(error)) {
      return new Response(
        JSON.stringify({ error: "Rate limit reached. Please try again tomorrow." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    inBackground(reporter.captureException(error, { stage: "insights" }));
    return new Response(
      JSON.stringify({
        error: "Failed to generate insights",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
