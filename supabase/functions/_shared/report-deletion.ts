/**
 * Single-report deletion: the report graph AND the lab file it was uploaded with.
 *
 * Before PK-FIX-04 the client deleted `lab_reports` directly under RLS. The
 * cascade erased biomarkers, interpretations and versions, but the uploaded PDF
 * or photo stayed in the private `lab-files` bucket forever. This module is the
 * ordering, retry and honesty policy for the server path that replaces it. All
 * I/O (PostgREST, the erase_reports RPC, Storage) sits behind
 * `ReportDeletionActions`, so Vitest drives it with fakes and the Deno handler
 * (`delete-report/index.ts`) only wires the port.
 *
 * Order:
 *
 *   1. `ownsReport` — the report must exist and belong to the caller. A report
 *      that is not theirs is never erased and its id is never touched.
 *   2. `eraseReports` — V2's `erase_reports(uuid[])`, the same report-graph
 *      erasure account deletion awaits. The AFTER DELETE trigger from migration
 *      20261015110000 records the report's `file_url` in `lab_file_cleanup` in
 *      the SAME transaction, so the file can never be forgotten, whichever path
 *      deleted the row (this endpoint, an older client deleting directly, or
 *      V2's erasure RPCs).
 *   3. Drain this report's cleanup items: remove each object, with a bounded
 *      number of inline attempts. A missing object counts as success. A removed
 *      or missing object completes (deletes) its item; a failure records the
 *      attempt and leaves the item pending for the next retry.
 *   4. Opportunistically drain a bounded backlog of the caller's older pending
 *      items (earlier failures, direct deletes by older clients). One attempt
 *      each; the backlog never changes this report's verdict, and is skipped
 *      when this report's own file is still pending (Storage is failing).
 *
 * Honesty: the response is success only when no item for this report remains
 * pending. If the report rows are gone but a file is not, the verdict is
 * `file_cleanup_pending` (HTTP 503, `report_deleted: true`, `retry: true`) — the
 * client must not say "deleted" while the file is still stored. Any doubt
 * (unparseable reference, bookkeeping error, failed listing) resolves to
 * pending, never to success.
 *
 * Safety: an object is removed only when its path is inside the caller's own
 * folder (`<user_id>/...`, the layout NewReport.tsx uploads to), contains no
 * `.`/`..` or empty segments, and no live report of the caller still references
 * it. A reference into another user's folder or another bucket is never
 * deleted; its item is completed as not-owned.
 */

/** The private bucket NewReport.tsx uploads lab files to. */
export const LAB_FILES_BUCKET = "lab-files";

/** Inline removal attempts per object of the report being deleted. */
export const REPORT_FILE_ATTEMPTS = 3;

/** Waits between those attempts, in milliseconds (attempt 1→2, 2→3). */
export const RETRY_BACKOFF_MS: readonly number[] = [250, 1000];

/** Older pending items of the same user retried per call, one attempt each. */
export const BACKLOG_DRAIN_LIMIT = 20;

/** Upper bound on cleanup items read for one report (normally exactly one). */
const REPORT_ITEM_LIMIT = 50;

/** `last_error` is diagnostic only; keep it short. */
const MAX_REASON_LENGTH = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string (the shape of every report id). */
export function isReportId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** A pending `lab_file_cleanup` row as the port returns it. */
export interface LabFileCleanupItem {
  id: string;
  reportId: string;
  /** The raw `lab_reports.file_url` captured by the delete trigger. */
  fileRef: string;
  attempts: number;
}

/** What one Storage remove call reported. */
export interface StorageRemoveResult {
  /** Objects Storage says it deleted. Zero with no error means nothing was there. */
  removedCount: number;
  error: { message: string; status?: number | string } | null;
}

export interface ReportDeletionActions {
  /** True when the report exists and belongs to the user. */
  ownsReport(userId: string, reportId: string): Promise<boolean>;
  /** V2's `erase_reports(uuid[])` for exactly these ids (service only). */
  eraseReports(reportIds: string[]): Promise<void>;
  /** The user's pending cleanup items, oldest first; one report's when `reportId` is set. */
  listPendingCleanups(
    userId: string,
    filter: { reportId?: string; limit: number },
  ): Promise<LabFileCleanupItem[]>;
  /** Raw `file_url` values of the user's live (undeleted) reports. */
  listLiveFileRefs(userId: string): Promise<string[]>;
  /** One remove call for one object path in the lab-files bucket. */
  removeObject(path: string): Promise<StorageRemoveResult>;
  /** Delete finished cleanup rows, scoped to the user. */
  completeCleanups(userId: string, itemIds: string[]): Promise<void>;
  /** Record a failed attempt; the row stays pending for the next retry. */
  recordCleanupFailure(userId: string, item: LabFileCleanupItem, reason: string): Promise<void>;
  /** Injected so tests do not sleep. */
  sleep(ms: number): Promise<void>;
}

