// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayCard } from './TodayCard';
import { CycleDial } from './CycleDial';
import { axeViolations } from './axe.testkit';
import { computeCyclePrediction } from '../utils/cyclePredictor';
import { daysBefore, DRAW, trackerLogs, type TypicalLength } from '../lib/cycleR10Table';
import type { CyclePrediction, PeriodLog } from '../types';

/*
  PK-FIX-06-EXT (owner decision D10): the Today card and the cycle ring follow
  the report's cycle rule. The card is fed by the real predictor, driven by
  the R10 table's tracker logs, with today fixed. Synthetic dates.
*/

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] });
  const [y, m, d] = DRAW.split('-').map(Number) as [number, number, number];
  vi.setSystemTime(new Date(y, m - 1, d, 12, 0, 0));
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const asLogs = (rows: { start_date: string }[]): PeriodLog[] => rows.map(r => ({
  id: r.start_date, user_id: 'u', start_date: r.start_date, end_date: null, flow_intensity: null, notes: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}));

async function renderCard(length: TypicalLength | null, day = 1) {
  const logs = length === null ? [] : asLogs(trackerLogs(length, daysBefore(DRAW, day - 1)));
  const prediction: CyclePrediction | null = computeCyclePrediction(logs, null);
  await act(async () => root.render(
    <main>
      <TodayCard
        prediction={prediction}
        lastReport={null}
        activeInterventions={[]}
        lastPeriodLog={logs[logs.length - 1] ?? null}
        periodLogs={logs}
        onLogPeriod={() => {}}
        onAddSymptom={() => {}}
        onUploadLabs={() => {}}
      />
    </main>,
  ));
}
const heading = () => app.querySelector('[data-today-cycle-day]')?.textContent;
const phaseLine = () => app.querySelector('[data-today-phase]')?.textContent ?? null;
const ring = () => app.querySelector('svg[role="img"]')!;

describe('Today card: the report\'s cycle rule (D10)', () => {
  it('day 21, unknown length: the cycle day first, then the phase labelled as an estimate', async () => {
    await renderCard('unknown', 21);
    expect(heading()).toBe('Day 21');
    expect(phaseLine()).toBe('Luteal phase, estimate for a 28-day cycle');
    // The cycle day comes before the phase in reading order.
    const text = app.textContent!;
    expect(text.indexOf('Day 21')).toBeLessThan(text.indexOf('Luteal phase'));
    expect(ring().getAttribute('aria-label')).toBe('Cycle day 21, luteal phase, estimate for a 28-day cycle');
    expect(ring().querySelector('[data-arc]')).not.toBeNull();
  });

  it('day 37 stays day 37: no phase, the neutral note, and the ring shows the day only', async () => {
    await renderCard(28, 37);
    expect(heading()).toBe('Day 37');
    expect(phaseLine()).toBeNull();
    expect(app.querySelector('[data-today-phase-note]')?.textContent).toBe('Phase not estimated after cycle day 35.');
    expect(app.textContent).not.toMatch(/luteal|follicular|ovulatory|menstrual|estimate for/i);
    expect(ring().getAttribute('aria-label')).toBe('Cycle day 37');
    expect(ring().querySelector('[data-arc]')).toBeNull();
    expect(ring().getAttribute('data-phase-estimated')).toBe('false');
    expect(ring().textContent).toBe('37DAY');
  });

  it('a known 35-day cycle: day 21, no phase, and her average (not 28) as "Avg cycle"', async () => {
    await renderCard(35, 21);
    expect(heading()).toBe('Day 21');
    expect(phaseLine()).toBeNull();
    expect(app.querySelector('[data-today-phase-note]')?.textContent).toBe('Phase not estimated for a 35-day cycle.');
    expect(ring().getAttribute('aria-label')).toBe('Cycle day 21');
    expect(app.textContent).toContain('35Avg cycle');
  });

  it('one logged period: "Avg cycle" is not known, never a silent 28', async () => {
    await renderCard('unknown', 10);
    expect(app.textContent).toContain('–Avg cycle');
    expect(app.textContent).not.toContain('28Avg cycle');
  });

  it('no period logged: no day, no phase, and the ring shows no guessed day', async () => {
    await renderCard(null);
    expect(heading()).toBe('Not placed yet');
    expect(phaseLine()).toBeNull();
    expect(app.textContent).toContain('Log a period to place your cycle.');
    expect(app.textContent).not.toMatch(/luteal|follicular|ovulatory|menstrual|estimate for/i);
    expect(ring().getAttribute('aria-label')).toBe('Cycle day unknown');
    expect(ring().querySelector('[data-arc]')).toBeNull();
  });

  it.each([
    ['phase', 'unknown' as const, 21],
    ['no phase', 28 as const, 37],
    ['no period', null, 1],
  ])('axe finds no violations: %s', async (_name, length, day) => {
    await renderCard(length, day);
    expect(await axeViolations(app)).toEqual([]);
  });
});

describe('CycleDial', () => {
  it('a pregnancy or unknown phase is never drawn as a cycle phase', async () => {
    await act(async () => root.render(<CycleDial day={12} phase="pregnancy_t1" />));
    expect(ring().getAttribute('aria-label')).toBe('Cycle day 12');
    expect(ring().querySelector('[data-arc]')).toBeNull();
  });
});
