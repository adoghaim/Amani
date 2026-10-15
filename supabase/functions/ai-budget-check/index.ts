import "jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts";
import { parseServerConfig } from "../_shared/runtime-config.ts";
import { isScheduledCaller, runAiBudgetCheck, type PendingBudgetAlert } from "../_shared/ai-budget.ts";
import { edgeErrorReporter, guardServiceClient } from "../_shared/edge-ai-guards.ts";

/*
  The scheduled AI budget check (PK-FIX-01b; owner decisions D5.2, D7.6):
  ALERT ONLY, never a cutoff. The policy is ../_shared/ai-budget.ts; this
  handler is its wiring.

  Called by the owner's scheduler (docs/runtime-config.md, "AI budget alerts"),
  not by the app. It authenticates the caller itself with the
  x-amani-scheduler-secret header against the AI_BUDGET_CHECK_SECRET secret
  (names only), and refuses every call while that secret is unset.

  Answers 200 when the run was clean, 500 (with fixed failure labels only)
  when any step failed, so the scheduler's own run history shows a broken job.
*/

const headers = { "Content-Type": "application/json" };
const reporter = edgeErrorReporter("ai-budget-check");

function alertMessage(alert: PendingBudgetAlert): string {
  return `AI budget alert: month-to-date AI spend has reached ${Math.round(alert.threshold * 100)} percent of the monthly budget`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ code: "method_not_allowed" }), { status: 405, headers });
  if (!isScheduledCaller(req.headers.get("x-amani-scheduler-secret"), Deno.env.get("AI_BUDGET_CHECK_SECRET"))) {
    return new Response(JSON.stringify({ code: "unauthorized" }), { status: 401, headers });
  }

  const service = guardServiceClient();
  const result = await runAiBudgetCheck({
    async serverConfig() {
      // Read directly, not through the cached reader: a failed read here must
      // fail the run, not fall back to "no budget".
      const { data, error } = await service.from("app_server_config").select("key,value");
      if (error) throw new Error(error.message);
      return parseServerConfig(data);
    },
    async spendForMonth(monthStart) {
      const { data, error } = await service.rpc("ai_spend_for_month", { p_month: monthStart });
      if (error) throw new Error(error.message);
      const spend = Number(data ?? 0);
      if (!Number.isFinite(spend)) throw new Error("spend is not a number");
      return spend;
    },
    async recordAlert(row) {
      const { error } = await service.from("ai_budget_alerts")
        .upsert(row, { onConflict: "month,threshold", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    },
    async pendingAlerts(monthStart) {
      const { data, error } = await service.from("ai_budget_alerts")
        .select("id, month, threshold, spend_usd, budget_usd")
        .eq("month", monthStart).is("notified_at", null)
        .order("threshold", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
        id: Number(r.id), month: String(r.month), threshold: Number(r.threshold),
        spend_usd: Number(r.spend_usd), budget_usd: Number(r.budget_usd),
      }));
    },
    async notify(alert) {
      if (!reporter.enabled) throw new Error("SENTRY_DSN is not set; the alert has nowhere to go");
      // Numbers travel as tags: the message text is scrubbed of numbers like any other.
      const delivered = await reporter.captureMessage(alertMessage(alert), alert.threshold >= 1 ? "error" : "warning", {
        stage: "ai_budget_alert",
        tags: {
          ai_budget_threshold: alert.threshold,
          ai_budget_month: alert.month,
          ai_spend_usd: alert.spend_usd.toFixed(2),
          ai_budget_usd: alert.budget_usd.toFixed(2),
        },
      });
      // Not delivered: the row stays un-notified and the next run sends it again.
      if (!delivered) throw new Error("the alert was not delivered");
    },
    async markNotified(id) {
      const { error } = await service.from("ai_budget_alerts")
        .update({ notified_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
    },
  }, Date.now());

  return new Response(JSON.stringify({
    month: result.month,
    budget_set: result.budgetUsd !== null,
    crossed: result.crossed,
    notified: result.notified,
    failures: result.failures,
  }), { status: result.failures.length ? 500 : 200, headers });
});
