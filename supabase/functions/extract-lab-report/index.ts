import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Buffer } from "node:buffer";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function resolveMimeType(mimeType: string | null | undefined, fileName?: string | null) {
  if (mimeType) {
    return mimeType;
  }

  const lowerName = fileName?.toLowerCase() ?? "";
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function proxyToFunction(
  functionName: string,
  payload: Record<string, unknown>,
  authHeader: string
) {
  const functionUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${functionName}`;
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  return new Response(responseText, {
    status: response.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const storagePath =
      typeof body.storagePath === "string" && body.storagePath.length > 0
        ? body.storagePath
        : null;
    const mimeType =
      typeof body.mimeType === "string" && body.mimeType.length > 0
        ? body.mimeType
        : null;
    const fileName =
      typeof body.fileName === "string" && body.fileName.length > 0
        ? body.fileName
        : null;

    if (!storagePath) {
      return new Response(
        JSON.stringify({ error: "storagePath is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!storagePath.startsWith(`${user.id}/`)) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from("lab-files")
      .download(storagePath);

    if (downloadError || !fileBlob) {
      return new Response(
        JSON.stringify({ error: downloadError?.message ?? "Unable to download uploaded file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    const resolvedMimeType = resolveMimeType(mimeType, fileName);

    if (resolvedMimeType === "application/pdf") {
      const pdfParseModule = await import("npm:pdf-parse@1.1.1");
      const pdfParse = (pdfParseModule.default ?? pdfParseModule) as (buffer: Uint8Array | Buffer) => Promise<{ text?: string }>;
      const parsed = await pdfParse(Buffer.from(bytes));
      const text = parsed?.text?.trim() ?? "";

      if (!text) {
        return new Response(
          JSON.stringify({ error: "No text could be extracted from this PDF" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return await proxyToFunction("extract-biomarkers", { text }, authHeader);
    }

    if (resolvedMimeType.startsWith("image/")) {
      const base64 = Buffer.from(bytes).toString("base64");
      const base64Image = `data:${resolvedMimeType};base64,${base64}`;
      return await proxyToFunction(
        "parse-lab-report-ocr",
        { base64Images: [base64Image] },
        authHeader
      );
    }

    return new Response(
      JSON.stringify({ error: `Unsupported file type: ${resolvedMimeType}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("extract-lab-report error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error occurred",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
