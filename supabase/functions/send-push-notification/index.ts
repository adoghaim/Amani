import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type PushNotificationPayload = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  kind?: "lab-ready" | "cycle-reminder" | "generic";
};

type ExpoPushResponse = {
  data?: Array<{ status: "ok" | "error"; message?: string; details?: Record<string, unknown> }>;
  errors?: Array<{ message?: string }>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isLikelyExpoPushToken(token: string | null) {
  if (!token) return false;
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    const payload = (await req.json()) as PushNotificationPayload;

    if (!payload?.userId || !payload?.title || !payload?.body) {
      return jsonResponse({ error: "userId, title, and body are required" }, 400);
    }

    const { data: prefs, error: prefsError } = await supabase
      .from("notification_preferences")
      .select("expo_push_token, lab_reminders")
      .eq("user_id", payload.userId)
      .maybeSingle();

    if (prefsError) {
      console.error("[send-push-notification] Failed loading preferences:", prefsError);
      return jsonResponse({ error: "Failed loading notification preferences" }, 500);
    }

    if (!prefs?.expo_push_token) {
      return jsonResponse({ success: true, skipped: "missing_push_token" });
    }

    if (!isLikelyExpoPushToken(prefs.expo_push_token)) {
      return jsonResponse({ success: true, skipped: "invalid_push_token" });
    }

    if (payload.kind === "lab-ready" && !prefs.lab_reminders) {
      return jsonResponse({ success: true, skipped: "lab_reminders_disabled" });
    }

    const pushBody = {
      to: prefs.expo_push_token,
      title: payload.title,
      body: payload.body,
      sound: "default",
      data: {
        kind: payload.kind ?? "generic",
        ...(payload.data ?? {}),
      },
    };

    const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(pushBody),
    });

    const expoResult = (await expoResponse.json()) as ExpoPushResponse;

    if (!expoResponse.ok) {
      console.error("[send-push-notification] Expo push failed:", expoResponse.status, expoResult);
      return jsonResponse({ error: "Expo push send failed", details: expoResult }, 502);
    }

    const firstResult = expoResult?.data?.[0];
    if (firstResult?.status === "error") {
      return jsonResponse({ error: firstResult.message ?? "Expo push returned an error", details: firstResult.details }, 502);
    }

    return jsonResponse({ success: true, result: expoResult });
  } catch (error) {
    console.error("[send-push-notification] Unexpected error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
