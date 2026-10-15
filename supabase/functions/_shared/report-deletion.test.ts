import { describe, expect, it } from 'vitest';
import {
  BACKLOG_DRAIN_LIMIT,
  classifyRemoval,
  deleteReportAndFiles,
  deletionFailedResponse,
  deletionResponse,
  FILE_CLEANUP_PENDING_CODE,
  isReportId,
  REPORT_FILE_ATTEMPTS,
  resolveLabFileTarget,
  RETRY_BACKOFF_MS,
  type LabFileCleanupItem,
  type ReportDeletionActions,
  type StorageRemoveResult,
} from './report-deletion.ts';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const REPORT = '11111111-2222-4333-8444-555555555555';
const REPORT_2 = '11111111-2222-4333-8444-666666666666';
const OTHERS_REPORT = '11111111-2222-4333-8444-777777777777';

/** Scripted Storage answer; `undefined` means "behave like the real bucket". */
type Removal = (path: string, call: number) => StorageRemoveResult | Error | undefined;

/**
 * In-memory stand-in for the database and the bucket. `eraseReports` models the
 * AFTER DELETE trigger from 20261015110000 (it records each erased report's
 * file_url in the same step); the trigger itself is proven by execution in
 * supabase/migrations/__verification__/lab-file-cleanup.verify.sql.
 */
function world(opts: {
  reports?: Array<{ id: string; userId: string; fileUrl: string | null }>;
  objects?: string[];
  queue?: Array<Omit<LabFileCleanupItem, 'attempts'> & { userId: string; attempts?: number }>;
  removal?: Removal;
  fail?: Partial<Record<keyof ReportDeletionActions, Error>>;
} = {}) {
  const reports = new Map((opts.reports ?? []).map((r) => [r.id, { ...r }]));
  const objects = new Set(opts.objects ?? []);
  let seq = 0;
  const queue = (opts.queue ?? []).map((q) => ({ attempts: 0, lastError: null as string | null, ...q }));
  const calls: string[] = [];
  const removeCalls: string[] = [];
  const sleeps: number[] = [];
  const scopedUsers = new Set<string>();
  const failIf = (name: keyof ReportDeletionActions) => {
    const error = opts.fail?.[name];
    if (error) throw error;
  };

  const actions: ReportDeletionActions = {
    async ownsReport(userId, reportId) {
      calls.push(`ownsReport:${reportId}`);
      scopedUsers.add(userId);
      failIf('ownsReport');
      return reports.get(reportId)?.userId === userId;
    },
    async eraseReports(ids) {
      calls.push(`eraseReports:${ids.join(',')}`);
      failIf('eraseReports');
      for (const id of ids) {
        const report = reports.get(id);
        if (!report) continue;
        reports.delete(id);
        if (report.fileUrl) {
          queue.push({ id: `q${++seq}`, userId: report.userId, reportId: id, fileRef: report.fileUrl, attempts: 0, lastError: null });
        }
      }
    },
    async listPendingCleanups(userId, { reportId, limit }) {
      calls.push(`listPendingCleanups:${reportId ?? '*'}`);
      scopedUsers.add(userId);
      failIf('listPendingCleanups');
      return queue.filter((q) => q.userId === userId && (!reportId || q.reportId === reportId)).slice(0, limit)
        .map(({ id, reportId: r, fileRef, attempts }) => ({ id, reportId: r, fileRef, attempts }));
    },
    async listLiveFileRefs(userId) {
      calls.push('listLiveFileRefs');
      scopedUsers.add(userId);
      failIf('listLiveFileRefs');
      return [...reports.values()].filter((r) => r.userId === userId && r.fileUrl).map((r) => r.fileUrl!);
    },
    async removeObject(path) {
      removeCalls.push(path);
      calls.push(`removeObject:${path}`);
      const scripted = opts.removal?.(path, removeCalls.filter((p) => p === path).length);
      if (scripted instanceof Error) throw scripted;
      if (scripted) {
        if (!scripted.error && scripted.removedCount > 0) objects.delete(path);
        return scripted;
      }
      const existed = objects.delete(path);
      return { removedCount: existed ? 1 : 0, error: null };
    },
    async completeCleanups(userId, ids) {
      calls.push(`completeCleanups:${ids.join(',')}`);
      scopedUsers.add(userId);
      failIf('completeCleanups');
      for (const id of ids) {
        const index = queue.findIndex((q) => q.id === id && q.userId === userId);
        if (index >= 0) queue.splice(index, 1);
      }
    },
    async recordCleanupFailure(userId, item, reason) {
      calls.push(`recordCleanupFailure:${item.id}`);
      scopedUsers.add(userId);
      failIf('recordCleanupFailure');
      const row = queue.find((q) => q.id === item.id && q.userId === userId);
      if (row) { row.attempts = item.attempts + 1; row.lastError = reason; }
    },
    async sleep(ms) { sleeps.push(ms); },
  };
  return { actions, reports, objects, queue, calls, removeCalls, sleeps, scopedUsers };
}

