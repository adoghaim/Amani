import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { test, expect, RUNTIME_CONFIG_SEED_REPLY } from '../fixtures';

/*
  PK-EXP5 in a real browser against the synthetic network (fixtures.ts fails
  the test on any request it does not expect, so these also prove which calls
  are made and which are not):
    - flag off (the seed): no code link, no event call, nothing stored;
    - flag on: a campaign link /go/<key> pre-fills the code ("Code saved: KEY"),
      the field rejects other characters inline, landing_view goes to
      log-anon-event with the first-touch UTM and a device id, a signup attempt
      sends signup_started, and axe (colour contrast on) finds nothing.
  Synthetic only: log-anon-event and the signup endpoint are fulfilled here.
*/

const api = 'https://amani-e2e.invalid';
// The real gateway answers with CORS headers; without them WebKit reports the blocked read itself.
const CORS = { 'access-control-allow-origin': '*' };
const FLAG_ON = {
  status: 200,
  body: (RUNTIME_CONFIG_SEED_REPLY.body as Array<{ key: string; value: unknown }>)
    .map(row => row.key === 'features' ? { key: 'features', value: { first_party_events: true } } : row),
};

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
async function axeViolations(page: Page, selector: string): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async (scope) => {
    const axe = (window as unknown as { axe: { run: (n: Element) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const result = await axe.run(document.querySelector(scope)!);
    return result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
  }, selector);
}

async function recordAnonEvents(page: Page) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route(`${api}/functions/v1/log-anon-event`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { ok: true }, headers: CORS });
  });
  return bodies;
}

const codeLink = (page: Page) => page.getByRole('button', { name: 'Have a promo or referral code?' });

test.describe('first-party events off (the seed)', () => {
  test('no code link, no event call, nothing stored', async ({ page, runtimeConfigReads }) => {
    await page.goto('/?utm_source=tiktok&promo=SPRING25');
    await expect(page.getByRole('heading', { level: 1, name: 'Your labs, read in context.' })).toBeVisible();
    await page.goto('/go/creator.jane');
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    await expect.poll(() => runtimeConfigReads.length).toBe(2);
    await expect(codeLink(page)).toHaveCount(0);
    const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => /first-touch|signup-code|signup-pending|anon-id/.test(k)));
    expect(stored).toEqual([]);
  });
});

test.describe('first-party events on', () => {
  test.use({ runtimeConfigReply: FLAG_ON });

  test('a campaign link pre-fills the code and confirms it; bad characters get an inline hint; axe is clean', async ({ page }) => {
    await recordAnonEvents(page);
    await page.goto('/go/creator.jane?utm_source=youtube');
    await expect(page).toHaveURL(/\/signup$/);
    const link = codeLink(page);
    await expect(link).toHaveAttribute('aria-expanded', 'true');
    const field = page.getByLabel('Promo or referral code');
    await expect(field).toHaveValue('creator.jane');
    await expect(page.getByText('Code saved: creator.jane')).toBeVisible();
    // Above the Google button and the email form (D17).
    const linkBox = (await link.boundingBox())!;
    expect(linkBox.y).toBeLessThan((await page.getByRole('button', { name: 'Continue with Google' }).boundingBox())!.y);
    expect(linkBox.y).toBeLessThan((await page.getByLabel('Email').boundingBox())!.y);
    expect(linkBox.height).toBeGreaterThanOrEqual(44);
    expect(await axeViolations(page, '[data-signup-code]')).toEqual([]);

    await field.fill('creator jane!');
    await expect(page.getByText('Use only letters, numbers, dots, hyphens and underscores.')).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(/^Code saved:/)).toHaveCount(0);
    expect(await axeViolations(page, '[data-signup-code]')).toEqual([]);
    await expect(page.getByText(/discount/i)).toHaveCount(0);

    await field.fill('SPRING25');
    await expect(page.getByText('Code saved: SPRING25')).toBeVisible();
    const held = await page.evaluate(() => JSON.parse(localStorage.getItem('amani.signup-code.v1') ?? 'null'));
    expect(held.code).toBe('SPRING25');
  });

  test('landing_view and signup_started go to log-anon-event with first-touch UTM and a device id', async ({ page }) => {
    const bodies = await recordAnonEvents(page);
    await page.route(`${api}/auth/v1/signup*`, route => route.fulfill({ status: 422, json: { msg: 'Synthetic: signup refused' }, headers: CORS }));
    await page.goto('/?utm_source=tiktok&utm_campaign=spring&ref=dr.jane&gclid=ignored');
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ event: 'landing_view', props: { platform: 'web', utm_source: 'tiktok', utm_campaign: 'spring', ref: 'dr.jane' } });
    expect(bodies[0]!.anon_id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(JSON.stringify(bodies[0])).not.toContain('gclid');

    await page.goto('/signup');
    await page.getByLabel('Email').fill('synthetic@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
    await page.getByLabel('Confirm password').fill('synthetic-password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Synthetic: signup refused')).toBeVisible();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toMatchObject({ event: 'signup_started', anon_id: bodies[0]!.anon_id, props: { utm_source: 'tiktok' } });
    const firstTouch = await page.evaluate(() => JSON.parse(localStorage.getItem('amani.first-touch.v1') ?? 'null'));
    expect(firstTouch.params).toEqual({ utm_source: 'tiktok', utm_campaign: 'spring', ref: 'dr.jane' });
  });

  test('log-anon-event missing (not deployed) never shows: the page works and nothing surfaces', async ({ page }) => {
    let calls = 0;
    await page.route(`${api}/functions/v1/log-anon-event`, route => {
      calls += 1;
      return route.fulfill({ status: 404, body: 'Function not found', headers: CORS });
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?utm_source=tiktok');
    await expect(page.getByRole('heading', { level: 1, name: 'Your labs, read in context.' })).toBeVisible();
    await expect.poll(() => calls).toBe(1);
    await page.goto('/signup');
    await expect(codeLink(page)).toBeVisible();
    // WebKit can report a lazy chunk cut off by page.goto; only this feature's errors count here.
    expect(errors.filter(e => /log-anon-event|first.party|anon/i.test(e))).toEqual([]);
  });
});
