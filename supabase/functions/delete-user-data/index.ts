import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.7.0";
import { errorMessage } from "../_shared/errors.ts";
import { fetchWithBackoff } from "../_shared/fetchWithBackoff.ts";
import {
  deleteUserAccount,
  StoreSubscriptionAcknowledgementRequiredError,
  type AccountDeletionActions,
  type StoreSubscriptionRecord,
} from "../_shared/account-deletion.ts";
import { createStoreTeardownActions } from "../_shared/store-teardown.ts";

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

    // Play cancellation and RevenueCat customer deletion. Every request, its
    // timeout and retry policy (STORE_REQUEST_POLICY) and its failure policy
    // live in ../_shared/store-teardown.ts; each step is off while its secret
    // is unset.
    const storeTeardown = createStoreTeardownActions({
      env: (name) => Deno.env.get(name),
      http: fetchWithBackoff,
      now: () => Date.now(),
      log: (level, message) => console[level](`[delete-user-data] ${message}`),
    });

    const actions: AccountDeletionActions = {
      async listStoreSubscriptions(userId) {
        // Unfiltered on purpose — which statuses still bill is policy, and it
        // lives in ../_shared/account-deletion.ts where it can be tested.
        const { data, error } = await supabase
          .from("iap_subscriptions")
          .select("platform, product_id, store_subscription_id, status, expires_at, environment")
          .eq("user_id", userId);

        /*
          Fail rather than assume "no subscriptions". A read error here would
          otherwise skip the warning entirely and delete the account of someone
          Apple is still charging — the exact outcome this check exists for.
        */
        if (error) throw new Error(`Reading iap_subscriptions failed: ${error.message}`);
        return (data ?? []) as StoreSubscriptionRecord[];
      },

      // When each runs is decided in ../_shared/account-deletion.ts.
      cancelPlaySubscriptions: storeTeardown.cancelPlaySubscriptions,
      deleteRevenueCatSubscriber: storeTeardown.deleteRevenueCatSubscriber,

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
        // Two phases: the user's report graphs first, then rows keyed on
        // user_id directly.
        const { data: reportIds, error: reportsListError } = await supabase
          .from("lab_reports")
          .select("id")
          .eq("user_id", userId);
        if (reportsListError) throw new Error(`Reading lab_reports failed: ${reportsListError.message}`);
        const ids = ((reportIds ?? []) as Array<{ id: string }>).map((r) => r.id);

        // One awaited call erases every report graph: the lab_reports rows in id
        // lock order, cascading to biomarkers, report_items, report_analytes,
        // interpretations and versions. Nothing else touches that graph while it
        // runs; the old concurrent child deletes are what deadlocked against it.
        if (ids.length > 0) {
          const { error: eraseError } = await supabase.rpc("erase_reports", { p_report_ids: ids });
          if (eraseError) throw new Error(`Report erasure failed: ${eraseError.message}`);
        }

        // Tables keyed on user_id. Do these serially so a specific failure
        // surfaces cleanly in the thrown message rather than getting lost in
        // a Promise.all rejection.
        const tables: string[] = [
          "interventions",
          "cycle_events",
          "parser_debug",
          // Introductory Deep Access ledger. Also reachable via the CASCADE on
          // users.id, but swept explicitly so erasure does not depend on the
          // order the auth identity happens to go in.
          "introductory_deep_access_claims",
          // Complimentary grant. Also reachable via the CASCADE on users.id,
          // but swept explicitly so erasure does not depend on FK ordering.
          "complimentary_entitlements",
          "lab_reports",
          "period_logs",
          "symptom_logs",
          "notification_preferences",
          "reminders",
          "audit_events",
          "rate_limits",
          // Sandbox-IAP beta allowlist. See the note below on why this one is
          // swept explicitly while `iap_subscriptions` is not.
          "iap_beta_testers",
        ];
        for (const table of tables) {
          const { error } = await supabase.from(table).delete().eq("user_id", userId);
          if (error) throw new Error(`Deleting ${table} failed: ${error.message}`);
        }

        /*
          `iap_subscriptions` is deliberately absent from the list above.

          Every table listed there also has ON DELETE CASCADE on auth.users;
          they are deleted explicitly anyway so that a user's *health data* is
          gone even if the final auth deletion fails. That reasoning does not
          transfer to entitlement rows: deleting them early and then failing at
          deleteAuthUser would leave a live account with its subscription record
          erased — a paying customer locked out of what they bought, by the
          cleanup meant to help them.

          So it rides the cascade instead (see
          20260821000000_add_iap_subscriptions.sql:26 — user_id REFERENCES
          auth.users(id) ON DELETE CASCADE), which fires at the one moment the
          account genuinely ceases to exist.

          `iap_beta_testers` IS in the list above, and the difference is what
          the row would cost if deletion then failed halfway. An erased
          `iap_subscriptions` row locks a paying customer out of something they
          bought. An erased beta row costs a tester the sandbox exception and
          nothing else — they still have their trial and any real purchase — and
          it is one service-role insert to restore. Meanwhile leaving it behind
          is the worse outcome of the two: a live pass for an account that no
          longer exists, which is exactly the "beta pass that outlives the beta"
          the table's own comment warns about. It also cascades on
          auth.users, so the explicit delete is belt-and-braces rather than the
          only mechanism.
        */

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

    // Body is optional — a client that sends nothing simply hasn't acknowledged.
    const body = await req.json().catch(() => ({}));
    const acknowledged = body?.acknowledge_store_subscriptions === true;

    await deleteUserAccount(actions, user.id, {
      acknowledgedStoreSubscriptions: acknowledged,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    /*
      Not a failure: the user has a live store subscription and hasn't been told
      that deleting the account won't stop it. Nothing has been deleted. 409 and
      the subscription list, so the client can name the store and link to the
      right settings screen; `retry: false` because retrying the identical
      request will land here again — the client must come back acknowledged.
    */
    if (error instanceof StoreSubscriptionAcknowledgementRequiredError) {
      return new Response(
        JSON.stringify({
          error: error.message,
          code: error.code,
          retry: false,
          store_subscriptions: error.subscriptions.map((s) => ({
            platform: s.platform,
            product_id: s.productId,
            expires_at: s.expiresAt,
          })),
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.error("Error deleting user account:", error);
    return new Response(
      JSON.stringify({ error: errorMessage(error, "Failed to delete account"), retry: true }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
