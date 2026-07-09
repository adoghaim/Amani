import { createClient } from "npm:@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

export type SubscriptionCheckResult =
  | { allowed: true; reason: "active_subscription" | "trial" }
  | { allowed: false; reason: "trial_expired" | "onboarding_incomplete" | "no_subscription" };

const ACTIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due"]);
const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export async function checkUserSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionCheckResult> {
  try {
    const [subResult, userResult] = await Promise.all([
      supabase
        .from("stripe_user_subscriptions")
        .select("subscription_status")
        .maybeSingle(),
      supabase
        .from("users")
        .select("trial_start_date")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    const stripeStatus = subResult.data?.subscription_status ?? null;
    if (stripeStatus && ACTIVE_STRIPE_STATUSES.has(stripeStatus)) {
      return { allowed: true, reason: "active_subscription" };
    }

    const trialStart = userResult.data?.trial_start_date ?? null;
    if (!trialStart) {
      return { allowed: false, reason: "onboarding_incomplete" };
    }

    const elapsed = Date.now() - new Date(trialStart).getTime();
    if (elapsed < TRIAL_DURATION_MS) {
      return { allowed: true, reason: "trial" };
    }

    if (stripeStatus) {
      return { allowed: false, reason: "no_subscription" };
    }

    return { allowed: false, reason: "trial_expired" };
  } catch (err) {
    console.error("[subscription-guard] DB read failed, failing closed:", err);
    return { allowed: false, reason: "no_subscription" };
  }
}
