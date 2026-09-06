import { createClient } from "npm:@supabase/supabase-js@2";
import { loadBetaTester, type BetaAllowlistActions } from "./beta-allowlist.ts";
import { BETA_TESTER_COLUMNS, resolveEntitlement, type IapRecord } from "./entitlement.ts";

type SupabaseClient = ReturnType<typeof createClient>;

// Re-exported so existing importers keep their type without knowing that the
// decision moved into entitlement.ts.
export type SubscriptionCheckResult =
  | {
      allowed: true;
      reason: "active_subscription" | "active_iap" | "complimentary" | "trial";
    }
  | {
      allowed: false;
      reason: "trial_expired" | "onboarding_incomplete" | "no_subscription";
    };

/*
  There is no `ALLOW_SANDBOX_IAP` any more.

  It was a single env boolean that turned sandbox entitlement on for the whole
  project. Off, TestFlight and Play internal-test purchases granted nothing, so
  a tester past their 7-day trial could not exercise a single paid screen. On,
  every sandbox receipt in existence entitled every user who held one — and
  sandbox receipts are free to mint, so in production that flag was one
  mis-set secret away from giving the app away.

  `iap_beta_testers` replaces it with a per-user row an operator writes with the
  service role: enabled, optionally expiring, scoped to one storefront. See
  migration 20260903120000 and the rule in entitlement.ts.
*/

/** Reads the beta allowlist. The row is keyed by user_id and written only by
 *  the service role, so this query is the whole trust story. */
function betaAllowlistActions(supabase: SupabaseClient): BetaAllowlistActions {
  return {
    async findBetaTesterRow(userId: string) {
      const { data, error } = await supabase
        .from("iap_beta_testers")
        .select(BETA_TESTER_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle();

      // Thrown, not returned as null: `loadBetaTester` needs to tell a failed
      // read apart from "not a tester" so it can log the former.
      if (error) throw new Error(`iap_beta_testers read failed: ${error.message}`);
      return data;
    },
  };
}

/**
 * Reads every entitlement source for a user and decides access.
 *
 * Amani sells the same subscription through Stripe (web), StoreKit (iOS) and
 * Play Billing (Android) — Apple requires IAP to unlock in-app functionality
 * — so this reads Stripe and the native stores and unions the result.
 *
 * Fails closed: any read error denies rather than defaulting to allowed.
 */
export async function checkUserSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionCheckResult> {
  try {
    const [subResult, iapResult, userResult] = await Promise.all([
      supabase
        .from("stripe_user_subscriptions")
        .select("subscription_status")
        .maybeSingle(),
      supabase
        .from("iap_subscriptions")
        // `platform` and `product_id` are here for the sandbox beta rule, which
        // matches a tester's storefront and refuses products we do not sell.
        // Dropping them from this select would silently stop every sandbox
        // receipt entitling — the rule fails closed on a missing field.
        .select("status, expires_at, environment, platform, product_id")
        .eq("user_id", userId),
      supabase
        .from("users")
        .select("trial_start_date")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    /*
      A failed IAP read must not silently downgrade a paying App Store customer
      to "no subscription" — that would lock them out of what they bought. Treat
      it as the hard failure it is rather than as an empty result set.
    */
    if (iapResult.error) {
      console.error("[subscription-guard] IAP read failed, failing closed:", iapResult.error);
      return { allowed: false, reason: "no_subscription" };
    }

    const iapRecords = (iapResult.data ?? []) as IapRecord[];

    /*
      Only runs when this user actually holds a sandbox receipt. A production
      customer never touches `iap_beta_testers` — no query, no dependency, no
      way for the allowlist to change what they are entitled to.
    */
    const betaTester = await loadBetaTester(
      betaAllowlistActions(supabase),
      userId,
      iapRecords,
      (error) =>
        console.error(
          "[subscription-guard] iap_beta_testers read failed; sandbox receipts " +
            "will not entitle until it recovers:",
          error,
        ),
    );

    /*
      Complimentary grants: reviewers, press, support goodwill. Read
      unconditionally — unlike the beta allowlist there is no receipt to gate
      on, and a reviewer has no purchase at all.

      A read failure is fatal rather than silently ignored. Treating it as "no
      grant" would hand a store reviewer a paywall mid-review, which is the one
      moment that is expensive to get wrong; failing closed on the whole check
      at least surfaces as an error we can see.
    */
    const { data: compRow, error: compError } = await supabase
      .from("complimentary_entitlements")
      .select("user_id, reason, expires_at, enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if (compError) {
      console.error(
        "[subscription-guard] complimentary_entitlements read failed, failing closed:",
        compError,
      );
      return { allowed: false, reason: "no_subscription" };
    }

    return resolveEntitlement({
      stripeStatus: subResult.data?.subscription_status ?? null,
      iapRecords,
      trialStartDate: userResult.data?.trial_start_date ?? null,
      now: Date.now(),
      userId,
      betaTester,
      complimentary: (compRow ?? null) as never,
    });
  } catch (err) {
    console.error("[subscription-guard] DB read failed, failing closed:", err);
    return { allowed: false, reason: "no_subscription" };
  }
}
