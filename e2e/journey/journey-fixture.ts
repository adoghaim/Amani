import { test as base, expect, type Page } from '@playwright/test';
import { assertNetworkAllowed, guardWebSocket, origin } from '../network-guard';
import { API_ORIGIN, FakeSupabase } from './fake-supabase';
import { ServerModel } from './server-model';
import { dataUrl, ocrItems, UPLOADS, type SyntheticUpload } from './lab-fixtures';

/*
  PK-03e-I fixture. Default mode: the production build (vite preview) talks to
  the in-memory stand-in (fake-supabase.ts + server-model.ts) and nothing else;
  any other request fails the test. Real mode (E2E_REAL_SUPABASE=1, with
  SUPABASE_URL / SUPABASE_ANON_KEY naming a LOCAL stack, see e2e/server.mjs):
  no stand-in, requests go to that stack, and steps that need a privileged
  server write the browser cannot make (seeding an OCR answer, granting a
  subscription) are skipped and reported as pending.
*/

export const REAL_SUPABASE = process.env.E2E_REAL_SUPABASE === '1';
const realOrigin = REAL_SUPABASE && process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : null;

export interface Backend { db: FakeSupabase; server: ServerModel }

export const test = base.extend<{ backend: Backend | null }>({
  backend: async ({ context }, provide) => {
    const unexpected: string[] = [];
    let backend: Backend | null = null;
    if (!REAL_SUPABASE) {
      const db = new FakeSupabase();
      const server = new ServerModel(db);
      for (const upload of UPLOADS) server.ocr.set(dataUrl(upload.png), ocrItems(upload));
      backend = { db, server };
    }
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && request.method() === 'GET') return route.continue();
      if (backend && url.origin === API_ORIGIN) return backend.db.handle(route);
      if (realOrigin && url.origin === realOrigin) return route.continue();
      // Never record query strings, headers or payloads.
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', socket => guardWebSocket(socket, unexpected));
    await provide(backend);
    assertNetworkAllowed([...unexpected, ...(backend?.db.unexpected ?? [])]);
  },
});

export { expect };

/** /signup -> account -> onboarding (completed through the real flow) -> /app/new. */
export async function signUpFreshUser(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password-1');
  await page.getByLabel('Confirm password').fill('synthetic-password-1');
  const duplicate = REAL_SUPABASE ? null : page.waitForResponse(r => new URL(r.url()).pathname === '/rest/v1/users' && r.request().method() === 'POST');
  const created = page.waitForResponse(r => r.url().endsWith('/auth/v1/signup'));
  await page.getByRole('button', { name: 'Create account' }).click();
  expect((await created).status()).toBe(200);
  if (duplicate) {
    const response = await duplicate;
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ code: '23505' });
  }
  await page.waitForURL(/\/(app|onboarding)$/);
  // The signup -> /app -> /onboarding hand-off is the quarantined redirect race
  // (e2e/smoke.spec.ts @quarantine, specs/BACKLOG-1.0.7.md item 11): it can
  // strand the page blank. Not fixed here (no product change); the journey
  // re-enters onboarding by URL, restoring the stored session as a reload does.
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'I Understand' }).click();
  await page.locator('button[aria-pressed]').first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Upload Lab Report' }).click();
  await expect(page).toHaveURL(/\/app\/new$/);
}

/** /app/new: choose the image -> server OCR -> review -> confirm -> save. Returns the report id. */
export async function uploadLab(page: Page, upload: SyntheticUpload): Promise<string> {
  if (!page.url().endsWith('/app/new')) await page.goto('/app/new');
  await page.locator('#file-upload').setInputFiles({ name: `${upload.label}.png`, mimeType: 'image/png', buffer: upload.png });
  const extracted = page.waitForResponse(r => r.url().endsWith('/functions/v1/parse-lab-report-ocr'));
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Review your report' })).toBeVisible();
  expect((await extracted).status()).toBe(200);
  await page.getByLabel('Date your blood was drawn').fill(upload.reportDate);
  // Extraction finished: the server OCR rows are on the confirm step.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your markers' })).toBeVisible();
  // Settled: the report page has opened and read its interpretation once.
  const read = page.waitForResponse(r => r.url().endsWith('/functions/v1/get-interpretation') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save and analyze' }).click();
  await page.waitForURL(/\/app\/reports\/[0-9a-f-]{36}$/);
  await read;
  await expect(page.getByText(/^Lab Report: /).first()).toBeVisible();
  return page.url().split('/').at(-1)!;
}