/** Where a stored `file_url` points, from the owner's point of view. */
export type LabFileTarget =
  | { kind: "owned"; path: string }
  /** Another user's folder or another bucket: never this user's to delete. */
  | { kind: "foreign" }
  /** Cannot be mapped to an object safely; stays pending, never "success". */
  | { kind: "unrecognized" };

// /storage/v1/object/<bucket>/<path>, optionally with public/, sign/ or
// authenticated/ before the bucket. Pre-2026-02-24 rows stored the public URL
// (getPublicUrl); everything since stores the bare `<user_id>/<ts>.<ext>` path.
const STORAGE_OBJECT_URL = /\/storage\/v1\/object\/(?:(?:public|sign|authenticated)\/)?([^/]+)\/(.+)$/;

/**
 * Maps a stored `file_url` to an object path in the caller's own folder, or says
 * why it cannot be removed on their behalf. Pure; never trusts the reference.
 */
export function resolveLabFileTarget(fileRef: string, userId: string): LabFileTarget {
  const ref = fileRef.trim();
  if (!ref) return { kind: "unrecognized" };

  let path: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
    let url: URL;
    try {
      url = new URL(ref);
    } catch {
      return { kind: "unrecognized" };
    }
    const match = url.pathname.match(STORAGE_OBJECT_URL);
    if (!match) return { kind: "unrecognized" };
    if (match[1] !== LAB_FILES_BUCKET) return { kind: "foreign" };
    try {
      // getPublicUrl encodes with encodeURI; decodeURI is its inverse and,
      // unlike decodeURIComponent, cannot turn %2F into a new path segment.
      path = decodeURI(match[2]);
    } catch {
      return { kind: "unrecognized" };
    }
  } else {
    path = ref.replace(/^\/+/, "");
  }

  const segments = path.split("/");
  if (segments.length < 2 || segments.some((s) => s === "" || s === "." || s === "..")) {
    return { kind: "unrecognized" };
  }
  const folder = segments[0].toLowerCase();
  if (folder === userId.toLowerCase()) return { kind: "owned", path };
  // Only a different user's folder is provably not ours. Anything else is
  // unknown, and unknown must never be reported as removed.
  return UUID_RE.test(folder) ? { kind: "foreign" } : { kind: "unrecognized" };
}

export type RemovalOutcome = "removed" | "missing" | "failed";

/** Storage's answer to one remove call. A missing object is a success. */
export function classifyRemoval(result: StorageRemoveResult): { outcome: RemovalOutcome; reason?: string } {
  if (result.error) {
    const status = String(result.error.status ?? "");
    if (status === "404" || /not[\s_-]?found/i.test(result.error.message ?? "")) {
      return { outcome: "missing" };
    }
    return { outcome: "failed", reason: result.error.message || "Storage remove failed" };
  }
  return { outcome: result.removedCount > 0 ? "removed" : "missing" };
}

/** What happened to one cleanup item in this call. */
export type ItemOutcome =
  | "removed"
  | "missing"
  /** Pointed outside the owner's folder or bucket: completed without deleting. */
  | "not_owned"
  /** A live report still references the same object: completed without deleting. */
  | "still_referenced"
  /** Still stored or not confirmed: the item stays pending. */
  | "pending";

export interface ItemResult {
  itemId: string;
  reportId: string;
  outcome: ItemOutcome;
}

function reasonText(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return (text || fallback).slice(0, MAX_REASON_LENGTH);
}

async function recordFailure(
  actions: ReportDeletionActions,
  userId: string,
  item: LabFileCleanupItem,
  reason: string,
): Promise<void> {
  try {
    await actions.recordCleanupFailure(userId, item, reason.slice(0, MAX_REASON_LENGTH));
  } catch {
    // The item was never completed, so it is still pending either way.
  }
}

/** Completes an item; a bookkeeping failure leaves it pending (never "success"). */
async function complete(
  actions: ReportDeletionActions,
  userId: string,
  item: LabFileCleanupItem,
  outcome: Exclude<ItemOutcome, "pending">,
): Promise<ItemOutcome> {
  try {
    await actions.completeCleanups(userId, [item.id]);
    return outcome;
  } catch {
    return "pending";
  }
}

async function processItem(
  actions: ReportDeletionActions,
  userId: string,
  item: LabFileCleanupItem,
  livePaths: ReadonlySet<string>,
  attempts: number,
): Promise<ItemResult> {
  const result = (outcome: ItemOutcome): ItemResult => ({ itemId: item.id, reportId: item.reportId, outcome });
  const target = resolveLabFileTarget(item.fileRef, userId);

  if (target.kind === "foreign") return result(await complete(actions, userId, item, "not_owned"));
  if (target.kind === "unrecognized") {
    await recordFailure(actions, userId, item, "Unrecognized file reference; not removed");
    return result("pending");
  }
  if (livePaths.has(target.path)) return result(await complete(actions, userId, item, "still_referenced"));

  let reason = "Storage remove failed";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let removal: StorageRemoveResult;
    try {
      removal = await actions.removeObject(target.path);
    } catch (error) {
      removal = { removedCount: 0, error: { message: reasonText(error, "Storage remove threw") } };
    }
    const classified = classifyRemoval(removal);
    if (classified.outcome !== "failed") {
      return result(await complete(actions, userId, item, classified.outcome));
    }
    reason = classified.reason ?? reason;
    if (attempt < attempts) {
      await actions.sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]);
    }
  }
  await recordFailure(actions, userId, item, reason);
  return result("pending");
}

