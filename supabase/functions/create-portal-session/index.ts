import "jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.3";
import Stripe from "npm:stripe@14.11.0";
import {
  openBillingPortal,
  PORTAL_UNAVAILABLE_CODE,
  PORTAL_UNAVAILABLE_MESSAGE,
} from "../_shared/stripe-portal.ts";
import { errorType, scrubbedErrorMessage } from "../_shared/phi-scrub.ts";
import { APP_URL_SECRET_NAME, resolveAppOrigin } from "../_shared/stripe-checkout-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2024-11-20.acacia",
    });

    // The allow-listed APP_URL, never the caller's Origin header (BS2, review F031).
    const origin = resolveAppOrigin(Deno.env.get(APP_URL_SECRET_NAME));
    if (!origin) throw new Error(`${APP_URL_SECRET_NAME} is not an allowed Amani origin`);

    // Which customer, and never creating one, is ../_shared/stripe-portal.ts
    // (review F038, F029, F094). Both reads use the caller's JWT: RLS limits
    // stripe_customers to her own live row, and users to her own row.
    const result = await openBillingPortal({
      async findCurrentCustomerId(userId) {
        const { data, error } = await supabase
          .from("stripe_customers")
          .select("customer_id")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .maybeSingle();
        if (error) throw new Error(`Reading stripe_customers failed: ${error.message}`);
        return (data?.customer_id as string | null | undefined) ?? null;
      },

      async findLegacyCustomerId(userId) {
        const { data, error } = await supabase
          .from("users")
          .select("stripe_customer_id")
          .eq("id", userId)
          .maybeSingle();
        if (error) throw new Error(`Reading users.stripe_customer_id failed: ${error.message}`);
        return (data?.stripe_customer_id as string | null | undefined) ?? null;
      },

      async createPortalSession(customerId, returnUrl) {
        const session = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: returnUrl,
        });
        if (!session.url) throw new Error("Stripe returned a portal session without a url");
        return session.url;
      },
    }, {
      userId: user.id,
      // `/app/billing` — the only billing route App.tsx declares. `/billing`
      // renders the NotFound page, so every portal session used to end there.
      returnUrl: `${origin}/app/billing`,
    });

    return new Response(
      JSON.stringify(result.body),
      {
        status: result.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    // A fixed body for the client; the type and a scrubbed message for the log.
    console.error("[create-portal-session] failed:", errorType(error), scrubbedErrorMessage(error));
    return new Response(
      JSON.stringify({ error: PORTAL_UNAVAILABLE_MESSAGE, code: PORTAL_UNAVAILABLE_CODE }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
