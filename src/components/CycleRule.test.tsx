// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CycleRule } from './CycleRule';
import { axeViolations } from './axe.testkit';
import { CYCLE_RULE_EMPTY_WHY, cycleRuleModel, dayCentrePercent, PHASE_PATTERN } from '../lib/cycleRuleModel';
import { DAY_MAP_BANDS, dayMapPhase, PHASE_ESTIMATE_LABEL } from '../lib/cycleDayRule';

/*
  PK-FIX-06-EXT: the report's cycle rule (DESIGN.md "Cycle rule", owner
  decision D10). Synthetic report facts only.
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

type Facts = { estimated_cycle_day?: unknown; estimated_cycle_phase?: unknown; average_cycle_length?: unknown };
async function render(report: Facts) {
  await act(async () => root.render(<main><CycleRule report={report} /></main>));
  return app.querySelector('section[data-cycle-rule]')!;
}
const tick = () => app.querySelector('line[data-tick-day]');
const ruleSvg = () => app.querySelector('svg[role="img"]')!;

describe('the day map as bands', () => {
  it('DAY_MAP_BANDS and the day map agree on every day 1-40', () => {
    for (let day = 1; day <= 40; day++) {
      const band = DAY_MAP_BANDS.find(b => day >= b.fromDay && day <= b.toDay);
      expect(band?.phase ?? 'unknown', `day ${day}`).toBe(dayMapPhase(day));
    }
  });
});

describe('CycleRule: one tick on the draw day', () => {
  it.each([1, 5, 14, 21, 28])('day %i of an estimated phase: one tick at the centre of that day on a 28-day rule', async (day) => {
    await render({ estimated_cycle_day: day, estimated_cycle_phase: dayMapPhase(day), average_cycle_length: null });
    expect(app.querySelectorAll('line[data-tick-day]')).toHaveLength(1);
    expect(tick()!.getAttribute('data-tick-day')).toBe(String(day));
    const expected = ((day - 0.5) / 28) * 100;
    expect(Number(tick()!.getAttribute('data-tick-percent'))).toBeCloseTo(expected, 3);
    expect(tick()!.getAttribute('x1')).toBe(`${expected}%`);
    expect(tick()!.getAttribute('x2')).toBe(`${expected}%`);
    expect(app.textContent).toContain(`Blood drawn on cycle day ${day}`);
  });

  it('no wrap: day 37 is drawn on day 37 of a 37-day rule, with no phase', async () => {
    await render({ estimated_cycle_day: 37, estimated_cycle_phase: 'unknown', average_cycle_length: 28 });
    expect(tick()!.getAttribute('data-tick-day')).toBe('37');
    expect(Number(tick()!.getAttribute('data-tick-percent'))).toBeCloseTo(dayCentrePercent(37, 37), 3);
    expect(app.textContent).toContain('Day 37');
    expect(app.querySelectorAll('[data-band], [data-band-tint]')).toHaveLength(0);
    expect(app.querySelector('[data-cycle-rule-note]')?.textContent).toBe('Phase not estimated after cycle day 35.');
    expect(app.textContent).not.toContain(PHASE_ESTIMATE_LABEL);
  });

  it('a known length other than 28: the tick on a rule of her length, no bands, the neutral note', async () => {
    await render({ estimated_cycle_day: 21, estimated_cycle_phase: 'unknown', average_cycle_length: 35 });
    expect(Number(tick()!.getAttribute('data-tick-percent'))).toBeCloseTo(((21 - 0.5) / 35) * 100, 3);
    expect(app.textContent).toContain('Day 35');
    expect(app.querySelectorAll('[data-band], [data-band-tint], pattern')).toHaveLength(0);
    expect(app.querySelector('[data-cycle-rule-note]')?.textContent).toBe('Phase not estimated for a 35-day cycle.');
    expect(app.textContent).not.toMatch(/luteal|follicular|ovulat|menstrual/i);
  });

  it('a stored phase the day map does not give for that day (a lab-printed phase) is not drawn as bands', async () => {
    await render({ estimated_cycle_day: 3, estimated_cycle_phase: 'luteal', average_cycle_length: null });
    expect(tick()!.getAttribute('data-tick-day')).toBe('3');
    expect(app.querySelectorAll('[data-band]')).toHaveLength(0);
    expect(app.textContent).not.toContain(PHASE_ESTIMATE_LABEL);
  });
});

describe('CycleRule: phase bands carry their tints and their patterns', () => {
  it('every band has its shipped tint and its own pattern: period dense diagonal, follicular sparse diagonal, ovulation fine dots, luteal cross-hatching', async () => {
    await render({ estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', average_cycle_length: 28 });
    expect(PHASE_PATTERN).toEqual({
      menstrual: 'dense-diagonal', follicular: 'sparse-diagonal', ovulatory: 'fine-dots', luteal: 'cross-hatch',
    });
    const bands = Array.from(app.querySelectorAll('svg[role="img"] [data-band]'));
    expect(bands.map(b => b.getAttribute('data-band'))).toEqual(['menstrual', 'follicular', 'ovulatory', 'luteal']);
    for (const band of bands) {
      const phase = band.getAttribute('data-band') as keyof typeof PHASE_PATTERN;
      // The shipped tint sits behind the band, over the same days.
      const tint = app.querySelector<HTMLElement>(`[data-band-tint="${phase}"]`)!;
      expect(tint.className, phase).toContain(`bg-theme-phase-${phase}-bg`);
      expect(tint.style.left, phase).toBe(band.getAttribute('x'));
      expect(tint.style.width, phase).toBe(band.getAttribute('width'));
      // The band is filled with a pattern that exists, of this phase's kind, in this phase's ink.
      const ref = band.getAttribute('fill')!.match(/^url\(#(.+)\)$/)![1]!;
      const pattern = app.querySelector(`pattern[id="${ref}"]`);
      expect(pattern, phase).not.toBeNull();
      expect(pattern!.getAttribute('data-pattern'), phase).toBe(PHASE_PATTERN[phase]);
      expect(pattern!.querySelector('[class]')!.getAttribute('class'), phase).toMatch(new RegExp(`theme-phase-${phase}$`));
    }
    // Bands follow the day map: menstrual 1-5, follicular 6-12, ovulatory 13-16, luteal 17 to the end of the rule.
    expect(cycleRuleModel({ estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', average_cycle_length: 28 }))
      .toMatchObject({ spanDays: 28, bands: [
        { phase: 'menstrual', fromDay: 1, toDay: 5 }, { phase: 'follicular', fromDay: 6, toDay: 12 },
        { phase: 'ovulatory', fromDay: 13, toDay: 16 }, { phase: 'luteal', fromDay: 17, toDay: 28 },
      ] });
    // The visible key repeats each band's tint and pattern.
    expect(app.querySelectorAll('ul[aria-label="Cycle rule key"] li')).toHaveLength(4);
  });

  it('the rule with bands carries "estimate for a 28-day cycle"', async () => {
    await render({ estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', average_cycle_length: null });
    expect(app.querySelector('[data-cycle-rule-estimate]')?.textContent).toBe(' · Luteal phase, estimate for a 28-day cycle');
  });
});

describe('CycleRule: no period logged', () => {
  it.each([
    ['no cycle day', { estimated_cycle_day: null, estimated_cycle_phase: 'unknown', average_cycle_length: 35 }],
    ['no facts at all', {}],
    ['a day of zero (period start after the draw)', { estimated_cycle_day: 0, estimated_cycle_phase: 'unknown' }],
    ['a stored phase but no day', { estimated_cycle_day: null, estimated_cycle_phase: 'luteal' }],
  ])('%s: an empty rule with one line saying why, never a guessed tick or a phase', async (_name, facts) => {
    const section = await render(facts);
    expect(section.getAttribute('data-cycle-rule')).toBe('empty');
    expect(tick()).toBeNull();
    expect(app.querySelectorAll('[data-band], [data-band-tint], pattern')).toHaveLength(0);
    expect(app.querySelectorAll('p')).toHaveLength(1);
    expect(app.querySelector('[data-cycle-rule-why]')?.textContent).toBe(CYCLE_RULE_EMPTY_WHY);
    expect(app.textContent).not.toMatch(/luteal|follicular|ovulat|menstrual|estimate/i);
  });
});

describe('CycleRule: accessible', () => {
  it('the rule has an accessible label that says the draw day, and the phase only as an estimate', async () => {
    await render({ estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', average_cycle_length: null });
    expect(ruleSvg().getAttribute('aria-label'))
      .toBe('Cycle rule. Blood drawn on cycle day 21, luteal phase, estimate for a 28-day cycle.');
    const section = app.querySelector('section')!;
    expect(document.getElementById(section.getAttribute('aria-labelledby')!)?.textContent).toBe('Your cycle on the draw day');
  });

  it('empty and no-phase rules are labelled too', async () => {
    await render({ estimated_cycle_day: null });
    expect(ruleSvg().getAttribute('aria-label')).toBe(`Cycle rule, empty. ${CYCLE_RULE_EMPTY_WHY}`);
    await render({ estimated_cycle_day: 36, estimated_cycle_phase: 'unknown', average_cycle_length: null });
    expect(ruleSvg().getAttribute('aria-label'))
      .toBe('Cycle rule. Blood drawn on cycle day 36. Phase not estimated after cycle day 35.');
  });

  it.each([
    ['with bands', { estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', average_cycle_length: 28 }],
    ['no phase', { estimated_cycle_day: 21, estimated_cycle_phase: 'unknown', average_cycle_length: 35 }],
    ['empty', { estimated_cycle_day: null }],
  ])('axe finds no violations: %s', async (_name, facts) => {
    await render(facts);
    expect(await axeViolations(app)).toEqual([]);
  });
});