/** Object paths the caller's live reports still point at. Never removed. */
function liveOwnedPaths(fileRefs: readonly string[], userId: string): Set<string> {
  const paths = new Set<string>();
  for (const ref of fileRefs) {
    const target = resolveLabFileTarget(ref, userId);
    if (target.kind === "owned") paths.add(target.path);
  }
  return paths;
}

export type ReportDeletionResult =
  | {
    /** Erased now, or already gone; no stored file of this report remains pending. */
    status: "deleted" | "already_deleted";
    items: ItemResult[];
    backlog: ItemResult[];
  }
  | {
    /** The report rows are gone but a stored file is not confirmed removed. */
    status: "file_cleanup_pending";
    items: ItemResult[];
    backlog: ItemResult[];
  };

export interface DeleteReportOptions {
  /** Inline attempts per object of this report (default REPORT_FILE_ATTEMPTS). */
  attempts?: number;
  /** Backlog items retried per call (default BACKLOG_DRAIN_LIMIT). */
  backlogLimit?: number;
}

/**
 * Erases one of the caller's reports and removes its stored lab file(s).
 *
 * Throws only before anything is erased (ownership read or erase RPC failed):
 * the caller answers "not deleted, retry". Once the erase has returned, every
 * failure resolves to `file_cleanup_pending` — the trigger has already recorded
 * the file, so a retry (this endpoint again, for the same report) finishes it.
 * Idempotent: a report that is already gone (or never was the caller's) erases
 * nothing and only drains the caller's own pending items for that id.
 */
export async function deleteReportAndFiles(
  actions: ReportDeletionActions,
  userId: string,
  reportId: string,
  options: DeleteReportOptions = {},
): Promise<ReportDeletionResult> {
  const attempts = Math.max(1, options.attempts ?? REPORT_FILE_ATTEMPTS);
  const backlogLimit = Math.max(0, options.backlogLimit ?? BACKLOG_DRAIN_LIMIT);

  const owned = await actions.ownsReport(userId, reportId);
  if (owned) await actions.eraseReports([reportId]);

  // From here the report graph is gone (or was already). Nothing below may
  // throw past this point, and nothing below may claim success on doubt.
  const items: ItemResult[] = [];
  let livePaths = new Set<string>();
  try {
    livePaths = liveOwnedPaths(await actions.listLiveFileRefs(userId), userId);
    const own = await actions.listPendingCleanups(userId, { reportId, limit: REPORT_ITEM_LIMIT });
    for (const item of own) items.push(await processItem(actions, userId, item, livePaths, attempts));
  } catch {
    // Could not list or verify: this report's file is not confirmed gone. The
    // trigger's record (if any) is still there for the retry.
    return { status: "file_cleanup_pending", items, backlog: [] };
  }

  // This report's verdict is settled here. A pending file means Storage is
  // failing right now: leave the backlog for a later call instead of spending
  // the request on attempts that would fail the same way.
  const reportPending = items.some((item) => item.outcome === "pending");
  if (reportPending) return { status: "file_cleanup_pending", items, backlog: [] };

  const backlog: ItemResult[] = [];
  if (backlogLimit > 0) {
    try {
      const pending = await actions.listPendingCleanups(userId, { limit: backlogLimit + items.length });
      const others = pending.filter((item) => item.reportId !== reportId).slice(0, backlogLimit);
      for (const item of others) backlog.push(await processItem(actions, userId, item, livePaths, 1));
    } catch {
      // The backlog stays recorded; the next call retries it.
    }
  }
  return { status: owned ? "deleted" : "already_deleted", items, backlog };
}

export interface DeletionResponse {
  status: number;
  body: Record<string, unknown>;
}

export const FILE_CLEANUP_PENDING_CODE = "file_cleanup_pending";
export const REPORT_DELETION_FAILED_CODE = "report_deletion_failed";

/** The wire shape of a finished deletion. Success only when no file remains pending. */
export function deletionResponse(result: ReportDeletionResult): DeletionResponse {
  if (result.status === "file_cleanup_pending") {
    return {
      status: 503,
      body: {
        success: false,
        code: FILE_CLEANUP_PENDING_CODE,
        report_deleted: true,
        retry: true,
        error: "The report was deleted, but its uploaded file could not be removed yet. Please try again.",
      },
    };
  }
  return { status: 200, body: { success: true, status: result.status } };
}

/** Nothing was confirmed erased: the ownership read or the erase RPC failed. */
export function deletionFailedResponse(): DeletionResponse {
  return {
    status: 500,
    body: {
      success: false,
      code: REPORT_DELETION_FAILED_CODE,
      report_deleted: false,
      retry: true,
      error: "The report could not be deleted. Please try again.",
    },
  };
}
