/**
 * Deno wiring for the PK-FIX-01b backend guards: the error reporter, the AI
 * cost ledger and the AI kill switch, as the AI functions use them.
 *
 * Wiring only. Every policy is in a pure module with its own Vitest suite:
 *   error-reporter.ts + phi-scrub.ts   what an error report carries, and that it never blocks
 *   ai-cost-ledger.ts                   the ai_call_costs row and its cost estimate
 *   runtime-config.ts + ai-pause.ts     the kill-switch read (D5.1) and what a pause does
 *
 * Everything here is created once per isolate, at module scope, so the
 * runtime-config cache survives between requests (5-minute TTL).
 *
 * Secrets read (names only): SENTRY_DSN (optional; unset = reporting off),
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional SENTRY_ENVIRONMENT and
 * SENTRY_RELEASE label the events.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchWithBackoff } from "./fetchWithBackoff.ts";
import {
  createErrorReporter,
  type ErrorReporter,
  SENTRY_TELEMETRY_TIMEOUT_MS,
  SENTRY_TELEMETRY_TRIES,
} from "./error-reporter.ts";
import { type AiCostLedger, type AiFunctionName, createAiCostLedger } from "./ai-cost-ledger.ts";
import { createRuntimeConfigReader, type RuntimeConfigReader } from "./runtime-config.ts";
import { isAiPaused } from "./ai-pause.ts";

let serviceClient: SupabaseClient | null = null;

/** The service-role client the guards write and read with. */
export function guardServiceClient(): SupabaseClient {
  serviceClient ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return serviceClient;
}

declare const EdgeRuntime: { waitUntil?(promise: Promise<unknown>): void } | undefined;

/** Lets a telemetry promise finish after the response without holding the response. */
export function inBackground(promise: Promise<unknown>): void {
  const settled = promise.catch(() => {});
  try {
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") {
      EdgeRuntime.waitUntil(settled);
    }
  } catch {
    // No background hook: the promise still runs, unawaited.
  }
}

export function edgeErrorReporter(functionName: string): ErrorReporter {
  return createErrorReporter(functionName, {
    dsn: Deno.env.get("SENTRY_DSN"),
    environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "edge",
    release: Deno.env.get("SENTRY_RELEASE") ?? undefined,
    async send(url, headers, body) {
      // Telemetry (R5, D8/D10): one try, 3 s, and a failure is swallowed by the reporter.
      const res = await fetchWithBackoff(url, { method: "POST", headers, body }, {
        tries: SENTRY_TELEMETRY_TRIES,
        attemptTimeoutMs: SENTRY_TELEMETRY_TIMEOUT_MS,
      });
      await res.body?.cancel().catch(() => {});
      if (!res.ok) throw new Error(`Sentry answered ${res.status}`);
    },
    now: () => Date.now(),
    newEventId: () => crypto.randomUUID().replace(/-/g, ""),
    onError: () => console.warn(`[${functionName}] error report not sent`),
  });
}

export function edgeAiCostLedger(functionName: AiFunctionName): AiCostLedger {
  return createAiCostLedger({
    async insert(row) {
      const { error } = await guardServiceClient().from("ai_call_costs").insert(row);
      if (error) throw new Error(error.message);
    },
    onError: () => console.warn(`[${functionName}] ai_call_costs insert failed`),
  });
}

let runtimeConfig: RuntimeConfigReader | null = null;

/** The isolate's runtime-config reader (D5.1: 5-minute cache, last value on failure, cold start = AI on). */
export function edgeRuntimeConfig(): RuntimeConfigReader {
  runtimeConfig ??= createRuntimeConfigReader({
    async readServerConfig(signal) {
      const { data, error } = await guardServiceClient()
        .from("app_server_config").select("key,value").abortSignal(signal);
      if (error) throw new Error(error.message);
      return data;
    },
    now: () => Date.now(),
    onError: () => console.warn("[runtime-config] app_server_config read failed; using the D5.1 fallback"),
  });
  return runtimeConfig;
}

/** True while the owner's kill switch is on. Never rejects. */
export function aiPausedNow(): Promise<boolean> {
  return isAiPaused(edgeRuntimeConfig());
}
