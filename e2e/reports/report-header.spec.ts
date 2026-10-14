import { test, expect } from '../fixtures';
import AxeBuilder from '@axe-core/playwright';
import { stage2CurrentReport, stage2PriorReport } from './synthetic-reports';

/*
  PK-INT-01 additions (D19, D23): the real ReportView's header slot in a real
  browser, against the synthetic network. One labelled More menu holds
  "Regenerate (N left)" and then "Delete report", last and behind its
  confirmation; axe (colour contrast on) finds nothing in the header with the
  menu open.
*/

const reportId = stage2CurrentReport.report.id;

test.describe('report header slot (D19)', () => {
  test.use({ authenticated: true, syntheticReports: [[stage2CurrentReport, stage2PriorReport], { scope: 'test' }] });

  test('More holds Regenerate then Delete report; Escape returns focus; Delete still asks first; axe is clean', async ({ page }) => {
    // The flag-off Regenerate action requires an entitled reader.
    await page.route('https://amani-e2e.invalid/rest/v1/stripe_user_subscriptions*', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: [{ subscription_status: 'active' }] });
    });
    await page.goto(`/app/reports/${reportId}`);
    await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();

    const header = page.locator('[data-report-header-actions]');
    const more = header.getByRole('button', { name: 'More', exact: true });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    // The actions are not on screen until More opens.
    await expect(page.getByRole('button', { name: /^Regenerate \(/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete report' })).toHaveCount(0);

    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const list = header.getByRole('list', { name: 'More report actions' });
    await expect(list.getByRole('button')).toHaveText([/^Regenerate \(\d left\)$/, 'Delete report']);
    await expect(list.getByRole('button').first()).toBeFocused();
    const box = await list.getByRole('button').first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    const axe = await new AxeBuilder({ page }).include('[data-report-header-actions]').analyze();
    expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();

    // Delete report keeps its confirmation: dismissing it leaves the report in place.
    const dialogs: string[] = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await more.click();
    await list.getByRole('button', { name: 'Delete report' }).click();
    await expect.poll(() => dialogs).toEqual(['Delete this report? This cannot be undone.']);
    await expect(page).toHaveURL(new RegExp(`/app/reports/${reportId}$`));
  });
});
