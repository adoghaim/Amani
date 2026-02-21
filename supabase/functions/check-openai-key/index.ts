import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      return new Response(JSON.stringify({ status: "missing", message: "OPENAI_API_KEY secret is not set" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.ok) {
      return new Response(JSON.stringify({ status: "valid", message: "OpenAI API key is valid" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      const err = await response.json();
      return new Response(JSON.stringify({ status: "invalid", message: err?.error?.message ?? "Invalid API key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ status: "error", message: String(e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
