// @vitest-environment jsdom
import axe from 'axe-core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultRow, type ResultRowProps } from './ResultRow';

// Synthetic values only; the intervals are the PK-FIX-05 fixture placeholders,
// not clinical reference ranges.
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.documentElement.lang = 'en';
  host = document.createElement('main');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

type Analyte = ResultRowProps['analyte'];
const base: Analyte = {
  raw_name: 'tsh', display_name: 'TSH', raw_value_text: '1.9', value_numeric: 1.9, unit: 'mIU/L',
  raw_reference_range: '0.44-4.44', normalized_min: 0.44, normalized_max: 4.44,
  normalized_operator: null, normalized_operator_value: null,
  source_snippet: 'TSH                               1.9         mIU/L       0.44-4.44', parse_status: 'mapped',
};
const FSH: Analyte = {
  ...base, raw_name: 'fsh', display_name: 'FSH', raw_value_text: '6.1', value_numeric: 6.1, unit: 'mIU/mL',
  raw_reference_range: 'Follicular Phase 2.1-11.1; Mid-Cycle Peak 5.2-22.2; Luteal Phase 1.3-8.8; Postmenopausal 22.2-133.3',
  normalized_min: null, normalized_max: null,
  source_snippet: 'FSH                               6.1         mIU/mL Reference Range: Follicular Phase 2.1-11.1',
};

function render(analyte: Analyte, cyclePhase: string | null) {
  act(() => root.render(<ResultRow analyte={analyte} cyclePhase={cyclePhase} />));
  return host.querySelector('[data-testid="result-row"]') as HTMLElement;
}
const items = () => [...host.querySelectorAll('[data-testid="lab-intervals"] li')] as HTMLElement[];
const status = () => host.querySelector('[data-testid="result-status"]') as HTMLElement;
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

