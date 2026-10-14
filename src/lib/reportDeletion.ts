/*
  Client side of single-report deletion (PK-FIX-04).

  The report is deleted by the `delete-report` edge function, never by a direct
  `lab_reports` delete: the server erases the report graph AND removes the
  uploaded lab file from storage, so no client can skip the file. This module
  turns the function's answer into one of three honest outcomes:

    deleted       the report and its stored file are gone
    file_pending  the report is gone, but its uploaded file is not removed yet;
                  calling again for the same report retries the file
    failed        nothing is confirmed; the report may still exist

  Anything that is not explicit proof of success (a network error, an unknown
  2xx body, a missing function) is `failed`, never `deleted`.
*/

/** The slice of `supabase.functions.invoke` this module needs. */
export type InvokeFn = (
  name: string,
  options: { body: Record<string, unknown> },
) => Promise<{ data: unknown; error: unknown }>;

export type ReportDeletionOutcome =
  | { kind: 'deleted' }
  | { kind: 'file_pending'; message: string }
  | { kind: 'failed'; message: string };

export const REPORT_FILE_PENDING_MESSAGE =
  "Your report was deleted, but its uploaded lab file couldn't be removed yet. " +
  'Try again to finish removing it. It is also retried the next time you delete a report.';

export const REPORT_DELETE_FAILED_MESSAGE =
  "We couldn't delete this report. Check your connection and try again.";

const failed: ReportDeletionOutcome = { kind: 'failed', message: REPORT_DELETE_FAILED_MESSAGE };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `FunctionsHttpError`, recognised by shape so tests need not construct one. */
function httpBody(error: unknown): Promise<unknown> | null {
  if (!isRecord(error) || !isRecord(error.context)) return null;
  const context = error.context as { status?: unknown; json?: unknown };
  if (typeof context.status !== 'number' || typeof context.json !== 'function') return null;
  return (context.json as () => Promise<unknown>).call(error.context);
}

/** One call to `delete-report` for one report. Never throws. */
export async function requestReportDeletion(invoke: InvokeFn, reportId: string): Promise<ReportDeletionOutcome> {
  try {
    const { data, error } = await invoke('delete-report', { body: { report_id: reportId } });
    if (!error) return isRecord(data) && data.success === true ? { kind: 'deleted' } : failed;
    const pending = httpBody(error);
    if (!pending) return failed;
    const body = await pending.catch(() => null);
    if (isRecord(body) && body.code === 'file_cleanup_pending' && body.report_deleted === true) {
      return { kind: 'file_pending', message: REPORT_FILE_PENDING_MESSAGE };
    }
    return failed;
  } catch {
    return failed;
  }
}
