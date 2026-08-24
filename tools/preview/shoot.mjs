/**
 * Screenshots the signed-in app against synthetic data.
 *
 *   node tools/preview/shoot.mjs [baseUrl] [outDir]
 *
 * Requires a running dev server (npm run dev) and playwright available on
 * NODE_PATH. Exits non-zero if any screen reported a page error, a console
 * error, or a query the harness could not answer — so this is a check, not
 * just a picture-taker.
 */
import { chromium } from 'playwright';
import { installHarness } from './harness.mjs';
import { REPORT_IDS } from './fixtures.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5199';
const OUT = process.argv[3] ?? 'preview-shots';

const SCREENS = [
  { name: 'dashboard',  path: '/app',                              full: true },
  { name: 'reports',    path: '/app/reports',                      full: true },
  { name: 'report-view',path: `/app/reports/${REPORT_IDS.march}`,  full: true },
  { name: 'tracker',    path: '/app/tracker',                      full: true },
  { name: 'billing',    path: '/app/billing',                      full: false },
  { name: 'settings',   path: '/app/settings',                     full: true },
  { name: 'new-report', path: '/app/new',                          full: false },
];

const VIEWPORTS = [
  { tag: 'desktop', width: 1280, height: 900 },
  { tag: 'mobile',  width: 390,  height: 844 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;

for (const vp of VIEWPORTS) {
  for (const screen of SCREENS) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const problems = await installHarness(page);

    await page.goto(BASE + screen.path, { waitUntil: 'networkidle', timeout: 45000 })
      .catch(e => problems.push(`goto: ${e.message}`));
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(1400);

    const chars = await page.evaluate(() => (document.body.innerText || '').trim().length);
    const landed = new URL(page.url()).pathname;
    const file = `${OUT}/${screen.name}-${vp.tag}.png`;
    await page.screenshot({ path: file, fullPage: screen.full });

    // A redirect to /login means the fake session did not take — the shot would
    // be of the login page, which looks fine and proves nothing.
    if (landed.startsWith('/login')) problems.push('redirected to /login — session not accepted');
    if (chars < 200) problems.push(`only ${chars} chars rendered`);

    const bad = problems.length > 0;
    if (bad) failed++;
    console.log(
      `${bad ? 'FAIL' : 'ok  '}  ${screen.name.padEnd(12)} ${vp.tag.padEnd(8)} ` +
      `path=${landed.padEnd(40)} chars=${String(chars).padStart(5)}` +
      (bad ? `\n        ${problems.slice(0, 4).join('\n        ')}` : '')
    );
    await page.close();
  }
}

await browser.close();
console.log(failed ? `\n${failed} screen(s) reported problems` : '\nall screens clean');
process.exit(failed ? 1 : 0);
