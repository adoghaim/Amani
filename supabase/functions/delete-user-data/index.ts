import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { errorMessage } from "../_shared/errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type ReportFileRow = { file_url: string | null };
type ReportIdRow = { id: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

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

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: reports } = await supabase
      .from("lab_reports")
      .select("file_url")
      .eq("user_id", user.id);

    if (reports && reports.length > 0) {
      const storagePaths = (reports as ReportFileRow[])
        .filter((r) => r.file_url && r.file_url.startsWith(user.id))
        .map((r) => r.file_url as string);

      if (storagePaths.length > 0) {
        await supabase.storage.from("lab-files").remove(storagePaths);
      }
    }

    await supabase.from("interventions").delete().eq("user_id", user.id);
    await supabase.from("cycle_events").delete().eq("user_id", user.id);

    const { data: reportIds } = await supabase
      .from("lab_reports")
      .select("id")
      .eq("user_id", user.id);

    if (reportIds && reportIds.length > 0) {
      const ids = (reportIds as ReportIdRow[]).map((r) => r.id);
      await supabase.from("interpretations").delete().in("lab_report_id", ids);
      await supabase.from("biomarkers").delete().in("lab_report_id", ids);
      await supabase.from("report_items").delete().in("lab_report_id", ids);
      await supabase.from("report_analytes").delete().in("lab_report_id", ids);
    }

    await supabase.from("parser_debug").delete().eq("user_id", user.id);
    await supabase.from("lab_reports").delete().eq("user_id", user.id);
    await supabase.from("period_logs").delete().eq("user_id", user.id);
    await supabase.from("symptom_logs").delete().eq("user_id", user.id);
    await supabase.from("notification_preferences").delete().eq("user_id", user.id);
    await supabase.from("reminders").delete().eq("user_id", user.id);
    await supabase.from("audit_events").delete().eq("user_id", user.id);
    await supabase.from("rate_limits").delete().eq("user_id", user.id);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error deleting user data:", error);
    const message = errorMessage(error, "Failed to delete data");
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
