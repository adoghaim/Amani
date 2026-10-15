/**
 * log-anon-event (PK-EXP5, owner decision D5.3): the only way a pre-signup
 * event (landing_view, signup_started) reaches the ledger. No JWT required;
 * there is no anon-callable RPC.
 *
 * Wiring only. Validation, the hashed-IP rate limit, the global daily cap and
 * the service-role insert are ../_shared/app-events.ts (handleAnonEvent),
 * tested in app-events.test.ts. The raw IP never leaves this request: only its
 * salted, daily-rotating hash is used as a counter key, and it is never logged.
 *
 * Secret (name only): ANON_EVENT_IP_SALT_SECRET. Unset, every request answers
 * 503 and nothing is written.
 */

import "jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.3";
import {
  ANON_EVENT_MAX_BODY_BYTES,
  ANON_EVENT_SALT_SECRET_NAME,
  clientIp,
  createAnonEventActions,
  handleAnonEvent,
} from "../_shared/app-events.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const actions = createAnonEventActions(
  row => supabase.from("app_events").insert(row),
  (fn, args) => supabase.rpc(fn, args),
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method not allowed" }, { status: 405, headers: corsHeaders });
  }

  // A declared oversize body is refused unread; handleAnonEvent re-checks the bytes it is given.
  if (Number(req.headers.get("content-length") ?? "0") > ANON_EVENT_MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "body too large" }, { status: 413, headers: corsHeaders });
  }

  const result = await handleAnonEvent(actions, {
    bodyText: await req.text(),
    ip: clientIp(req.headers.get("x-forwarded-for")),
    secret: Deno.env.get(ANON_EVENT_SALT_SECRET_NAME),
  });
  return Response.json(result.body, { status: result.status, headers: corsHeaders });
});
