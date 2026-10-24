// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Biomarker, LabReport } from '../types';
// CompareView imports the first-party events client, which needs the Supabase env at import.
vi.mock('../lib/firstPartyEventsClient', () => ({ firstPartyEvents: { track: vi.fn(async () => true) } }));
import { CompareView } from './CompareView';
import { LabsTimeline } from './LabsTimeline';

/*
  Review F021 on the Tracker's "Compare labs" and "Labs timeline". A result
  printed '<8' is stored as value 4 with raw_value_text '<8'. Both views
  subtracted the 4: "vitamin_d_25_oh increased by +16.00 ng/mL (+400%)" and
  "4 ng/mL → 20 ng/mL". A censored result is a printed limit, so it has no
  delta or percent change, and a value shown for it is the printed text.
  Synthetic values only.
*/
const report = (id: string, date: string) => ({ id, report_date: date, lab_name: 'Synthetic Lab' }) as LabReport;
const marker = (reportId: string, name: string, value: number, text: string, unit = 'ng/mL'): Biomarker => ({
  id: `${reportId}-${name}`, lab_report_id: reportId, name, value, raw_value_text: text, unit,
  reference_min: null, reference_max: null, flagged: 'unknown',
});
const REPORTS = [report('r1', '2026-03-01'), report('r2', '2026-06-01')];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function compare(byReport: Record<string, Biomarker[]>) {
  await act(async () => root.render(<CompareView reports={REPORTS} biomarkersByReport={byReport} />));
  const [earlier, later] = Array.from(host.querySelectorAll('select'));
  for (const [select, value] of [[earlier!, 'r1'], [later!, 'r2']] as const) {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  return host.textContent ?? '';
}

// Prior '<8' (stored 4) and current 20; ferritin is measured on both.
const PRIOR_CENSORED: Record<string, Biomarker[]> = {
  r1: [marker('r1', 'vitamin_d_25_oh', 4, '<8'), marker('r1', 'ferritin', 20, '20')],
  r2: [marker('r2', 'vitamin_d_25_oh', 20, '20'), marker('r2', 'ferritin', 40, '40')],
};
// Prior 500 and current '>1000' (stored 1000).
const CURRENT_CENSORED: Record<string, Biomarker[]> = {
  r1: [marker('r1', 'ferritin', 500, '500')],
  r2: [marker('r2', 'ferritin', 1000, '>1000')],
};

describe('Compare labs never compares a censored result (F021)', () => {
  it('a censored prior: no delta, percent change or row through the placeholder', async () => {
    const text = await compare(PRIOR_CENSORED);
    expect(text).not.toMatch(/\+16\.00|400%|4 ng\/mL/);
    const rows = Array.from(host.querySelectorAll('tbody tr')).map(tr => tr.textContent);
    // The measured pair still compares.
    expect(rows).toEqual(['ferritin20 ng/mL40 ng/mL+20.00 (100%)']);
  });

  it('a censored current: no delta or percent change through the placeholder', async () => {
    const text = await compare(CURRENT_CENSORED);
    expect(text).not.toMatch(/\+500\.00|100%|1000 ng\/mL/);
    expect(host.querySelector('svg.lucide-arrow-up')).toBeNull();
  });

  it('measured values on both reports still compare (control)', async () => {
    const text = await compare({ r1: [marker('r1', 'ferritin', 500, '500')], r2: [marker('r2', 'ferritin', 1000, '1000')] });
    expect(text).toContain('+500.00 ng/mL (+100%)');
  });
});

describe('Labs timeline never compares or states a censored placeholder (F021)', () => {
  const timeline = (byReport: Record<string, Biomarker[]>) => {
    host.innerHTML = renderToStaticMarkup(<LabsTimeline reports={REPORTS} biomarkersByReport={byReport} />);
    return host.textContent ?? '';
  };

  // The timeline lists a fixed set of key markers by name ('vitamin_d', 'ferritin', ...).
  it('a censored prior: the current value shows with no delta through the 4', () => {
    const text = timeline({
      r1: [marker('r1', 'vitamin_d', 4, '<8')],
      r2: [marker('r2', 'vitamin_d', 20, '20')],
    });
    expect(text).toContain('20 ng/mL');
    expect(text).not.toMatch(/\+16\.0|400%|4 ng\/mL/);
  });

  it('a censored result is shown as printed, and the next report gets no delta from it', () => {
    const text = timeline({
      r1: [marker('r1', 'vitamin_d', 20, '20')],
      r2: [marker('r2', 'vitamin_d', 4, '<8')],
    });
    expect(text).toContain('<8 ng/mL');
    expect(text).not.toMatch(/-16\.0|-80%|\b4 ng\/mL|What stood out/);
    expect(host.querySelector('svg.lucide-arrow-down')).toBeNull();
  });

  it('measured values on both reports still show their delta (control)', () => {
    const text = timeline({ r1: [marker('r1', 'ferritin', 20, '20')], r2: [marker('r2', 'ferritin', 40, '40')] });
    expect(text).toContain('+20.0 (100%)');
  });
});
