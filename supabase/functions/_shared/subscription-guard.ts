import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveEntitlement, type IapRecord } from "./entitlement.ts";

type SupabaseClient = ReturnType<typeof createClient>;

// Re-exported so existing importers keep their type without knowing that the
// decision moved into entitlement.ts.
export type SubscriptionCheckResult =
  | { allowed: true; reason: "active_subscription" | "active_iap" | "trial" }
  | {
      allowed: false;
      reason: "trial_expired" | "onboarding_incomplete" | "no_subscription";
    };

/**
 * Sandbox StoreKit/Play purchases entitle only when this is explicitly on.
 * Off in production, so a tester's sandbox receipt cannot unlock paid features
 * for anyone else; turn it on in a staging project to exercise the flow.
 */
const allowSandbox = () => Deno.env.get("ALLOW_SANDBOX_IAP") === "true";

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
        .select("status, expires_at, environment")
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

    return resolveEntitlement({
      stripeStatus: subResult.data?.subscription_status ?? null,
      iapRecords: (iapResult.data ?? []) as IapRecord[],
      trialStartDate: userResult.data?.trial_start_date ?? null,
      now: Date.now(),
      allowSandbox: allowSandbox(),
    });
  } catch (err) {
    console.error("[subscription-guard] DB read failed, failing closed:", err);
    return { allowed: false, reason: "no_subscription" };
  }
}