const own = (file = `${USER}/1725379200000.pdf`) => ({
  reports: [{ id: REPORT, userId: USER, fileUrl: file }],
  objects: [file],
});
const failing = (message = 'storage unavailable'): StorageRemoveResult => ({ removedCount: 0, error: { message, status: 503 } });

describe('resolveLabFileTarget', () => {
  it('accepts the current <user_id>/<ts>.<ext> layout, case-insensitively and with a stray leading slash', () => {
    expect(resolveLabFileTarget(`${USER}/1725379200000.pdf`, USER)).toEqual({ kind: 'owned', path: `${USER}/1725379200000.pdf` });
    expect(resolveLabFileTarget(`/${USER}/a.png`, USER)).toEqual({ kind: 'owned', path: `${USER}/a.png` });
    expect(resolveLabFileTarget(`${USER.toUpperCase()}/a.png`, USER)).toEqual({ kind: 'owned', path: `${USER.toUpperCase()}/a.png` });
  });

  it('maps pre-2026-02-24 public, signed and authenticated URLs to the object path', () => {
    const base = 'https://example.supabase.co/storage/v1/object';
    expect(resolveLabFileTarget(`${base}/public/lab-files/${USER}/17%2001.pdf`, USER))
      .toEqual({ kind: 'owned', path: `${USER}/17 01.pdf` });
    expect(resolveLabFileTarget(`${base}/sign/lab-files/${USER}/1.pdf?token=abc`, USER))
      .toEqual({ kind: 'owned', path: `${USER}/1.pdf` });
    expect(resolveLabFileTarget(`${base}/authenticated/lab-files/${USER}/1.jpeg`, USER))
      .toEqual({ kind: 'owned', path: `${USER}/1.jpeg` });
    expect(resolveLabFileTarget(`${base}/lab-files/${USER}/1.png`, USER)).toEqual({ kind: 'owned', path: `${USER}/1.png` });
  });

  it('never claims another user\'s folder or another bucket', () => {
    expect(resolveLabFileTarget(`${OTHER}/1.pdf`, USER)).toEqual({ kind: 'foreign' });
    expect(resolveLabFileTarget(`https://x.supabase.co/storage/v1/object/public/lab-files/${OTHER}/1.pdf`, USER)).toEqual({ kind: 'foreign' });
    expect(resolveLabFileTarget(`https://x.supabase.co/storage/v1/object/public/avatars/${USER}/1.pdf`, USER)).toEqual({ kind: 'foreign' });
  });

  it('refuses anything it cannot map safely (unknown stays pending, never "removed")', () => {
    for (const ref of ['', '   ', '1.pdf', `${USER}/`, `${USER}//1.pdf`, `${USER}/../${OTHER}/1.pdf`, `${USER}/./1.pdf`,
      `lab-files/${USER}/1.pdf`, 'https://example.com/report.pdf', `https://x.supabase.co/storage/v1/object/public/lab-files/${USER}/%E0%A4%A.pdf`,
      'not a url://', 'https://']) {
      expect(resolveLabFileTarget(ref, USER), ref).toEqual({ kind: 'unrecognized' });
    }
  });
});

