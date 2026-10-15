// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportCycleLine } from './ReportCycleLine';
import { axeViolations } from './axe.testkit';
import { reportCycleLine, type ReportCycleFacts } from '../lib/reportCycleLine';
import { cycleRuleModel } from '../lib/cycleRuleModel';
import { dayMapPhase, PHASE_ESTIMATE_LABEL } from '../lib/cycleDayRule';

/*
  PK-FIX-06-EXT (owner decision D10): the one cycle line for a report, shared
  by the report header, the dashboard and the Reports list. Synthetic facts.
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

async function render(report: ReportCycleFacts, layout?: 'inline' | 'stacked') {
  await act(async () => root.render(<main><ReportCycleLine report={report} layout={layout} /></main>));
  return app.querySelector('[data-report-cycle-line]');
}

describe('reportCycleLine: the same rule as the report cycle rule', () => {
  it('agrees with cycleRuleModel on every day 1-40, for every stored phase and length', () => {
    const phases = ['menstrual', 'follicular', 'ovulatory', 'luteal', 'pregnancy_t1', 'unknown', null];
    for (const length of [null, 28, 35, 24]) {
      for (const stored of phases) {
        for (let day = 1; day <= 40; day++) {
          const facts = { estimated_cycle_day: day, estimated_cycle_phase: stored, average_cycle_length: length };
          const model = cycleRuleModel(facts);
          const line = reportCycleLine(facts);
          expect(model.state).toBe('placed');
          if (model.state !== 'placed') continue;
          expect(line, `day ${day}, ${stored}, ${length}`).toEqual({ day: model.tickDay, phase: model.phase });
        }
      }
    }
  });

  it('no cycle day (no period entered): no line, even with a stored phase', () => {
    expect(reportCycleLine({ estimated_cycle_day: null, estimated_cycle_phase: 'luteal', average_cycle_length: null })).toBeNull();
    expect(reportCycleLine({ estimated_cycle_day: 0, estimated_cycle_phase: 'menstrual' })).toBeNull();
    expect(reportCycleLine({})).toBeNull();
  });
});

describe('ReportCycleLine', () => {
  it('inline: the cycle day first, then the phase labelled as an estimate', async () => {
    const line = await render({ estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', average_cycle_length: null });
    expect(line?.textContent).toBe(`Cycle day 21 · luteal phase, ${PHASE_ESTIMATE_LABEL}`);
    const html = line!.innerHTML;
    expect(html.indexOf('Cycle day')).toBeLessThan(html.indexOf('luteal'));
  });

  it('stacked: the day on one line, the labelled phase under it', async () => {
    const line = await render({ estimated_cycle_day: 3, estimated_cycle_phase: 'menstrual', average_cycle_length: 28 }, 'stacked');
    expect(line?.textContent).toBe(`Cycle day 3menstrual phase, ${PHASE_ESTIMATE_LABEL}`);
    expect(line?.querySelector('[data-report-cycle-phase]')?.textContent).toBe(`menstrual phase, ${PHASE_ESTIMATE_LABEL}`);
  });

  it('no wrap: day 37 stays day 37, with no phase', async () => {
    const line = await render({ estimated_cycle_day: 37, estimated_cycle_phase: 'unknown', average_cycle_length: 28 });
    expect(line?.textContent).toBe('Cycle day 37');
  });

  it('a known length other than 28: the day, and no phase', async () => {
    const line = await render({ estimated_cycle_day: 14, estimated_cycle_phase: 'ovulatory', average_cycle_length: 35 });
    expect(line?.textContent).toBe('Cycle day 14');
  });

  it('a stored phase the day map does not give for that day is not shown', async () => {
    expect(dayMapPhase(10)).toBe('follicular');
    const line = await render({ estimated_cycle_day: 10, estimated_cycle_phase: 'luteal', average_cycle_length: null });
    expect(line?.textContent).toBe('Cycle day 10');
  });

  it('no cycle day: renders nothing', async () => {
    expect(await render({ estimated_cycle_day: null, estimated_cycle_phase: 'luteal' })).toBeNull();
    expect(app.textContent).toBe('');
  });

  it('is plain text: no badge, no status or phase tint', async () => {
    const line = await render({ estimated_cycle_day: 14, estimated_cycle_phase: 'ovulatory', average_cycle_length: null });
    expect(line!.outerHTML).not.toMatch(/flag-|bg-|rounded-full|phase-/);
  });

  it('axe: no violations', async () => {
    await render({ estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', average_cycle_length: null }, 'stacked');
    expect(await axeViolations(app)).toEqual([]);
  });
});
