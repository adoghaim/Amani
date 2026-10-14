import { test, expect, RUNTIME_CONFIG_SEED_REPLY } from '../fixtures';
import AxeBuilder from '@axe-core/playwright';
import { stage2CurrentReport, stage2PriorReport } from './synthetic-reports';

/*
  PK-HARM-01 (D19, D20, D23): "Report a problem" on the real ReportView, in a
  real browser, against the synthetic network. With features.interpretation_feedback
  on, More holds "Report a problem" before Delete report; "Something here
  worried me" shows where to get help first; Send writes exactly one row to
  interpretation_feedback (answered here, never a real backend); axe (colour
  contrast on) finds nothing on the chooser, the help step or the note.

  Flag off (the seed), More is unchanged: report-header.spec.ts pins
  ['Regenerate (N left)', 'Delete report'].

  Real-stack proof (RLS on a deployed table) is the migration harness
  (cases/180-interpretation-feedback.sh); an end-to-end run against a real
  Supabase stack is pending a test project.
*/

const reportId = stage2CurrentReport.report.id;
const interpretationId = stage2CurrentReport.interpretation.id as string;

test.describe('report a problem (D20), flag on', () => {
  test.use({
    authenticated: true,
    syntheticReports: [[stage2CurrentReport, stage2PriorReport], { scope: 'test' }],
    runtimeConfigReply: {
      status: 200,
      body: (RUNTIME_CONFIG_SEED_REPLY.body as { key: string; value: unknown }[])
        .map(row => (row.key === 'features' ? { key: 'features', value: { interpretation_feedback: true } } : row)),
    },
  });

  test('worried: help first, then a note, one row written; axe is clean on every step', async ({ page }) => {
    const posted: unknown[] = [];
    await page.route('https://amani-e2e.invalid/rest/v1/interpretation_feedback*', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, body: '' });
    });

    await page.goto(`/app/reports/${reportId}`);
    await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();

    const header = page.locator('[data-report-header-actions]');
    await header.getByRole('button', { name: 'More', exact: true }).click();
    const list = header.getByRole('list', { name: 'More report actions' });
    await expect(list.getByRole('button').last()).toHaveText('Delete report');
    expect((await list.getByRole('button').allTextContents()).slice(-2)).toEqual(['Report a problem', 'Delete report']);
    await list.getByRole('button', { name: 'Report a problem' }).click();

    const dialog = page.getByRole('dialog', { name: 'Report a problem' });
    await expect(dialog.getByRole('list', { name: 'What kind of problem?' }).getByRole('button')).toHaveText([
      'A value is wrong', 'The explanation is confusing or wrong', 'Something here worried me', 'Other',
    ]);
    for (const choice of await dialog.getByRole('list').getByRole('button').all()) {
      expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const axe = async () => {
      const result = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
    };
    await axe();

    await dialog.getByRole('button', { name: 'Something here worried me' }).click();
    const help = dialog.getByRole('heading', { name: 'Where to get help' });
    await expect(help).toBeFocused();
    await expect(dialog).toContainText('your clinician is the right person to ask');
    await expect(dialog).toContainText('If you feel unwell right now, call your local emergency number.');
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await axe();

    await dialog.getByRole('button', { name: 'Tell us what happened' }).click();
    const note = dialog.getByLabel('Tell us more (optional)');
    await expect(note).toHaveAttribute('maxlength', '1000');
    await note.fill('The headline frightened me.');
    await expect(dialog).toContainText("Please don't include your name");
    await axe();

    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Thank you' })).toBeFocused();
    expect(posted).toEqual([{
      report_id: reportId, interpretation_version_id: interpretationId, category: 'worried', text: 'The headline frightened me.',
    }]);

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('a failed send keeps her text and offers Try again', async ({ page }) => {
    let attempts = 0;
    await page.route('https://amani-e2e.invalid/rest/v1/interpretation_feedback*', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      attempts += 1;
      if (attempts === 1) await route.fulfill({ status: 503, json: { message: 'synthetic outage' } });
      else await route.fulfill({ status: 201, body: '' });
    });

    await page.goto(`/app/reports/${reportId}`);
    await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();
    const header = page.locator('[data-report-header-actions]');
    await header.getByRole('button', { name: 'More', exact: true }).click();
    await header.getByRole('button', { name: 'Report a problem' }).click();

    const dialog = page.getByRole('dialog', { name: 'Report a problem' });
    await dialog.getByRole('button', { name: 'A value is wrong' }).click();
    await dialog.getByLabel('Tell us more (optional)').fill('TSH says 2.0 on my paper report.');
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText("We couldn't send your report.");
    await expect(dialog.getByLabel('Tell us more (optional)')).toHaveValue('TSH says 2.0 on my paper report.');
    await dialog.getByRole('button', { name: 'Try again' }).click();
    await expect(dialog.getByRole('heading', { name: 'Thank you' })).toBeVisible();
    expect(attempts).toBe(2);
  });
});
