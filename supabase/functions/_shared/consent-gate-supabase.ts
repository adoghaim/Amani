/**
 * Wires the consent gate (consent.ts) to a service-role Supabase client, once
 * per isolate, so the flag cache survives between requests (PK-CONSENT-01).
 *
 * Structural types only: no Supabase or Deno import, so Vitest drives it with
 * a fake client. A handler calls it after authenticating the user:
 *
 *   const refusal = consentRefusal(await consentGateFor(supabaseAdmin).check(user.id));
 *   if (refusal) return new Response(JSON.stringify(refusal.body), { status: refusal.status, headers });
 */
import { createConsentGate, type ConsentGate, type ConsentGateActions } from "./consent.ts";

interface PostgrestReply {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

/** The slice of a PostgREST query builder this module uses. */
export interface ConsentQuery extends PromiseLike<PostgrestReply> {
  select(columns: string): ConsentQuery;
  eq(column: string, value: string): ConsentQuery;
  abortSignal(signal: AbortSignal): ConsentQuery;
}

export interface ConsentDbClient {
  from(table: string): ConsentQuery;
}

function failure(what: string, error: { message?: string; code?: string }): Error {
  return new Error(`${what} failed: ${error.message ?? "unknown error"}`, { cause: error });
}

export function supabaseConsentActions(admin: ConsentDbClient): ConsentGateActions {
  return {
    async readPublicConfig(signal) {
      const { data, error } = await admin.from("app_public_config").select("key,value").abortSignal(signal);
      if (error) throw failure("Reading app_public_config", error);
      return data;
    },
    async readCurrentConsents(userId, signal) {
      const { data, error } = await admin
        .from("consent_current")
        .select("consent_type,version,granted")
        .eq("user_id", userId)
        .abortSignal(signal);
      if (error) throw failure("Reading consent_current", error);
      return data;
    },
    now: () => Date.now(),
    onError: (error) => console.error("consent gate read failed", error),
  };
}

let gate: ConsentGate | null = null;

/** The isolate's consent gate, built on the first call's client. */
export function consentGateFor(admin: ConsentDbClient): ConsentGate {
  gate ??= createConsentGate(supabaseConsentActions(admin));
  return gate;
}

/** Tests only: forget the isolate's gate. */
export function resetConsentGateForTests(): void {
  gate = null;
}
