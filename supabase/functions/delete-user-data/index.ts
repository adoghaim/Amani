import "jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.3";
import Stripe from "npm:stripe@17.7.0";
import { errorMessage } from "../_shared/errors.ts";
import { fetchWithBackoff } from "../_shared/fetchWithBackoff.ts";
import {
  AccountDeletionNotReadyError,
  checkUserDataTablesReady,
  deleteUserAccount,
  deleteUserDataTables,
  isMissingTableError,
  MissingTableError,
  StoreSubscriptionAcknowledgementRequiredError,
  type AccountDeletionActions,
  type StoreSubscriptionRecord,
} from "../_shared/account-deletion.ts";
import { createStoreTeardownActions } from "../_shared/store-teardown.ts";
import { createAppEventSink, logServerEvent } from "../_shared/app-events.ts";

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
      async checkDataTablesReady() {
        // One GET per table delete-user-data deletes from, at most one owner
        // id back, discarded. A table the database lacks (this function
        // deployed before its migration: user-data-registry.ts, DEPLOY ORDER)
        // refuses the whole deletion here, before anything is touched.
        //
        // Never `{ head: true }`: PostgREST answers a missing table with 404
        // PGRST205, a HEAD response has no body, and postgrest-js turns a 404
        // with an empty body into status 204 with `error: null`, so a HEAD
        // probe passes for a table that does not exist. A GET carries the
        // error body; and only a real array counts as readable, so any other
        // shape of "success" also refuses.
        await checkUserDataTablesReady(async (table, ownerColumn) => {
          const { data, error, status } = await supabase.from(table).select(ownerColumn).limit(1);
          if (error) throw new Error(error.message);
          if (!Array.isArray(data)) throw new Error(`unreadable (HTTP ${status}, no rows array)`);
        });
      },

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
        /*
          The order is ../_shared/account-deletion.ts (deleteUserDataTables) and
          the tables are ../_shared/user-data-registry.ts: one awaited
          erase_reports for every report graph, then each `ordered_delete`
          table, serially, in registry order, the users profile row last. A
          table that is not swept here (iap_subscriptions rides the auth.users
          cascade on purpose) has its reason in the registry. This port is the
          I/O only; its queries and messages are the ones this function always
          issued.
        */
        await deleteUserDataTables({
          async listReportIds(userId) {
            const { data: reportIds, error: reportsListError } = await supabase
              .from("lab_reports")
              .select("id")
              .eq("user_id", userId);
            if (reportsListError) throw new Error(`Reading lab_reports failed: ${reportsListError.message}`);
            return ((reportIds ?? []) as Array<{ id: string }>).map((r) => r.id);
          },

          async eraseReports(ids) {
            // One awaited call erases every report graph: the lab_reports rows in id
            // lock order, cascading to biomarkers, report_items, report_analytes,
            // interpretations and versions. Nothing else touches that graph while it
            // runs; the old concurrent child deletes are what deadlocked against it.
            const { error: eraseError } = await supabase.rpc("erase_reports", { p_report_ids: ids });
            if (eraseError) throw new Error(`Report erasure failed: ${eraseError.message}`);
          },

          async deleteOwnedRows(table, ownerColumn, userId) {
            const { error } = await supabase.from(table).delete().eq(ownerColumn, userId);
            if (error) {
              // Only registry entries marked mayBeUndeployed skip this one (account-deletion.ts).
              if (isMissingTableError(error)) throw new MissingTableError(table, error.message);
              throw new Error(table === "users"
                ? `Deleting users row failed: ${error.message}`
                : `Deleting ${table} failed: ${error.message}`);
            }
          },
        }, userId);
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

    // PK-EXP5: counted with no user id, after the account is gone, so the
    // ledger keeps nothing that points at the erased account. Never throws,
    // gives up after 3 seconds; the deletion already succeeded either way.
    await logServerEvent(createAppEventSink(row => supabase.from("app_events").insert(row)), {
      event: "account_deleted", userId: null,
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

    /*
      A deploy-order mistake, not the user's doing: a table this function
      deletes from is missing. Nothing was deleted. 503 with a plain message;
      which table and which migration go to the function log.
    */
    if (error instanceof AccountDeletionNotReadyError) {
      console.error("Account deletion refused, nothing deleted:", error.message, error.tables);
      return new Response(
        JSON.stringify({
          error: "Account deletion is temporarily unavailable. Nothing was deleted. Please try again later.",
          code: error.code,
          retry: true,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.error("Error deleting user account:", error);
    return new Response(
      JSON.stringify({ error: errorMessage(error, "Failed to delete account"), retry: true }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
