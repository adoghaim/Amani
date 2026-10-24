// PR #93 owner ruling: "browser smoke becomes a required automated check when
// the CI upgrade is online". A required check must run on every PR into main
// and on main itself, under a stable name. This pins those properties of
// .github/workflows/e2e.yml so a later edit cannot silently drop them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
const onBlock = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\npermissions:'));

describe('Browser smoke workflow', () => {
  it('runs on pull requests into main and on pushes to main', () => {
    expect(onBlock).toMatch(/\n {2}pull_request:\n {4}branches: \[main\]\n/);
    expect(onBlock).toMatch(/\n {2}push:\n {4}branches: \[main\]\n/);
  });

  it('has no path filter that could skip the required check', () => {
    expect(onBlock).not.toMatch(/paths(-ignore)?:/);
  });

  it('keeps the status-check name branch protection will require', () => {
    expect(workflow).toMatch(/\n {4}name: Browser smoke\n/);
  });

  it('never cancels a run on main, only superseded pull-request runs', () => {
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it('runs the isolation canary and the synthetic smoke suite, with a bounded timeout', () => {
    // One job per browser runs both suites for its browser (F118); every
    // browser is covered (scripts/ci/workflow-hardening.test.ts).
    expect(workflow).toContain('run: npm run test:e2e:isolation');
    expect(workflow).toContain('run: npm run test:e2e -- --project="$BROWSER_PROJECT"\n');
    expect(workflow).toContain('run: npx --no-install playwright test --config e2e/freemium/playwright.config.ts --project="$BROWSER_PROJECT"\n');
    expect(workflow).toMatch(/timeout-minutes: 30\n/);
    expect(workflow).not.toMatch(/secrets\./);
  });
});
