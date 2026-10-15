import "jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.3";
import {
  deleteReportAndFiles,
  deletionFailedResponse,
  deletionResponse,
  isReportId,
  LAB_FILES_BUCKET,
  type LabFileCleanupItem,
  type ReportDeletionActions,
} from "../_shared/report-deletion.ts";

// Thin wiring for single-report deletion. Ordering, retries, path safety and
// the honest response live in ../_shared/report-deletion.ts (Vitest-covered).
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json(401, { code: "unauthorized" });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json(401, { code: "unauthorized" });

    const body = await req.json().catch(() => null);
    const reportId: unknown = body?.report_id;
    if (!isReportId(reportId)) return json(400, { code: "invalid_report_id" });

    // Service credentials for the erase RPC, the cleanup queue and Storage.
    // Ownership and live references are read through the caller's RLS.
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const actions: ReportDeletionActions = {
      async ownsReport(userId, id) {
        const { data, error } = await userClient.from("lab_reports").select("id")
          .eq("id", id).eq("user_id", userId).maybeSingle();
        if (error) throw error;
        return data !== null;
      },
      async eraseReports(ids) {
        const { error } = await service.rpc("erase_reports", { p_report_ids: ids });
        if (error) throw new Error(`Report erasure failed: ${error.message}`);
      },
      async listPendingCleanups(userId, { reportId: forReport, limit }) {
        let query = service.from("lab_file_cleanup").select("id, report_id, file_ref, attempts")
          .eq("user_id", userId);
        if (forReport) query = query.eq("report_id", forReport);
        const { data, error } = await query.order("created_at", { ascending: true }).limit(limit);
        if (error) throw error;
        return ((data ?? []) as Array<{ id: string; report_id: string; file_ref: string; attempts: number }>)
          .map((row): LabFileCleanupItem => ({
            id: row.id, reportId: row.report_id, fileRef: row.file_ref, attempts: row.attempts,
          }));
      },
      async listLiveFileRefs(userId) {
        const { data, error } = await userClient.from("lab_reports").select("file_url")
          .eq("user_id", userId).not("file_url", "is", null);
        if (error) throw error;
        return ((data ?? []) as Array<{ file_url: string | null }>)
          .map((row) => row.file_url).filter((ref): ref is string => typeof ref === "string");
      },
      async removeObject(path) {
        const { data, error } = await service.storage.from(LAB_FILES_BUCKET).remove([path]);
        if (!error) return { removedCount: Array.isArray(data) ? data.length : 0, error: null };
        const detail = error as { message: string; status?: unknown; statusCode?: unknown };
        const status = detail.status ?? detail.statusCode;
        return {
          removedCount: 0,
          error: {
            message: detail.message,
            status: typeof status === "number" || typeof status === "string" ? status : undefined,
          },
        };
      },
      async completeCleanups(userId, ids) {
        const { error } = await service.from("lab_file_cleanup").delete().eq("user_id", userId).in("id", ids);
        if (error) throw error;
      },
      async recordCleanupFailure(userId, item, reason) {
        const { error } = await service.from("lab_file_cleanup").update({
          attempts: item.attempts + 1,
          last_attempt_at: new Date().toISOString(),
          last_error: reason,
        }).eq("user_id", userId).eq("id", item.id);
        if (error) throw error;
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };

    const result = await deleteReportAndFiles(actions, user.id, reportId);
    if (result.status === "file_cleanup_pending") {
      console.warn("delete-report: report erased; stored file removal pending for retry");
    }
    const response = deletionResponse(result);
    return json(response.status, response.body);
  } catch (error: unknown) {
    // Ownership read or the erase RPC failed: nothing is confirmed erased.
    console.error("delete-report: report erasure failed:", error instanceof Error ? error.message : "unknown");
    const response = deletionFailedResponse();
    return json(response.status, response.body);
  }
});
