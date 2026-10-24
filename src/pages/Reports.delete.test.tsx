// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../components/axe.testkit';
import { closeTopOverlay } from '../lib/overlayStack';
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
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); // the dialog's scroll lock restores the position
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
  vi.restoreAllMocks();
  fixture.invoke.mockReset();
  fixture.tableDelete.mockReset();
});

async function renderReports() {
  await act(async () => root.render(<MemoryRouter><Reports /></MemoryRouter>));
}
// The dialog is portalled to <body>, outside the app container.
const button = (text: string) => Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
const rowDeleteButtons = () => app.querySelectorAll('button[aria-label="Delete report"]');
const deleteCalls = () => fixture.invoke.mock.calls.filter(([name]) => name === 'delete-report');

async function openAndConfirm() {
  await act(async () => (rowDeleteButtons()[0] as HTMLButtonElement).click());
  expect(document.body.textContent).toContain('Delete report?');
  expect(document.body.textContent).toContain('any uploaded lab file');
  await act(async () => button('Delete report')!.click());
}

it('deletes through delete-report and closes only on confirmed success', async () => {
  await renderReports();
  expect(rowDeleteButtons().length).toBeGreaterThan(0);
  await openAndConfirm();
  expect(deleteCalls()).toEqual([['delete-report', { body: { report_id: 'report-1' } }]]);
  expect(fixture.tableDelete).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('Delete report?');
  expect(rowDeleteButtons()).toHaveLength(0);
});

it('file removal pending: the row goes, the dialog says the file is left, and Try again finishes it', async () => {
  fixture.deleteReply = pending;
  await renderReports();
  await openAndConfirm();
  expect(rowDeleteButtons()).toHaveLength(0);
  expect(document.body.textContent).toContain('Uploaded file not removed yet');
  expect(document.body.textContent).toContain(REPORT_FILE_PENDING_MESSAGE);
  expect(document.body.textContent).not.toContain('Delete report?');
  fixture.deleteReply = () => ({ data: { success: true, status: 'already_deleted' }, error: null });
  await act(async () => button('Try again')!.click());
  expect(deleteCalls()).toHaveLength(2);
  expect(document.body.textContent).not.toContain('Uploaded file not removed yet');
});

it('closing a pending dialog does not claim success, and a failed deletion keeps the row', async () => {
  fixture.deleteReply = pending;
  await renderReports();
  await openAndConfirm();
  await act(async () => button('Close')!.click());
  expect(document.body.textContent).not.toContain('Uploaded file not removed yet');
  await act(async () => root.unmount());
  root = createRoot(app);
  fixture.deleteReply = () => ({ data: null, error: new FunctionsHttpError(new Response('{}', { status: 500 })) });
  await renderReports();
  await openAndConfirm();
  expect(document.body.textContent).toContain(REPORT_DELETE_FAILED_MESSAGE);
  expect(document.body.textContent).toContain('Delete report?');
  expect(rowDeleteButtons().length).toBeGreaterThan(0);
});

// Review F066: the dialog was a plain fixed z-50 div. It is the shared Modal now.
describe('the delete dialog is an accessible dialog', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const escape = () => act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  const open = async () => {
    await renderReports();
    await act(async () => (rowDeleteButtons()[0] as HTMLButtonElement).click());
  };

  it('is a named modal dialog above the bottom nav, with a 44px Close button, and passes axe', async () => {
    await open();
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-label')).toBe('Delete report?');
    expect(d.parentElement!.classList.contains('z-[60]')).toBe(true);
    const close = d.querySelector<HTMLElement>('button[aria-label="Close"]')!;
    expect(close.className).toContain('h-11');
    expect(await axeViolations(d)).toEqual([]);
  });

  it('Escape cancels it', async () => {
    await open();
    expect(dialog()).not.toBeNull();
    await escape();
    expect(dialog()).toBeNull();
    expect(document.body.textContent).not.toContain('Delete report?');
    expect(deleteCalls()).toHaveLength(0);
  });

  it('Escape, the backdrop and the back button do nothing while the delete is in flight', async () => {
    let finish!: () => void;
    fixture.invoke.mockImplementation(() => new Promise(resolve => {
      finish = () => resolve({ data: { success: true, status: 'deleted' }, error: null });
    }));
    await open();
    await act(async () => button('Delete report')!.click());
    expect(button('Deleting...')!.disabled).toBe(true);
    await escape();
    await act(async () => dialog()!.parentElement!.click());
    await act(async () => { closeTopOverlay(); });
    expect(dialog()).not.toBeNull();
    await act(async () => finish());
    expect(dialog()).toBeNull();
  });

  it('the Android back button cancels it rather than leaving the page', async () => {
    await open();
    await act(async () => { expect(closeTopOverlay()).toBe(true); });
    expect(dialog()).toBeNull();
  });
});
