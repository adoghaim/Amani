/**
 * The monthly AI budget check: ALERT ONLY (PK-FIX-01b; owner decisions D5.2
 * and D7.6).
 *
 * Run on a schedule by the `ai-budget-check` function (the owner schedules it;
 * docs/runtime-config.md). Each run:
 *   1. reads the budget and thresholds from app_server_config (runtime-config.ts);
 *   2. sums this UTC month's est_cost_usd from ai_call_costs, in SQL
 *      (ai_spend_for_month), so no 1,000-row page limit applies;
 *   3. records one ai_budget_alerts row per crossed threshold, once per month
 *      (unique on month and threshold, so concurrent runs cannot double-alert);
 *   4. sends a Sentry message for every alert row of this month not yet
 *      notified, and stamps it notified. A failed send is retried by the next
 *      run, because the row stays un-notified.
 *
 * NO automatic cutoff. Nothing here turns AI off; only the owner's manual
 * kill switch does (R1, D5.2). A missing budget (null) means no alerts.
 *
 * Pure: config, the spend sum, the alert rows and the notifier are the
 * `AiBudgetActions` port; the clock is passed in.
 */

import type { ServerRuntimeConfig } from "./runtime-config.ts";

/** The first day of `nowMs`'s UTC month, as YYYY-MM-DD. */
export function utcMonthStart(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * The thresholds `spendUsd` has reached. A budget of 0 is crossed by any spend
 * above 0; a null budget by nothing.
 */
export function crossedThresholds(spendUsd: number, budgetUsd: number | null, thresholds: readonly number[]): number[] {
  if (budgetUsd === null || !Number.isFinite(spendUsd) || spendUsd < 0) return [];
  return thresholds.filter(t => (budgetUsd > 0 ? spendUsd >= t * budgetUsd : spendUsd > 0));
}

export interface BudgetAlertRow {
  month: string;
  threshold: number;
  spend_usd: number;
  budget_usd: number;
}

export interface PendingBudgetAlert extends BudgetAlertRow {
  id: number;
}

export interface AiBudgetActions {
  serverConfig(): Promise<ServerRuntimeConfig>;
  /** Sum of ai_call_costs.est_cost_usd in the UTC month starting `monthStart`. Throws on failure. */
  spendForMonth(monthStart: string): Promise<number>;
  /** Insert the row unless (month, threshold) already exists. Throws on failure. */
  recordAlert(row: BudgetAlertRow): Promise<void>;
  /** This month's alert rows not yet notified, smallest threshold first. Throws on failure. */
  pendingAlerts(monthStart: string): Promise<PendingBudgetAlert[]>;
  /** Tell a human. Throws when the message was not sent. */
  notify(alert: PendingBudgetAlert): Promise<void>;
  /** Stamp the row notified. Throws on failure. */
  markNotified(id: number): Promise<void>;
}

export interface AiBudgetCheckResult {
  month: string;
  budgetUsd: number | null;
  spendUsd: number | null;
  crossed: number[];
  notified: number[];
  /** Fixed labels of what failed; empty on a clean run. */
  failures: string[];
}

/** One run of the check. Never throws: what failed is listed in `failures`, so the job can answer non-2xx. */
export async function runAiBudgetCheck(actions: AiBudgetActions, nowMs: number): Promise<AiBudgetCheckResult> {
  const month = utcMonthStart(nowMs);
  const result: AiBudgetCheckResult = { month, budgetUsd: null, spendUsd: null, crossed: [], notified: [], failures: [] };

  let config: ServerRuntimeConfig;
  try {
    config = await actions.serverConfig();
  } catch {
    result.failures.push("config_read");
    return result;
  }
  result.budgetUsd = config.aiMonthlyBudgetUsd;
  if (config.aiMonthlyBudgetUsd === null) return result;

  try {
    result.spendUsd = await actions.spendForMonth(month);
  } catch {
    result.failures.push("spend_read");
    return result;
  }

  result.crossed = crossedThresholds(result.spendUsd, config.aiMonthlyBudgetUsd, config.aiBudgetAlertThresholds);
  for (const threshold of result.crossed) {
    try {
      await actions.recordAlert({ month, threshold, spend_usd: result.spendUsd, budget_usd: config.aiMonthlyBudgetUsd });
    } catch {
      result.failures.push(`record_alert:${threshold}`);
    }
  }

  let pending: PendingBudgetAlert[];
  try {
    pending = await actions.pendingAlerts(month);
  } catch {
    result.failures.push("pending_read");
    return result;
  }
  for (const alert of pending) {
    try {
      await actions.notify(alert);
    } catch {
      result.failures.push(`notify:${alert.threshold}`);
      continue;
    }
    try {
      await actions.markNotified(alert.id);
      result.notified.push(alert.threshold);
    } catch {
      result.failures.push(`mark_notified:${alert.threshold}`);
    }
  }
  return result;
}

/** Fixed-length comparison of the scheduler's secret header; a missing secret refuses every call. */
export function isScheduledCaller(presented: string | null | undefined, secret: string | null | undefined): boolean {
  if (typeof secret !== "string" || secret.length < 16 || typeof presented !== "string") return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
}