describe('classifyRemoval', () => {
  it('treats a removed or already-missing object as success and anything else as failure', () => {
    expect(classifyRemoval({ removedCount: 1, error: null })).toEqual({ outcome: 'removed' });
    expect(classifyRemoval({ removedCount: 0, error: null })).toEqual({ outcome: 'missing' });
    expect(classifyRemoval({ removedCount: 0, error: { message: 'x', status: 404 } })).toEqual({ outcome: 'missing' });
    expect(classifyRemoval({ removedCount: 0, error: { message: 'Object not found', status: 400 } })).toEqual({ outcome: 'missing' });
    expect(classifyRemoval({ removedCount: 0, error: { message: 'not_found' } })).toEqual({ outcome: 'missing' });
    expect(classifyRemoval(failing('gateway timeout'))).toEqual({ outcome: 'failed', reason: 'gateway timeout' });
    expect(classifyRemoval({ removedCount: 0, error: { message: '' } })).toEqual({ outcome: 'failed', reason: 'Storage remove failed' });
  });

  it('validates report ids at the boundary', () => {
    expect(isReportId(REPORT)).toBe(true);
    for (const bad of [undefined, null, 42, '', 'report-1', `${REPORT}x`, `'; drop table lab_reports; --`]) expect(isReportId(bad)).toBe(false);
  });
});

