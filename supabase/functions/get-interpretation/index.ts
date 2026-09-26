import { createClient } from "npm:@supabase/supabase-js@2";
import { checkUserSubscription } from "../_shared/subscription-guard.ts";
import { readInterpretation, type InterpretationReadActions } from "../_shared/interpretation-read.ts";

const headers = { "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ code: "method_not_allowed" }), { status: 405, headers });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return new Response(JSON.stringify({ code: "unauthorized" }), { status: 401, headers });
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return new Response(JSON.stringify({ code: "unauthorized" }), { status: 401, headers });
  const body = await req.json().catch(() => null);
  if (typeof body?.reportId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.reportId)) {
    return new Response(JSON.stringify({ code: "invalid_report_id" }), { status: 400, headers });
  }
  // Service credentials are used only for the projection-selecting RPC. This
  // endpoint never selects json_output from private storage or trusts a caller's plan.
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const result = await readInterpretation({
    async ownsReport() {
      const { data, error } = await userClient.from("lab_reports").select("id")
        .eq("id", body.reportId).eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      return data !== null;
    },
    resolveEntitlement: () => checkUserSubscription(userClient, user.id, true, true),
    async readSelected(premium) {
      const { data, error } = await service.rpc("read_interpretation_for_server", {
        p_user_id: user.id, p_report_id: body.reportId, p_premium: premium,
      }).maybeSingle<NonNullable<Awaited<ReturnType<InterpretationReadActions["readSelected"]>>>>();
      if (error) throw error;
      return data;
    },
    async countClaims() {
      const { count, error } = await userClient.from("introductory_deep_access_claims")
        .select("*", { count: "exact", head: true }).eq("user_id", user.id);
      if (error || count === null) throw error ?? new Error("Missing claim count");
      return count;
    },
  });
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
});
