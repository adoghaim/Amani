// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Biomarker, LabReport } from '../types';
// PK-EXP5 wired CompareView to the first-party events client, which needs the
// Supabase env at import; these tests are about colour, not the events.
vi.mock('../lib/firstPartyEventsClient', () => ({ firstPartyEvents: { track: vi.fn(async () => true) } }));
import { CompareView } from './CompareView';
import { LabsTimeline } from './LabsTimeline';

/*
  PK-FIX-02 (campaign fix b): the Tracker's "Compare labs" and "Labs timeline"
  coloured every increase amber (theme-warning) and every decrease green
  (theme-success), which reads as bad and good whatever the marker. Direction
  is not valence: both directions render in the same neutral ink, and the
  arrow and the sign carry the direction. Synthetic reports only.
*/
const report = (id: string, date: string) => ({ id, report_date: date, lab_name: 'Synthetic Lab' }) as LabReport;
const marker = (reportId: string, name: string, value: number, unit: string): Biomarker => ({
  id: `${reportId}-${name}`, lab_report_id: reportId, name, value, raw_value_text: String(value), unit,
  reference_min: null, reference_max: null, flagged: 'unknown',
});
const REPORTS = [report('r1', '2026-01-05'), report('r2', '2026-02-02')];
// Ferritin falls, TSH rises, vitamin D is unchanged.
const BY_REPORT: Record<string, Biomarker[]> = {
  r1: [marker('r1', 'Ferritin', 25, 'ng/mL'), marker('r1', 'TSH', 6, 'uIU/mL'), marker('r1', 'Vitamin D', 30, 'ng/mL')],
  r2: [marker('r2', 'Ferritin', 20, 'ng/mL'), marker('r2', 'TSH', 9, 'uIU/mL'), marker('r2', 'Vitamin D', 30, 'ng/mL')],
};
// Status palettes: a colour that says good, bad or alert.
const VALENCE = /theme-(?:warning|success|danger)|flag-(?:ok|watch|low)/;

/** The coloured container of each direction's arrow. */
function directionInk(host: HTMLElement) {
  const ink = (icon: string) => Array.from(host.querySelectorAll(`svg.lucide-${icon}`)).map(svg => svg.parentElement!);
  return { up: ink('arrow-up'), down: ink('arrow-down'), none: ink('minus') };
}

function expectNeutral(host: HTMLElement) {
  const { up, down, none } = directionInk(host);
  expect(up.length).toBeGreaterThan(0);
  expect(down.length).toBeGreaterThan(0);
  expect(none.length).toBeGreaterThan(0);
  // One neutral ink for both directions; no change keeps its muted ink.
  for (const el of [...up, ...down]) {
    expect(el.className.split(/\s+/)).toContain('text-theme-text');
    expect(el.className).toBe(up[0]!.className);
  }
  for (const el of none) expect(el.className.split(/\s+/)).toContain('text-theme-muted-text');
  // Nothing in the component wears a status palette.
  expect(host.innerHTML).not.toMatch(VALENCE);
}

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

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Tracker labs views: direction in neutral ink, never amber up and green down (PK-FIX-02)', () => {
  it('Compare labs: an increase and a decrease render in the same neutral ink', async () => {
    await act(async () => root.render(<CompareView reports={REPORTS} biomarkersByReport={BY_REPORT} />));
    const [earlier, later] = Array.from(host.querySelectorAll('select'));
    await choose(earlier!, 'r1');
    await choose(later!, 'r2');
    const rows = Array.from(host.querySelectorAll('tbody tr')).map(tr => tr.textContent);
    expect(rows).toEqual([
      'Ferritin25 ng/mL20 ng/mL-5.00 (-20%)',
      'TSH6 uIU/mL9 uIU/mL+3.00 (50%)',
      'Vitamin D30 ng/mL30 ng/mLNo change',
    ]);
    expectNeutral(host);
  });

  it('Labs timeline: an increase and a decrease render in the same neutral ink', () => {
    host.innerHTML = renderToStaticMarkup(<LabsTimeline reports={REPORTS} biomarkersByReport={BY_REPORT} />);
    expect(host.textContent).toContain('+3.0 (50%)');
    expect(host.textContent).toContain('-5.0 (-20%)');
    expectNeutral(host);
  });

  it('negative control: the checks see the palette this packet removed', () => {
    host.innerHTML = '<div class="flex items-center gap-1 text-theme-warning"><svg class="lucide lucide-arrow-up"></svg></div>'
      + '<div class="flex items-center gap-1 text-theme-success"><svg class="lucide lucide-arrow-down"></svg></div>';
    expect(host.innerHTML).toMatch(VALENCE);
    const { up, down } = directionInk(host);
    expect(up[0]!.className).not.toBe(down[0]!.className);
  });
});

// Review F013: values in two units are not comparable, so no change is stated.
describe('Tracker labs views: no change across two units', () => {
  it('Labs timeline: vitamin D 30 ng/mL then 75 nmol/L has no delta and no highlight', () => {
    const byReport = { r1: [marker('r1', 'Vitamin D', 30, 'ng/mL')], r2: [marker('r2', 'Vitamin D', 75, 'nmol/L')] };
    host.innerHTML = renderToStaticMarkup(<LabsTimeline reports={REPORTS} biomarkersByReport={byReport} />);
    expect(host.textContent).toContain('75 nmol/L');
    expect(host.textContent).not.toMatch(/\+45|150%|What stood out/);
    expect(host.querySelector('svg.lucide-arrow-up')).toBeNull();
  });
});
