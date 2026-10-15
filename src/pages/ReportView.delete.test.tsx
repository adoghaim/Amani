// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { REPORT_DELETE_FAILED_MESSAGE, REPORT_FILE_PENDING_MESSAGE } from '../lib/reportDeletion';

// PK-FIX-04: the report page deletes through the delete-report function (report
// graph + uploaded file), leaves only on confirmed success, and says exactly
// what is left otherwise. Same supabase stand-in as ReportView.test.tsx.
const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  tableDelete: vi.fn(),
  deleteReply: null as null | (() => { data: unknown; error: unknown }),
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  functions: { invoke: fixture.invoke },
  from: (table: string) => {
    const result = { data: table === 'lab_reports' ? {
      id: 'report-1', status: 'complete', report_date: '2026-09-01',
      regeneration_count: 0, estimated_cycle_phase: 'unknown', lab_name: 'Test lab',
    } : [], error: null };
    const query = {
      delete: () => { fixture.tableDelete(table); return query; },
      update: () => query,
      select: () => query, eq: () => query, order: () => query,
      maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  },
} }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({
  entitled: false, plan: 'free', complimentary: { used: 3, total: 3, remaining: 0 }, refetch: vi.fn(),
}) }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../components/freemium/PremiumPaywall', () => ({ PremiumPaywall: () => null }));
import { ReportView } from './ReportView';

const pending = () => ({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({
  success: false, code: 'file_cleanup_pending', report_deleted: true, retry: true,
}), { status: 503 })) });
const failure = () => ({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({
  success: false, code: 'report_deletion_failed', report_deleted: false, retry: true,
}), { status: 500 })) });

let root: Root;
let app: HTMLDivElement;
let confirmSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true');
  confirmSpy = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmSpy);
  fixture.deleteReply = () => ({ data: { success: true, status: 'deleted' }, error: null });
  fixture.invoke.mockImplementation(async (name: string) => {
    if (name === 'get-interpretation') return { data: { access: 'generation_needed', interpretation: null, stored_depth: 'shallow' }, error: null };
    if (name === 'delete-report') return fixture.deleteReply!();
    return { data: null, error: new Error('offline') };
  });
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fixture.invoke.mockReset();
  fixture.tableDelete.mockReset();
});

async function renderReport() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/app/reports/report-1']}>
      <Routes>
        <Route path="/app/reports/:id" element={<ReportView />} />
        <Route path="/app" element={<p>dashboard home</p>} />
      </Routes>
    </MemoryRouter>,
  ));
}
const button = (text: string) => Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
// PK-INT-01 (#107): delete lives in the report header's labelled More menu as the
// 'delete-report' action ("Delete report", or "Retry file removal" while the
// file is pending). Open More, then choose the action, as a person would.
const moreAction = (text: string) =>
  Array.from(app.querySelectorAll<HTMLButtonElement>('[data-more-item]')).find(b => b.textContent?.trim() === text);
async function chooseMore(text: string) {
  await act(async () => button('More')!.click());
  await act(async () => moreAction(text)!.click());
}
const deleteCalls = () => fixture.invoke.mock.calls.filter(([name]) => name === 'delete-report');

it('deletes through delete-report, never a direct lab_reports delete, and leaves on success', async () => {
  await renderReport();
  await chooseMore('Delete report');
  expect(confirmSpy).toHaveBeenCalledOnce();
  expect(deleteCalls()).toEqual([['delete-report', { body: { report_id: 'report-1' } }]]);
  expect(fixture.tableDelete).not.toHaveBeenCalled();
  expect(app.textContent).toContain('dashboard home');
});

it('does nothing when the confirmation is declined', async () => {
  confirmSpy.mockReturnValue(false);
  await renderReport();
  await chooseMore('Delete report');
  expect(deleteCalls()).toEqual([]);
  expect(app.textContent).not.toContain('dashboard home');
});

it('file removal pending: stays, says the file is not removed, and retries without asking again', async () => {
  fixture.deleteReply = pending;
  await renderReport();
  await chooseMore('Delete report');
  expect(app.textContent).not.toContain('dashboard home');
  expect(app.textContent).toContain(REPORT_FILE_PENDING_MESSAGE);
  expect(moreAction('Retry file removal')).toBeDefined();
  fixture.deleteReply = () => ({ data: { success: true, status: 'already_deleted' }, error: null });
  await chooseMore('Retry file removal');
  expect(confirmSpy).toHaveBeenCalledOnce();
  expect(deleteCalls()).toHaveLength(2);
  expect(app.textContent).toContain('dashboard home');
});

it('a failed deletion is shown, never treated as success', async () => {
  fixture.deleteReply = failure;
  await renderReport();
  await chooseMore('Delete report');
  expect(app.textContent).toContain(REPORT_DELETE_FAILED_MESSAGE);
  expect(app.textContent).not.toContain('dashboard home');
  expect(moreAction('Delete report')).toBeDefined();
});