async function expectNoAxeViolations() {
  const result = await axe.run(host, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    // jsdom does not lay out or paint; contrast is gated by npm run validate:contrast.
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

describe('ResultRow (PK-DS-01, DESIGN.md "Result row")', () => {
  it('single range: the value in the data face, the printed range, then the status word with its icon', async () => {
    const row = render(base, 'luteal');
    const value = host.querySelector('[data-testid="result-value"]')!;
    expect(value.textContent).toBe('1.9');
    expect(value.className).toContain('font-mono');
    expect(items().map(li => li.textContent)).toEqual(['0.44-4.44 mIU/L']);
    expect(items()[0]!.dataset.applies).toBeUndefined();
    // Status: the owner-pinned placement words after the range, with an icon; never a leading badge.
    const words = status().querySelector('[data-language-source="patient_lab_interval"]')!;
    expect(words.textContent).toBe("Within your lab's range");
    expect(status().querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(follows(items()[0]!, status())).toBe(true);
    expect(row.textContent!.startsWith('TSH')).toBe(true);
    expect(row.innerHTML).not.toMatch(/rounded-full|flag-(?:ok|watch|low)/);
    expect(host.querySelector('[data-testid="lab-flag"]')).toBeNull();
    await expectNoAxeViolations();
  });

  it('multi-range with a highlight: every printed range shows, the draw-day one tinted with its pattern', async () => {
    render(FSH, 'luteal');
    expect(items().map(li => li.textContent)).toEqual([
      'Follicular Phase 2.1-11.1',
      'Mid-Cycle Peak 5.2-22.2',
      'Luteal Phase 1.3-8.8 · your estimated luteal phase on the draw day',
      'Postmenopausal 22.2-133.3',
    ]);
    const applied = items().filter(li => li.dataset.applies === 'true');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.dataset.phase).toBe('luteal');
    expect(applied[0]!.className).toContain('bg-theme-phase-luteal-bg');
    // The tint always carries its pattern: luteal is cross-hatched (two diagonals).
    expect(applied[0]!.style.backgroundImage.match(/repeating-linear-gradient/g)).toHaveLength(2);
    for (const li of items().filter(li => li.dataset.applies !== 'true')) {
      expect(li.className).not.toMatch(/phase-/);
      expect(li.getAttribute('style')).toBeNull();
    }
    // No range is bound, so no placement is stated against the one Amani marked.
    expect(status().textContent).toBe('Your lab printed several ranges');
    expect(status().querySelector('[data-language-source]')).toBeNull();
    expect(status().querySelector('svg')).toBeNull();
    expect(follows(items()[3]!, status())).toBe(true);
    await expectNoAxeViolations();
  });

  it('two labelled ranges printed on one line: each is its own row, and only the matching one is highlighted', async () => {
    // PK-FIX-05 saves one printed line per "; " segment; this line holds two intervals.
    const oneLine: Analyte = {
      ...FSH,
      raw_reference_range: 'Follicular Phase 2.1-11.1 Luteal Phase 1.3-8.8; Postmenopausal 22.2-133.3',
    };
    for (const [phase, index, text, other] of [
      ['follicular', 0, 'Follicular Phase 2.1-11.1 · your estimated follicular phase on the draw day', '1.3-8.8'],
      ['luteal', 1, 'Luteal Phase 1.3-8.8 · your estimated luteal phase on the draw day', '2.1-11.1'],
    ] as const) {
      render(oneLine, phase);
      expect(items()).toHaveLength(3);
      const applied = items().filter(li => li.dataset.applies === 'true');
      expect(applied).toHaveLength(1);
      expect(items().indexOf(applied[0]!)).toBe(index);
      expect(applied[0]!.textContent).toBe(text);
      expect(applied[0]!.dataset.phase).toBe(phase);
      // The highlighted row never carries another phase's interval.
      expect(applied[0]!.textContent).not.toContain(other);
      await expectNoAxeViolations();
    }
  });

  it('every phase tint carries its own pattern', () => {
    const labels = { menstrual: 'Menstrual', follicular: 'Follicular', ovulatory: 'Ovulation', luteal: 'Luteal' } as const;
    for (const [phase, label] of Object.entries(labels)) {
      render({ ...FSH, raw_reference_range: `${label} 1-2; Postmenopausal 3-4` }, phase);
      const applied = items().find(li => li.dataset.applies === 'true')!;
      expect(applied.className).toContain(`bg-theme-phase-${phase}-bg`);
      expect(applied.style.backgroundImage).toMatch(/gradient/);
    }
  });

  it('no cycle context: every printed range shows and none is highlighted', async () => {
    for (const phase of [null, 'unknown']) {
      render(FSH, phase);
      expect(items()).toHaveLength(4);
      expect(items().some(li => li.dataset.applies)).toBe(false);
      expect(host.innerHTML).not.toMatch(/phase-(?:menstrual|follicular|ovulatory|luteal)-bg|estimated/);
    }
    await expectNoAxeViolations();
  });

  it('lab flag: the lab\'s own H/L flag stays exactly as printed, beside the value', async () => {
    render({
      ...base, raw_value_text: '4.85', value_numeric: 4.85, raw_reference_range: '0.40-4.50', normalized_min: 0.4, normalized_max: 4.5,
      source_snippet: 'TSH                               4.85 (H)    mIU/L       0.40-4.50',
    }, null);
    const flag = host.querySelector('[data-testid="lab-flag"]') as HTMLElement;
    expect(flag.textContent).toBe('Flag printed by your lab: (H)');
    expect(flag.lastChild?.textContent).toBe('(H)');
    expect(flag.className).toContain('rounded-[3px]');
    expect(flag.className).toContain('border-theme-text');
    expect(follows(host.querySelector('[data-testid="result-value"]')!, flag)).toBe(true);
    expect(status().querySelector('[data-language-source]')!.textContent).toBe("Above your lab's range");
    expect(status().querySelector('svg')).not.toBeNull();
    await expectNoAxeViolations();
  });

  it('no printed range: says so, and shows no range of Amani\'s', () => {
    render({ ...base, raw_reference_range: null, normalized_min: null, normalized_max: null }, 'luteal');
    expect(host.querySelector('[data-testid="lab-intervals"]')).toBeNull();
    expect(status().textContent).toBe('No lab range');
  });
});
