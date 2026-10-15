import { describe, expect, it, vi } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import {
  REPORT_DELETE_FAILED_MESSAGE,
  REPORT_FILE_PENDING_MESSAGE,
  requestReportDeletion,
  type InvokeFn,
} from './reportDeletion';

const REPORT = '11111111-2222-4333-8444-555555555555';
const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('requestReportDeletion', () => {
  it('calls delete-report (never a direct table delete) with the report id', async () => {
    const invoke = vi.fn<InvokeFn>(async () => ({ data: { success: true, status: 'deleted' }, error: null }));
    expect(await requestReportDeletion(invoke, REPORT)).toEqual({ kind: 'deleted' });
    expect(invoke).toHaveBeenCalledWith('delete-report', { body: { report_id: REPORT } });
  });

  it('treats an idempotent already_deleted answer as deleted', async () => {
    const invoke: InvokeFn = async () => ({ data: { success: true, status: 'already_deleted' }, error: null });
    expect(await requestReportDeletion(invoke, REPORT)).toEqual({ kind: 'deleted' });
  });

  it('a 503 file_cleanup_pending is NOT success: the report is gone, the file is not', async () => {
    const invoke: InvokeFn = async () => ({ data: null, error: httpError(503, {
      success: false, code: 'file_cleanup_pending', report_deleted: true, retry: true, error: 'server text',
    }) });
    expect(await requestReportDeletion(invoke, REPORT)).toEqual({ kind: 'file_pending', message: REPORT_FILE_PENDING_MESSAGE });
  });

  it('anything without explicit proof of success is failed', async () => {
    const cases: Array<Awaited<ReturnType<InvokeFn>> | Error> = [
      { data: null, error: httpError(500, { success: false, code: 'report_deletion_failed', report_deleted: false, retry: true }) },
      { data: null, error: httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }) },
      { data: null, error: httpError(503, { code: 'file_cleanup_pending' }) },
      { data: null, error: httpError(502, 'not json') },
      { data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) },
      { data: { success: 'true' }, error: null },
      { data: null, error: null },
      { data: 'ok', error: null },
      new Error('invoke threw'),
    ];
    for (const result of cases) {
      const invoke: InvokeFn = async () => { if (result instanceof Error) throw result; return result; };
      expect(await requestReportDeletion(invoke, REPORT)).toEqual({ kind: 'failed', message: REPORT_DELETE_FAILED_MESSAGE });
    }
  });

  it('a body that cannot be read is failed, not pending', async () => {
    const error = { context: { status: 503, json: async () => { throw new SyntaxError('bad json'); } } };
    expect(await requestReportDeletion(async () => ({ data: null, error }), REPORT))
      .toEqual({ kind: 'failed', message: REPORT_DELETE_FAILED_MESSAGE });
  });
});
