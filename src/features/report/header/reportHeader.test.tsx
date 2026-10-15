// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FileText, Flag } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../components/axe.testkit';
import type { LabReport } from '../../../types';
import {
  arrangeReportHeader, DELETE_REPORT_ACTION_ID, REPORT_HEADER_ACTIONS, reportHeaderProblems,
  type ReportHeaderAction, type ReportHeaderContext,
} from './index';
import { ReportHeaderActions } from './ReportHeaderActions';

/*
  PK-INT-01 additions (D19, DT2): the report header slot. One primary action
  plus a labelled More menu, mounted from REPORT_HEADER_ACTIONS. The actions
  the header already had keep their behaviour and copy; only their place moves.
*/

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

const report = { id: 'report-1', regeneration_count: 1 } as unknown as LabReport;
function context(regeneration: Partial<ReportHeaderContext['regeneration']> = {}): ReportHeaderContext & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    report,
    navigate: vi.fn(),
    regeneration: {
      available: true, upgrade: false, remaining: 2, busy: false,
      run: () => { calls.push('regenerate'); },
      ...regeneration,
    },
    deleteReport: () => { calls.push('delete'); },
  };
}

async function render(ctx: ReportHeaderContext, actions?: readonly ReportHeaderAction[]) {
  await act(async () => root.render(<ReportHeaderActions context={ctx} actions={actions} />));
}
const trigger = () => app.querySelector<HTMLButtonElement>('[data-more-trigger]');
const moreItems = () => Array.from(app.querySelectorAll<HTMLButtonElement>('[data-more-item]'));
const primaryButton = () => Array.from(app.querySelectorAll<HTMLButtonElement>('button'))
  .find(b => !b.hasAttribute('data-more-trigger') && !b.hasAttribute('data-more-item')) ?? null;

const byId = (id: string) => REPORT_HEADER_ACTIONS.find(action => action.id === id)!;

