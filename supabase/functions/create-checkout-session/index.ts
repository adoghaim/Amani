import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14.11.0";

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
        JSON.stringify({ error: "Unauthorized", detail: userError?.message ?? "no user", authHeader: req.headers.get("Authorization")?.substring(0, 20) }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2024-11-20.acacia",
    });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: profile } = await supabase
      .from("users")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const { data: existingCustomer } = await supabaseAdmin
        .from("stripe_customers")
        .select("customer_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingCustomer?.customer_id) {
        customerId = existingCustomer.customer_id;
      } else {
        const customer = await stripe.customers.create({
          email: profile?.email || user.email,
          metadata: {
            supabase_user_id: user.id,
          },
        });
        customerId = customer.id;

        await supabaseAdmin
          .from("stripe_customers")
          .insert({ user_id: user.id, customer_id: customerId });

        await supabase
          .from("users")
          .update({ stripe_customer_id: customerId })
          .eq("id", user.id);
      }
    } else {
      const { data: existingCustomer } = await supabaseAdmin
        .from("stripe_customers")
        .select("customer_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!existingCustomer) {
        await supabaseAdmin
          .from("stripe_customers")
          .insert({ user_id: user.id, customer_id: customerId });
      }
    }

    const origin = req.headers.get("origin") || "http://localhost:5173";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Amani Subscription",
              description: "Monthly subscription to Amani",
            },
            unit_amount: 2400,
            recurring: {
              interval: "month",
            },
          },
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${origin}/billing?success=true`,
      cancel_url: `${origin}/billing?canceled=true`,
      metadata: {
        supabase_user_id: user.id,
      },
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
