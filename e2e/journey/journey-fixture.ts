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

/** /signup -> persisted session -> onboarding in a new Page -> /app/new. Returns that Page. */
export async function signUpFreshUser(signupPage: Page, email: string): Promise<Page> {
  await signupPage.goto('/signup');
  await signupPage.getByLabel('Email').fill(email);
  await signupPage.getByLabel('Password', { exact: true }).fill('synthetic-password-1');
  await signupPage.getByLabel('Confirm password').fill('synthetic-password-1');
  const created = signupPage.waitForResponse(r => r.url().endsWith('/auth/v1/signup'));
  await signupPage.getByRole('button', { name: 'Create account' }).click();
  const response = await created;
  expect(response.status()).toBe(200);
  const signup = await response.json() as { user: { id: string } };
  expect(signup.user.id).toEqual(expect.any(String));
  await signupPage.waitForURL(/\/(app|onboarding)$/);
  const persistedUserIds = (page: Page) => page.evaluate(() => Object.keys(localStorage)
    .filter(key => /^sb-.*-auth-token$/.test(key))
    .map(key => (JSON.parse(localStorage.getItem(key)!) as { user?: { id?: string } }).user?.id));
  expect(await persistedUserIds(signupPage)).toEqual([signup.user.id]);
  // Close the signup Page to destroy its router without racing another navigation.
  // The new Page shares the context's routes and app-managed localStorage only;
  // no auth is seeded or rewritten. Automatic redirects remain quarantined.
  const page = await signupPage.context().newPage();
  await signupPage.close();
  expect(signupPage.isClosed()).toBe(true);
  await page.goto('/onboarding');
  expect(await persistedUserIds(page)).toEqual([signup.user.id]);
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'I Understand' }).click();
  await page.locator('button[aria-pressed]').first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Upload Lab Report' }).click();
  await expect(page).toHaveURL(/\/app\/new$/);
  return page;
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
