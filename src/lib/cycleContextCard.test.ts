import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cycleContextCard } from './cycleContextCard';
import { createMovementClaim } from './scoring/insightCopy';

const report = { estimated_cycle_phase: 'luteal', estimated_cycle_day: 21 };
// What the server's Basic sanitizer emits (basicCycleContext) for each source.
const basicAi = { estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', confidence: 'medium', explanation: '' };
const basicFallback = { ...basicAi, explanation: 'Labs drawn on cycle day 21 during the luteal phase.' };
// A model that ignored the contract and returned its own phase/day.
const modelOverride = { estimated_cycle_day: 3, estimated_cycle_phase: 'pregnancy_t2', confidence: 'high',
  explanation: 'Premium supplemental cycle context.' };
const tsh = () => createMovementClaim({ displayName: 'TSH', previousValue: 6, currentValue: 9, unit: 'uIU/mL', significance: 'significant' });

describe('cycle context card: deterministic phase/day; model prose only as an authorized claim (owner R1)', () => {
  it('Basic AI row: deterministic phase/day only — no explanation, no confidence badge', () => {
    expect(cycleContextCard(report, basicAi)).toEqual({ phase: 'luteal', day: 21, confidence: null, explanation: null });
  });
  it('Basic is suppressed unless a deterministic fact beyond phase exists', () => {
    expect(cycleContextCard({ estimated_cycle_phase: 'luteal', estimated_cycle_day: null }, basicAi)).toBeNull();
    expect(cycleContextCard({ estimated_cycle_phase: 'luteal', estimated_cycle_day: null },
      { estimated_cycle_day: null, estimated_cycle_phase: 'unknown', confidence: null, explanation: '' })).toBeNull();
    // Client default for a missing cycle_context never invents a card or confidence.
    expect(cycleContextCard({ estimated_cycle_phase: 'luteal', estimated_cycle_day: null },
      { estimated_cycle_day: null, estimated_cycle_phase: 'unknown', confidence: 'low', explanation: '' })).toBeNull();
  });
  /*
    Behaviour changed (V2-03b turn 13). The rule-based sentence and the Full
    model explanation used to render verbatim. Neither resolves to a claim, so
    neither renders, and with no explanation there is no confidence badge.
    Replaced by the stronger property: whatever the source and with or without
    claims, prose renders only as an issued claim's phrase.
  */
  it('stored prose that resolves to no claim never renders, whatever its source, and takes its confidence with it', () => {
    for (const context of [basicFallback, modelOverride]) {
      expect(cycleContextCard(report, context)).toEqual({ phase: 'luteal', day: 21, confidence: null, explanation: null });
      expect(cycleContextCard(report, context, [tsh()])).toEqual({ phase: 'luteal', day: 21, confidence: null, explanation: null });
      expect(cycleContextCard({ estimated_cycle_phase: 'luteal', estimated_cycle_day: null }, context, [tsh()])).toBeNull();
    }
  });
  it('an explanation that is an authorized phrase of a report claim renders as that claim, with its confidence', () => {
    const claim = tsh();
    const card = cycleContextCard({ estimated_cycle_phase: 'luteal', estimated_cycle_day: null },
      { ...modelOverride, explanation: 'Your TSH increased from your previous result.' }, [claim]);
    expect(card?.confidence).toBe('high');
    expect(card?.explanation?.field).toBe('interpretation.cycle_context.explanation');
    expect(card?.explanation?.language.text).toBe('Your TSH increased from your previous result.');
    expect(card?.explanation?.language.claim).toBe(claim);
    expect(card?.explanation?.language.authority).toEqual({ kind: 'lab_data', subject: 'TSH', previous: 6, current: 9, unit: 'uIU/mL' });
    // Strengthening, by rewording or by addition, does not resolve.
    for (const explanation of ['Your thyroid health has worsened.', 'Your TSH increased from your previous result, which is concerning.']) {
      expect(cycleContextCard(report, { ...modelOverride, explanation }, [claim])?.explanation).toBeNull();
    }
  });
  it('a model phase never creates a card when the report has none', () => {
    for (const phase of ['unknown', null, undefined]) {
      expect(cycleContextCard({ estimated_cycle_phase: phase, estimated_cycle_day: 21 }, modelOverride, [tsh()])).toBeNull();
    }
  });
  it('old string cycle_context rows show only report facts', () => {
    expect(cycleContextCard(report, 'Old model cycle narrative')).toEqual({ phase: 'luteal', day: 21, confidence: null, explanation: null });
  });
  it('PK-FIX-06 (D13): the cycle day shows without a phase after day 35, or for a known length other than 28', () => {
    const DAY_NOTE = 'Phase not estimated after cycle day 35.';
    const cases: [Record<string, unknown>, string][] = [
      // (a) Day 36+: a new report with an unknown or 28-day length, and a report saved since 2026-04-14 (they all stored 28).
      [{ estimated_cycle_day: 36, average_cycle_length: null }, DAY_NOTE],
      [{ estimated_cycle_day: 36, average_cycle_length: 28 }, DAY_NOTE],
      [{ estimated_cycle_day: 52, average_cycle_length: 28 }, DAY_NOTE],
      [{ estimated_cycle_day: 40 }, DAY_NOTE],
      // (b) Day 21 of a 35-day cycle (main labelled it luteal), and a 24-day cycle.
      [{ estimated_cycle_day: 21, average_cycle_length: 35 }, 'Phase not estimated for a 35-day cycle.'],
      [{ estimated_cycle_day: 10, average_cycle_length: 24 }, 'Phase not estimated for a 24-day cycle.'],
      [{ estimated_cycle_day: 40, average_cycle_length: 35 }, 'Phase not estimated for a 35-day cycle.'],
    ];
    for (const [facts, phaseNote] of cases) {
      for (const phase of ['unknown', null, undefined]) {
        expect(cycleContextCard({ estimated_cycle_phase: phase, ...facts }, basicAi), JSON.stringify(facts)).toEqual({
          phase: null, day: facts.estimated_cycle_day, confidence: null, explanation: null, phaseNote,
        });
      }
    }
  });
  it('PK-FIX-06: a card without a phase carries report facts only, never model prose or confidence', () => {
    const claim = tsh();
    const authorized = { ...modelOverride, explanation: 'Your TSH increased from your previous result.' };
    for (const context of [modelOverride, authorized, basicFallback, 'Old model cycle narrative']) {
      expect(cycleContextCard({ estimated_cycle_phase: 'unknown', estimated_cycle_day: 21, average_cycle_length: 35 }, context, [claim]))
        .toEqual({ phase: null, day: 21, confidence: null, explanation: null, phaseNote: 'Phase not estimated for a 35-day cycle.' });
    }
  });
  it('PK-FIX-06: no card without a day to show, and a card with a phase is unchanged with no note', () => {
    for (const day of [null, undefined, 0, -3, 2.5, Number.NaN]) {
      expect(cycleContextCard({ estimated_cycle_phase: 'unknown', estimated_cycle_day: day, average_cycle_length: 35 }, basicAi)).toBeNull();
    }
    // A lab-printed phase on a report with a known 35-day length still shows as before.
    for (const average_cycle_length of [28, 35, null]) {
      const card = cycleContextCard({ estimated_cycle_phase: 'luteal', estimated_cycle_day: 21, average_cycle_length }, basicAi);
      expect(card).toEqual({ phase: 'luteal', day: 21, confidence: null, explanation: null });
      expect(card).not.toHaveProperty('phaseNote');
    }
  });
  it('ReportView renders only through this helper, with the report claims', () => {
    const source = readFileSync(new URL('../pages/ReportView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('cycleContextCard(report, interpretation?.cycle_context, reportClaims)');
    expect(source).not.toMatch(/aiCycle|cycle_context\?\.estimated_cycle_(phase|day)/);
  });
});
