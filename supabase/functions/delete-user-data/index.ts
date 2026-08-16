import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.7.0";
import { errorMessage } from "../_shared/errors.ts";
import { deleteUserAccount, type AccountDeletionActions } from "../_shared/account-deletion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Stripe error code returned when a resource is already gone. Treated as
// success on retries so a partially-completed deletion can finish.
const STRIPE_RESOURCE_MISSING = "resource_missing";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: "2024-11-20.acacia" }) : null;

    const actions: AccountDeletionActions = {
      async getStripeCustomerId(userId) {
        // Prefer stripe_customers (current); fall back to users.stripe_customer_id (legacy).
        const { data: linked } = await supabase
          .from("stripe_customers")
          .select("customer_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (linked?.customer_id) return linked.customer_id as string;

        const { data: legacy } = await supabase
          .from("users")
          .select("stripe_customer_id")
          .eq("id", userId)
          .maybeSingle();
        return (legacy?.stripe_customer_id as string | null) ?? null;
      },

      async cancelStripeSubscriptions(customerId) {
        if (!stripe) return; // Stripe not configured — nothing to cancel.
        const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
        const active = subs.data.filter((s) =>
          s.status === "active" || s.status === "trialing" || s.status === "past_due" || s.status === "unpaid"
        );
        for (const sub of active) {
          try {
            await stripe.subscriptions.cancel(sub.id);
          } catch (err: unknown) {
            const code = (err as { code?: string }).code;
            if (code !== STRIPE_RESOURCE_MISSING) throw err;
          }
        }
      },

      async deleteStripeCustomer(customerId) {
        if (!stripe) return;
        try {
          await stripe.customers.del(customerId);
        } catch (err: unknown) {
          const code = (err as { code?: string }).code;
          if (code !== STRIPE_RESOURCE_MISSING) throw err;
        }
      },

      async deleteLocalStripeRecords(userId, customerId) {
        // Hard-delete both current and legacy links so a subsequent orphan
        // webhook cannot re-associate to this user. Rows may already be gone
        // on retry — .delete() on zero matches is a no-op, not an error.
        const results = await Promise.all([
          supabase.from("stripe_subscriptions").delete().eq("customer_id", customerId),
          supabase.from("stripe_orders").delete().eq("customer_id", customerId),
          supabase.from("stripe_customers").delete().eq("user_id", userId),
          supabase.from("users").update({ stripe_customer_id: null, stripe_subscription_id: null }).eq("id", userId),
        ]);
        const failed = results.find((r) => r.error);
        if (failed?.error) throw new Error(`Local Stripe record cleanup failed: ${failed.error.message}`);
      },

      async deleteStorageFiles(userId) {
        // List every object under the user's prefix rather than trusting the
        // file_url column — catches orphaned uploads that never made it into
        // lab_reports (e.g., upload succeeded but the DB insert failed).
        const { data: files, error: listError } = await supabase.storage.from("lab-files").list(userId, { limit: 1000 });
        if (listError) throw new Error(`Storage list failed: ${listError.message}`);
        if (!files || files.length === 0) return;
        const paths = files.map((f) => `${userId}/${f.name}`);
        const { error: removeError } = await supabase.storage.from("lab-files").remove(paths);
        if (removeError) throw new Error(`Storage remove failed: ${removeError.message}`);
      },

      async deleteDataTables(userId) {
        // Two phases: rows keyed on lab_report_id first (so lab_reports can
        // then be swept), then rows keyed on user_id directly.
        const { data: reportIds, error: reportsListError } = await supabase
          .from("lab_reports")
          .select("id")
          .eq("user_id", userId);
        if (reportsListError) throw new Error(`Reading lab_reports failed: ${reportsListError.message}`);
        const ids = ((reportIds ?? []) as Array<{ id: string }>).map((r) => r.id);

        if (ids.length > 0) {
          const perReport = await Promise.all([
            supabase.from("interpretations").delete().in("lab_report_id", ids),
            supabase.from("biomarkers").delete().in("lab_report_id", ids),
            supabase.from("report_items").delete().in("lab_report_id", ids),
            supabase.from("report_analytes").delete().in("lab_report_id", ids),
          ]);
          const failedChild = perReport.find((r) => r.error);
          if (failedChild?.error) throw new Error(`Report-child cleanup failed: ${failedChild.error.message}`);
        }

        // Tables keyed on user_id. Do these serially so a specific failure
        // surfaces cleanly in the thrown message rather than getting lost in
        // a Promise.all rejection.
        const tables: string[] = [
          "interventions",
          "cycle_events",
          "parser_debug",
          "lab_reports",
          "period_logs",
          "symptom_logs",
          "notification_preferences",
          "reminders",
          "audit_events",
          "rate_limits",
        ];
        for (const table of tables) {
          const { error } = await supabase.from(table).delete().eq("user_id", userId);
          if (error) throw new Error(`Deleting ${table} failed: ${error.message}`);
        }

        // The user's profile row itself. Kept last so the above cleanups can
        // still reference the id if any FK were to require it (none currently
        // do, but the ordering is intentional).
        const { error: profileError } = await supabase.from("users").delete().eq("id", userId);
        if (profileError) throw new Error(`Deleting users row failed: ${profileError.message}`);
      },

      async deleteAuthUser(userId) {
        const { error } = await supabase.auth.admin.deleteUser(userId);
        if (error) throw new Error(`Auth deletion failed: ${error.message}`);
      },
    };

    await deleteUserAccount(actions, user.id);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Error deleting user account:", error);
    return new Response(
      JSON.stringify({ error: errorMessage(error, "Failed to delete account"), retry: true }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