describe('report header slot (D19)', () => {
  it('the header list holds the D19 rules: Delete report last, in More, never the primary', () => {
    expect(REPORT_HEADER_ACTIONS.map(a => a.id))
      .toEqual(['generate-full-analysis', 'regenerate', 'report-problem', DELETE_REPORT_ACTION_ID]);
    expect(reportHeaderProblems(REPORT_HEADER_ACTIONS)).toEqual([]);
  });

  it('the rule check fails on every way the header can break', () => {
    const [full, regenerate, remove] = ['generate-full-analysis', 'regenerate', DELETE_REPORT_ACTION_ID].map(byId) as [ReportHeaderAction, ReportHeaderAction, ReportHeaderAction];
    expect(reportHeaderProblems([full, remove, regenerate])).toEqual([`${DELETE_REPORT_ACTION_ID} must be last`]);
    expect(reportHeaderProblems([full, regenerate])).toEqual([`${DELETE_REPORT_ACTION_ID} is missing`]);
    expect(reportHeaderProblems([full, regenerate, { ...remove, primary: true }]))
      .toEqual([`${DELETE_REPORT_ACTION_ID} can never be the primary action`]);
    expect(reportHeaderProblems([full, regenerate, { ...remove, more: false }]))
      .toEqual([`${DELETE_REPORT_ACTION_ID} is neither a primary candidate nor in More`, `${DELETE_REPORT_ACTION_ID} belongs in More`]);
    expect(reportHeaderProblems([full, regenerate, regenerate, remove])).toEqual(['regenerate is listed twice']);
  });

  it('upgrade offered: "Generate full Amani analysis" is the one primary; More holds Delete report', async () => {
    const ctx = context({ upgrade: true });
    await render(ctx);
    expect(primaryButton()!.textContent).toBe('Generate full Amani analysis');
    expect(primaryButton()!.className).toContain('bg-theme-primary');
    expect(trigger()!.textContent).toBe('More');
    expect(moreItems().map(b => b.textContent)).toEqual(['Delete report']);
    await act(async () => primaryButton()!.click());
    expect(ctx.calls).toEqual(['regenerate']);
    expect(await axeViolations(app)).toEqual([]);
  });

  it('no upgrade: no primary; More holds "Regenerate (N left)" then Delete report, which run the page handlers', async () => {
    const ctx = context({ remaining: 2 });
    await render(ctx);
    expect(primaryButton()).toBeNull();
    expect(moreItems().map(b => b.textContent)).toEqual(['Regenerate (2 left)', 'Delete report']);
    expect(app.querySelector('ul')!.getAttribute('aria-label')).toBe('More report actions');
    await act(async () => trigger()!.click());
    await act(async () => moreItems()[0]!.click());
    await act(async () => trigger()!.click());
    await act(async () => moreItems()[1]!.click());
    expect(ctx.calls).toEqual(['regenerate', 'delete']);
    expect(await axeViolations(app)).toEqual([]);
  });

  it('a running regeneration disables its action and turns its icon', async () => {
    await render(context({ upgrade: true, busy: true }));
    expect(primaryButton()!.disabled).toBe(true);
    expect(primaryButton()!.querySelector('svg')!.getAttribute('class')).toContain('animate-spin');
    await render(context({ busy: true }));
    expect(moreItems()[0]!.disabled).toBe(true);
    expect(moreItems()[0]!.querySelector('svg')!.getAttribute('class')).toContain('animate-spin');
  });

  it('no regeneration on offer: More holds only Delete report', async () => {
    await render(context({ available: false }));
    expect(primaryButton()).toBeNull();
    expect(moreItems().map(b => b.textContent)).toEqual(['Delete report']);
  });

  it('a later packet registers at its D19 place: a primary candidate and a More entry before Delete report', async () => {
    const prepare: ReportHeaderAction = {
      id: 'prepare-visit', primary: true, more: true,
      resolve: () => ({ label: 'Placeholder prepare', icon: FileText, onSelect: () => {} }),
    };
    const problem: ReportHeaderAction = {
      id: 'report-problem', more: true,
      resolve: () => ({ label: 'Placeholder problem', icon: Flag, onSelect: () => {} }),
    };
    const [full, regenerate, remove] = ['generate-full-analysis', 'regenerate', DELETE_REPORT_ACTION_ID].map(byId) as [ReportHeaderAction, ReportHeaderAction, ReportHeaderAction];
    const actions = [full, prepare, regenerate, problem, remove];
    expect(reportHeaderProblems(actions)).toEqual([]);
    // The full analysis, when on offer, stays the primary; the later candidate goes first in More.
    const upgrade = arrangeReportHeader(actions, context({ upgrade: true }));
    expect(upgrade.primary!.id).toBe('generate-full-analysis');
    expect(upgrade.more.map(a => a.id)).toEqual(['prepare-visit', 'report-problem', DELETE_REPORT_ACTION_ID]);
    // Otherwise the later candidate is the primary, and is not repeated in More.
    const plain = arrangeReportHeader(actions, context());
    expect(plain.primary!.id).toBe('prepare-visit');
    expect(plain.more.map(a => a.id)).toEqual(['regenerate', 'report-problem', DELETE_REPORT_ACTION_ID]);
    await render(context(), actions);
    expect(primaryButton()!.textContent).toBe('Placeholder prepare');
    expect(moreItems().map(b => b.textContent)).toEqual(['Regenerate (2 left)', 'Placeholder problem', 'Delete report']);
    expect(await axeViolations(app)).toEqual([]);
  });

  it('PK-HARM-01: "Report a problem" is in More, before Delete report, only when ReportView supplies it', async () => {
    // Flag off: ReportView passes no reportProblem, so nothing is offered.
    await render(context({ remaining: 2 }));
    expect(moreItems().map(b => b.textContent)).toEqual(['Regenerate (2 left)', 'Delete report']);
    // Flag on: offered at its D19 place, never the primary, and it opens the flow.
    const base = context({ upgrade: true });
    const ctx: ReportHeaderContext = { ...base, reportProblem: () => { base.calls.push('report-problem'); } };
    await render(ctx);
    expect(primaryButton()!.textContent).toBe('Generate full Amani analysis');
    expect(moreItems().map(b => b.textContent)).toEqual(['Report a problem', 'Delete report']);
    await act(async () => trigger()!.click());
    await act(async () => moreItems()[0]!.click());
    expect(base.calls).toEqual(['report-problem']);
    expect(byId('report-problem').primary).toBeFalsy();
    expect(await axeViolations(app)).toEqual([]);
  });
});
