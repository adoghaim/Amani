import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.7.0";
import { errorMessage } from "../_shared/errors.ts";
import {
  deleteUserAccount,
  StoreSubscriptionAcknowledgementRequiredError,
  type AccountDeletionActions,
  type StoreSubscriptionRecord,
} from "../_shared/account-deletion.ts";

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
      async listStoreSubscriptions(userId) {
        // Unfiltered on purpose — which statuses still bill is policy, and it
        // lives in ../_shared/account-deletion.ts where it can be tested.
        const { data, error } = await supabase
          .from("iap_subscriptions")
          .select("platform, product_id, status, expires_at, environment")
          .eq("user_id", userId);

        /*
          Fail rather than assume "no subscriptions". A read error here would
          otherwise skip the warning entirely and delete the account of someone
          Apple is still charging — the exact outcome this check exists for.
        */
        if (error) throw new Error(`Reading iap_subscriptions failed: ${error.message}`);
        return (data ?? []) as StoreSubscriptionRecord[];
      },

      async getStripeCustomerId(userId) {
        // Prefer stripe_customers (current); fall back to users.stripe_customer_id (legacy).
        // A read error must not look like "no customer": that would skip the
        // Stripe cancellation and keep billing an account that no longer exists.
        const { data: linked, error: linkedError } = await supabase
          .from("stripe_customers")
          .select("customer_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (linkedError) throw new Error(`Reading stripe_customers failed: ${linkedError.message}`);
        if (linked?.customer_id) return linked.customer_id as string;

        const { data: legacy, error: legacyError } = await supabase
          .from("users")
          .select("stripe_customer_id")
          .eq("id", userId)
          .maybeSingle();
        if (legacyError) throw new Error(`Reading users.stripe_customer_id failed: ${legacyError.message}`);
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
        /*
          One RPC, one transaction, one lock order — see
          supabase/migrations/20261011000000_delete_user_data_ordered.sql.

          This used to be ~20 separate requests (a Promise.all over the report
          children, then a serial sweep), and two overlapping deletions of a
          user with several reports deadlocked on the child rows. The SQL
          function also drops the local Stripe rows, and raises rather than
          returning while any row survives.

          `iap_subscriptions` is deliberately not erased there: it rides the
          auth.users ON DELETE CASCADE (20260821000000_add_iap_subscriptions.sql),
          so a deletion that fails at deleteAuthUser never leaves a live
          account with its store subscription record erased — a paying
          customer locked out of what they bought.
        */
        const { error } = await supabase.rpc("delete_user_data", { p_user_id: userId });
        if (error) {
          // Keep the SQLSTATE: the shared module retries deadlock / lock-timeout
          // failures, which roll back the whole erasure, and nothing else.
          throw Object.assign(new Error(`Erasing user data failed: ${error.message}`), { code: error.code });
        }
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
