/**
 * Server runtime config: reading `public.app_server_config` from edge functions
 * (PK-CFG-01; owner decisions R1, D5.1, D5.2, D7.6).
 *
 * Holds the AI kill switch, the monthly AI budget and the budget alert
 * thresholds. The owner changes them with SQL (docs/runtime-config.md); every
 * change is audited in app_config_audit.
 *
 * Read policy, owner decision D5.1:
 *   - A value read within the last 5 minutes (RUNTIME_CONFIG_TTL_MS) is used as
 *     is, so a change reaches every warm function within the TTL.
 *   - When a read fails, the kill switch keeps the LAST CACHED value.
 *   - On a cold start with no cached value, a failed read leaves AI ON. The
 *     existing per-user caps still apply.
 *   - After a failure the next read waits RUNTIME_CONFIG_RETRY_AFTER_FAILURE_MS,
 *     so an outage costs at most one slow request per isolate per interval
 *     rather than one per request.
 *   - A read that has not answered within RUNTIME_CONFIG_READ_TIMEOUT_MS counts
 *     as failed and is aborted.
 * The budget is alert-only (D5.2, D7.6): nothing here turns AI off but the
 * manual kill switch.
 *
 * Pure: no Deno, no Supabase client, no clock. The read and the clock are the
 * `RuntimeConfigActions` port, so Vitest drives every branch with fakes. A
 * function wires it once per isolate, at module scope, so the cache survives
 * between requests:
 *
 *   const runtimeConfig = createRuntimeConfigReader({
 *     async readServerConfig(signal) {
 *       const { data, error } = await admin.from("app_server_config").select("key,value").abortSignal(signal);
 *       if (error) throw error;
 *       return data;
 *     },
 *     now: () => Date.now(),
 *     onError: (error) => console.error("runtime config read failed", error),
 *   });
 *   if (!(await runtimeConfig.isAiEnabled())) { ...serve the deterministic path... }
 */

export const RUNTIME_CONFIG_TTL_MS = 5 * 60 * 1000;
export const RUNTIME_CONFIG_RETRY_AFTER_FAILURE_MS = 30 * 1000;
export const RUNTIME_CONFIG_READ_TIMEOUT_MS = 3 * 1000;

/** The alert thresholds the owner set in D5.2, used when the stored ones are missing or unreadable. */
export const DEFAULT_AI_BUDGET_ALERT_THRESHOLDS: readonly number[] = Object.freeze([0.5, 0.8, 1.0]);

export interface RuntimeConfigActions {
  /**
   * Every app_server_config row as stored (`key`, `value`), read with the
   * service role. MUST throw or reject on any failure; never answer [] for an
   * error, or "the read failed" would silently become "AI is on". Should stop
   * when `signal` aborts.
   */
  readServerConfig(signal: AbortSignal): Promise<unknown>;
  /** Milliseconds since the epoch. */
  now(): number;
  /** Told about every failed read. The failure itself is absorbed by the policy above. */
  onError?(error: unknown): void;
}

export interface ServerRuntimeConfig {
  /** True only when the owner has switched AI off. */
  readonly aiKillSwitch: boolean;
  /** US dollars per month, or null while the owner has not set one. */
  readonly aiMonthlyBudgetUsd: number | null;
  /** Fractions of the budget that raise an alert, smallest first. */
  readonly aiBudgetAlertThresholds: readonly number[];
}

/** What a cold start that cannot read the table runs with: AI on (D5.1), no budget. */
export const COLD_START_SERVER_CONFIG: ServerRuntimeConfig = Object.freeze({
  aiKillSwitch: false,
  aiMonthlyBudgetUsd: null,
  aiBudgetAlertThresholds: DEFAULT_AI_BUDGET_ALERT_THRESHOLDS,
});

const isPositiveNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * The server's reading of app_server_config rows. Throws when the reply is not
 * a list of rows (a failed read, handled by the reader). Within a readable
 * reply, a missing or malformed value takes its cold-start meaning: the kill
 * switch is on only for the boolean true.
 */
export function parseServerConfig(rows: unknown): ServerRuntimeConfig {
  if (!Array.isArray(rows)) throw new Error("runtime config: expected an array of rows");
  const values = new Map<string, unknown>();
  for (const row of rows as unknown[]) {
    if (typeof row !== "object" || row === null) continue;
    const { key, value } = row as { key?: unknown; value?: unknown };
    if (typeof key === "string") values.set(key, value);
  }
  const budget = values.get("ai_monthly_budget_usd");
  const thresholds = values.get("ai_budget_alert_thresholds");
  return Object.freeze({
    aiKillSwitch: values.get("ai_kill_switch") === true,
    aiMonthlyBudgetUsd: typeof budget === "number" && Number.isFinite(budget) && budget >= 0 ? budget : null,
    aiBudgetAlertThresholds: Array.isArray(thresholds) && thresholds.every(isPositiveNumber)
      ? Object.freeze([...thresholds].sort((a, b) => a - b))
      : DEFAULT_AI_BUDGET_ALERT_THRESHOLDS,
  });
}

export interface RuntimeConfigReader {
  /** The config under the read policy above. Never rejects. */
  serverConfig(): Promise<ServerRuntimeConfig>;
  /** False only while the kill switch is on. Never rejects. */
  isAiEnabled(): Promise<boolean>;
}

export interface RuntimeConfigReaderOptions {
  ttlMs?: number;
  retryAfterFailureMs?: number;
  readTimeoutMs?: number;
}

export function createRuntimeConfigReader(
  actions: RuntimeConfigActions,
  options: RuntimeConfigReaderOptions = {},
): RuntimeConfigReader {
  const ttlMs = options.ttlMs ?? RUNTIME_CONFIG_TTL_MS;
  const retryAfterFailureMs = options.retryAfterFailureMs ?? RUNTIME_CONFIG_RETRY_AFTER_FAILURE_MS;
  const readTimeoutMs = options.readTimeoutMs ?? RUNTIME_CONFIG_READ_TIMEOUT_MS;

  /** The last value read successfully; null until the first success. */
  let cached: ServerRuntimeConfig | null = null;
  /** No read before this instant. 0: read on first use. */
  let nextReadAt = 0;
  /** One read at a time; concurrent requests share it. */
  let inflight: Promise<ServerRuntimeConfig> | null = null;

  async function readWithTimeout(): Promise<ServerRuntimeConfig> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`runtime config read timed out after ${readTimeoutMs} ms`));
      }, readTimeoutMs);
    });
    try {
      return parseServerConfig(await Promise.race([actions.readServerConfig(controller.signal), timeout]));
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(): Promise<ServerRuntimeConfig> {
    try {
      const fresh = await readWithTimeout();
      cached = fresh;
      nextReadAt = actions.now() + ttlMs;
      return fresh;
    } catch (error) {
      nextReadAt = actions.now() + retryAfterFailureMs;
      try {
        actions.onError?.(error);
      } catch {
        // A failing reporter must not turn a handled read failure into an outage.
      }
      return cached ?? COLD_START_SERVER_CONFIG;
    }
  }

  async function serverConfig(): Promise<ServerRuntimeConfig> {
    if (inflight) return inflight;
    if (actions.now() < nextReadAt) return cached ?? COLD_START_SERVER_CONFIG;
    inflight = refresh().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return {
    serverConfig,
    async isAiEnabled() {
      return !(await serverConfig()).aiKillSwitch;
    },
  };
}
