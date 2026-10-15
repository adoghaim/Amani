// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { REPORT_DELETE_FAILED_MESSAGE, REPORT_FILE_PENDING_MESSAGE } from '../lib/reportDeletion';

// PK-FIX-04: the reports list deletes through the delete-report function and
// only closes the dialog when the report AND its uploaded file are gone.
const REPORT = {
  id: 'report-1', user_id: 'user-1', report_date: '2026-09-01', upload_date: '2026-09-02T10:00:00Z',
  status: 'ready', estimated_cycle_phase: 'luteal', file_url: 'user-1/1725379200000.pdf',
};
const fixture = vi.hoisted(() => ({
  // Stable identity: Reports refetches whenever `user` changes.
  auth: { user: { id: 'user-1' } },
  invoke: vi.fn(),
  tableDelete: vi.fn(),
  deleteReply: null as null | (() => { data: unknown; error: unknown }),
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  functions: { invoke: fixture.invoke },
  from: (table: string) => {
    const result = { data: table === 'lab_reports' ? [REPORT] : [], error: null };
    const query = {
      delete: () => { fixture.tableDelete(table); return query; },
      select: () => query, eq: () => query, in: () => query, order: () => query,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  },
} }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => fixture.auth }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
import { Reports } from './Reports';

const pending = () => ({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({
  success: false, code: 'file_cleanup_pending', report_deleted: true, retry: true,
}), { status: 503 })) });

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.deleteReply = () => ({ data: { success: true, status: 'deleted' }, error: null });
  fixture.invoke.mockImplementation(async (name: string) => (name === 'delete-report'
    ? fixture.deleteReply!() : { data: null, error: new Error(`unexpected ${name}`) }));
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
  fixture.invoke.mockReset();
  fixture.tableDelete.mockReset();
});

async function renderReports() {
  await act(async () => root.render(<MemoryRouter><Reports /></MemoryRouter>));
}
const button = (text: string) => Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
const rowDeleteButtons = () => app.querySelectorAll('button[aria-label="Delete report"]');
const deleteCalls = () => fixture.invoke.mock.calls.filter(([name]) => name === 'delete-report');

async function openAndConfirm() {
  await act(async () => (rowDeleteButtons()[0] as HTMLButtonElement).click());
  expect(app.textContent).toContain('Delete report?');
  expect(app.textContent).toContain('any uploaded lab file');
  await act(async () => button('Delete report')!.click());
}

it('deletes through delete-report and closes only on confirmed success', async () => {
  await renderReports();
  expect(rowDeleteButtons().length).toBeGreaterThan(0);
  await openAndConfirm();
  expect(deleteCalls()).toEqual([['delete-report', { body: { report_id: 'report-1' } }]]);
  expect(fixture.tableDelete).not.toHaveBeenCalled();
  expect(app.textContent).not.toContain('Delete report?');
  expect(rowDeleteButtons()).toHaveLength(0);
});

it('file removal pending: the row goes, the dialog says the file is left, and Try again finishes it', async () => {
  fixture.deleteReply = pending;
  await renderReports();
  await openAndConfirm();
  expect(rowDeleteButtons()).toHaveLength(0);
  expect(app.textContent).toContain('Uploaded file not removed yet');
  expect(app.textContent).toContain(REPORT_FILE_PENDING_MESSAGE);
  expect(app.textContent).not.toContain('Delete report?');
  fixture.deleteReply = () => ({ data: { success: true, status: 'already_deleted' }, error: null });
  await act(async () => button('Try again')!.click());
  expect(deleteCalls()).toHaveLength(2);
  expect(app.textContent).not.toContain('Uploaded file not removed yet');
});

it('closing a pending dialog does not claim success, and a failed deletion keeps the row', async () => {
  fixture.deleteReply = pending;
  await renderReports();
  await openAndConfirm();
  await act(async () => button('Close')!.click());
  expect(app.textContent).not.toContain('Uploaded file not removed yet');
  await act(async () => root.unmount());
  root = createRoot(app);
  fixture.deleteReply = () => ({ data: null, error: new FunctionsHttpError(new Response('{}', { status: 500 })) });
  await renderReports();
  await openAndConfirm();
  expect(app.textContent).toContain(REPORT_DELETE_FAILED_MESSAGE);
  expect(app.textContent).toContain('Delete report?');
  expect(rowDeleteButtons().length).toBeGreaterThan(0);
});