describe('deleteReportAndFiles', () => {
  it('erases the report through erase_reports, then removes its file and completes the record', async () => {
    const w = world(own());
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('deleted');
    expect(w.calls.slice(0, 2)).toEqual([`ownsReport:${REPORT}`, `eraseReports:${REPORT}`]);
    expect(w.removeCalls).toEqual([`${USER}/1725379200000.pdf`]);
    expect(w.objects.size).toBe(0);
    expect(w.queue).toEqual([]);
    expect(deletionResponse(result)).toEqual({ status: 200, body: { success: true, status: 'deleted' } });
  });

  it('counts a missing object as success (idempotent)', async () => {
    const w = world({ ...own(), objects: [] });
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('deleted');
    expect(result.items.map((i) => i.outcome)).toEqual(['missing']);
    expect(w.queue).toEqual([]);
    const notFound = world({ ...own(), removal: () => ({ removedCount: 0, error: { message: 'Object not found', status: '404' } }) });
    expect((await deleteReportAndFiles(notFound.actions, USER, REPORT)).status).toBe('deleted');
    expect(notFound.queue).toEqual([]);
  });

  it('a report without a stored file is simply deleted, with no storage call', async () => {
    const w = world({ reports: [{ id: REPORT, userId: USER, fileUrl: null }] });
    expect((await deleteReportAndFiles(w.actions, USER, REPORT)).status).toBe('deleted');
    expect(w.removeCalls).toEqual([]);
  });

  it('storage failure: retries inline, records the failure, keeps the record, and never reports success', async () => {
    const w = world({ ...own(), removal: () => failing() });
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('file_cleanup_pending');
    expect(w.removeCalls).toHaveLength(REPORT_FILE_ATTEMPTS);
    expect(w.sleeps).toEqual([...RETRY_BACKOFF_MS]);
    expect(w.reports.has(REPORT)).toBe(false);
    expect(w.queue).toMatchObject([{ reportId: REPORT, attempts: 1, lastError: 'storage unavailable' }]);
    expect(deletionResponse(result)).toEqual({ status: 503, body: {
      success: false, code: FILE_CLEANUP_PENDING_CODE, report_deleted: true, retry: true,
      error: 'The report was deleted, but its uploaded file could not be removed yet. Please try again.',
    } });
  });

  it('a thrown storage error is a failed attempt, not a crash', async () => {
    const w = world({ ...own(), removal: () => new Error('socket hang up') });
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('file_cleanup_pending');
    expect(w.queue).toMatchObject([{ attempts: 1, lastError: 'socket hang up' }]);
  });

  it('a transient failure that clears on retry completes within the same request', async () => {
    const w = world({ ...own(), removal: (_path, call) => (call === 1 ? failing() : undefined) });
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('deleted');
    expect(w.removeCalls).toHaveLength(2);
    expect(w.sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(w.objects.size).toBe(0);
    expect(w.queue).toEqual([]);
  });

  it('retry: calling again for the same report drains the recorded file without erasing anything twice', async () => {
    let storageUp = false;
    const w = world({ ...own(), removal: () => (storageUp ? undefined : failing()) });
    expect((await deleteReportAndFiles(w.actions, USER, REPORT)).status).toBe('file_cleanup_pending');
    storageUp = true;
    w.calls.length = 0;
    const retry = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(retry.status).toBe('already_deleted');
    expect(w.calls.filter((c) => c.startsWith('eraseReports'))).toEqual([]);
    expect(w.objects.size).toBe(0);
    expect(w.queue).toEqual([]);
    expect(deletionResponse(retry)).toEqual({ status: 200, body: { success: true, status: 'already_deleted' } });
    // And again: nothing left, still success.
    expect((await deleteReportAndFiles(w.actions, USER, REPORT)).status).toBe('already_deleted');
  });

  it('never erases or touches another user\'s report, and answers exactly as for an unknown id', async () => {
    const w = world({
      reports: [{ id: OTHERS_REPORT, userId: OTHER, fileUrl: `${OTHER}/1.pdf` }],
      objects: [`${OTHER}/1.pdf`],
      queue: [{ id: 'theirs', userId: OTHER, reportId: OTHERS_REPORT, fileRef: `${OTHER}/2.pdf` }],
    });
    const result = await deleteReportAndFiles(w.actions, USER, OTHERS_REPORT);
    const unknown = await deleteReportAndFiles(world().actions, USER, OTHERS_REPORT);
    expect(deletionResponse(result)).toEqual(deletionResponse(unknown));
    expect(w.calls.filter((c) => c.startsWith('eraseReports'))).toEqual([]);
    expect(w.removeCalls).toEqual([]);
    expect(w.reports.has(OTHERS_REPORT)).toBe(true);
    expect(w.queue.map((q) => q.id)).toEqual(['theirs']);
    expect([...w.scopedUsers]).toEqual([USER]);
  });

  it('an ownership-read or erase failure throws before any storage call (handler answers 500, not deleted)', async () => {
    for (const step of ['ownsReport', 'eraseReports'] as const) {
      const w = world({ ...own(), fail: { [step]: new Error(`${step} offline`) } });
      await expect(deleteReportAndFiles(w.actions, USER, REPORT)).rejects.toThrow(`${step} offline`);
      expect(w.removeCalls).toEqual([]);
      expect(w.reports.has(REPORT)).toBe(true);
    }
    expect(deletionFailedResponse()).toEqual({ status: 500, body: {
      success: false, code: 'report_deletion_failed', report_deleted: false, retry: true,
      error: 'The report could not be deleted. Please try again.',
    } });
  });

  it('after the erase, a failed listing is pending, never success', async () => {
    for (const step of ['listPendingCleanups', 'listLiveFileRefs'] as const) {
      const w = world({ ...own(), fail: { [step]: new Error('db offline') } });
      const result = await deleteReportAndFiles(w.actions, USER, REPORT);
      expect(result.status).toBe('file_cleanup_pending');
      expect(w.reports.has(REPORT)).toBe(false);
      expect(w.removeCalls).toEqual([]);
      expect(w.queue).toHaveLength(1);
    }
  });

  it('a removed file whose record could not be completed is reported pending; the retry finds it missing and succeeds', async () => {
    const w = world({ ...own(), fail: { completeCleanups: new Error('db offline') } });
    expect((await deleteReportAndFiles(w.actions, USER, REPORT)).status).toBe('file_cleanup_pending');
    expect(w.objects.size).toBe(0);
    expect(w.queue).toHaveLength(1);
    const healthy = world({ queue: w.queue.map((q) => ({ ...q })) });
    const retry = await deleteReportAndFiles(healthy.actions, USER, REPORT);
    expect(retry.status).toBe('already_deleted');
    expect(retry.items.map((i) => i.outcome)).toEqual(['missing']);
    expect(healthy.queue).toEqual([]);
  });

  it('never removes outside the caller\'s folder: a foreign reference completes without a storage call', async () => {
    const w = world({ reports: [{ id: REPORT, userId: USER, fileUrl: `${OTHER}/1725379200000.pdf` }], objects: [`${OTHER}/1725379200000.pdf`] });
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('deleted');
    expect(result.items.map((i) => i.outcome)).toEqual(['not_owned']);
    expect(w.removeCalls).toEqual([]);
    expect(w.objects.has(`${OTHER}/1725379200000.pdf`)).toBe(true);
    expect(w.queue).toEqual([]);
  });

  it('an unrecognized reference is never removed and never reported as success', async () => {
    const w = world({ reports: [{ id: REPORT, userId: USER, fileUrl: 'https://example.com/report.pdf' }] });
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('file_cleanup_pending');
    expect(w.removeCalls).toEqual([]);
    expect(w.queue).toMatchObject([{ attempts: 1, lastError: 'Unrecognized file reference; not removed' }]);
  });

  it('keeps an object a live report of the same user still references', async () => {
    const file = `${USER}/1725379200000.pdf`;
    const w = world({
      reports: [{ id: REPORT, userId: USER, fileUrl: file }, { id: REPORT_2, userId: USER, fileUrl: file }],
      objects: [file],
    });
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('deleted');
    expect(result.items.map((i) => i.outcome)).toEqual(['still_referenced']);
    expect(w.removeCalls).toEqual([]);
    expect(w.objects.has(file)).toBe(true);
    expect(w.queue).toEqual([]);
  });

  it('drains the caller\'s older backlog once each, bounded, without changing this report\'s verdict', async () => {
    const backlog = Array.from({ length: BACKLOG_DRAIN_LIMIT + 5 }, (_, n) => ({
      id: `old${n}`, userId: USER, reportId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      fileRef: `${USER}/old-${n}.pdf`,
    }));
    const w = world({
      ...own(),
      objects: [`${USER}/1725379200000.pdf`, ...backlog.map((b) => b.fileRef)],
      queue: [...backlog, { id: 'theirs', userId: OTHER, reportId: OTHERS_REPORT, fileRef: `${OTHER}/x.pdf` }],
      removal: (path) => (path === `${USER}/old-0.pdf` ? failing('still down') : undefined),
    });
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('deleted');
    // This report first, then the backlog oldest first, one attempt each.
    expect(w.removeCalls[0]).toBe(`${USER}/1725379200000.pdf`);
    expect(result.backlog).toHaveLength(BACKLOG_DRAIN_LIMIT);
    expect(w.removeCalls.filter((p) => p === `${USER}/old-0.pdf`)).toHaveLength(1);
    expect(result.backlog[0]).toMatchObject({ itemId: 'old0', outcome: 'pending' });
    expect(w.queue.map((q) => q.id)).toEqual(['old0', ...backlog.slice(BACKLOG_DRAIN_LIMIT).map((b) => b.id), 'theirs']);
    expect(w.queue[0]).toMatchObject({ attempts: 1, lastError: 'still down' });
    expect(w.sleeps).toEqual([]);
  });

  it('while this report\'s file is pending, the backlog is left for a later call', async () => {
    const w = world({
      ...own(),
      objects: [`${USER}/1725379200000.pdf`, `${USER}/old.pdf`],
      queue: [{ id: 'old', userId: USER, reportId: REPORT_2, fileRef: `${USER}/old.pdf` }],
      removal: (path) => (path === `${USER}/1725379200000.pdf` ? failing() : undefined),
    });
    const result = await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(result.status).toBe('file_cleanup_pending');
    expect(result.backlog).toEqual([]);
    expect(w.removeCalls).not.toContain(`${USER}/old.pdf`);
    expect(w.queue.find((q) => q.id === 'old')).toMatchObject({ attempts: 0 });
  });

  it('a failing backlog read never turns a finished deletion into an error', async () => {
    const w = world(own());
    let reads = 0;
    const list = w.actions.listPendingCleanups;
    w.actions.listPendingCleanups = async (userId, filter) => {
      if (++reads === 2) throw new Error('backlog read failed');
      return list(userId, filter);
    };
    expect((await deleteReportAndFiles(w.actions, USER, REPORT)).status).toBe('deleted');
  });

  it('every storage call stays inside the caller\'s own folder', async () => {
    const w = world({
      reports: [{ id: REPORT, userId: USER, fileUrl: `https://x.supabase.co/storage/v1/object/public/lab-files/${USER}/1.pdf` }],
      queue: [
        { id: 'a', userId: USER, reportId: REPORT_2, fileRef: `${OTHER}/stolen.pdf` },
        { id: 'b', userId: USER, reportId: REPORT_2, fileRef: `${USER}/../${OTHER}/stolen.pdf` },
        { id: 'c', userId: USER, reportId: REPORT_2, fileRef: `${USER}/2.pdf` },
      ],
    });
    await deleteReportAndFiles(w.actions, USER, REPORT);
    expect(w.removeCalls).toEqual([`${USER}/1.pdf`, `${USER}/2.pdf`]);
    for (const path of w.removeCalls) expect(path.startsWith(`${USER}/`)).toBe(true);
  });
});
