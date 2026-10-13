import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cycleContextCard } from './cycleContextCard';
import { cycleRuleModel } from './cycleRuleModel';
import { reportCycleLine } from './reportCycleLine';
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
    /*
      A day-map phase on an unknown or 28-day length shows as before.
      Changed by PK-FIX-06-EXT (D10 review blocker): this loop also covered a
      known 35-day length and expected { phase: 'luteal', ... } with no note.
      The card now follows the cycle rule, so that case is in the D10 test
      below: no estimated phase, the stored phase shown as recorded, and the
      35-day note.
    */
    for (const average_cycle_length of [28, null]) {
      const card = cycleContextCard({ estimated_cycle_phase: 'luteal', estimated_cycle_day: 21, average_cycle_length }, basicAi);
      expect(card).toEqual({ phase: 'luteal', day: 21, confidence: null, explanation: null });
      expect(card).not.toHaveProperty('phaseNote');
      expect(card).not.toHaveProperty('recordedPhase');
    }
  });
  /*
    PK-FIX-06-EXT review blocker (D10, D13): the card's estimated phase is the
    cycle rule's phase, so it agrees with the header line and the rule. A stored
    phase the rule does not draw never carries the 28-day estimate label; it is
    shown apart, as recorded with the report (pending Q13).
  */
  it('D10: the card phase is the rule phase; a stored phase the rule does not draw is shown apart, as recorded', () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      // A lab-printed phase the day map would not give for day 10.
      [{ estimated_cycle_phase: 'luteal', estimated_cycle_day: 10, average_cycle_length: null },
        { phase: null, recordedPhase: 'luteal', day: 10, confidence: null, explanation: null }],
      // A pregnancy value.
      [{ estimated_cycle_phase: 'pregnancy_t1', estimated_cycle_day: 10 },
        { phase: null, recordedPhase: 'pregnancy_t1', day: 10, confidence: null, explanation: null }],
      // A phase on a known 35-day cycle, where D13 estimates none: the note says why.
      [{ estimated_cycle_phase: 'luteal', estimated_cycle_day: 20, average_cycle_length: 35 },
        { phase: null, recordedPhase: 'luteal', day: 20, confidence: null, explanation: null,
          phaseNote: 'Phase not estimated for a 35-day cycle.' }],
      // A phase stored on day 37: no estimate past day 35, and no wrap.
      [{ estimated_cycle_phase: 'menstrual', estimated_cycle_day: 37, average_cycle_length: null },
        { phase: null, recordedPhase: 'menstrual', day: 37, confidence: null, explanation: null,
          phaseNote: 'Phase not estimated after cycle day 35.' }],
    ];
    for (const [report, expected] of cases) {
      const card = cycleContextCard(report, basicAi);
      expect(card, JSON.stringify(report)).toEqual(expected);
      expect(card?.phase ?? null).toBe(reportCycleLine(report)?.phase ?? null);
      const rule = cycleRuleModel(report);
      expect(card?.phase ?? null).toBe(rule.state === 'placed' ? rule.phase : null);
    }
  });
  it('D10: the card phase equals the rule phase on every day 1-40 x stored phase x length', () => {
    for (let day = 1; day <= 40; day += 1) {
      for (const stored of ['menstrual', 'follicular', 'ovulatory', 'luteal', 'pregnancy_t2', 'unknown', null]) {
        for (const average_cycle_length of [null, 28, 35, 24]) {
          const report = { estimated_cycle_phase: stored, estimated_cycle_day: day, average_cycle_length };
          const card = cycleContextCard(report, basicAi);
          const line = reportCycleLine(report);
          const label = JSON.stringify(report);
          expect(card?.phase ?? null, label).toBe(line?.phase ?? null);
          // A shown phase is always the stored one: the card never invents a phase.
          if (card?.phase) expect(card.phase, label).toBe(stored);
          if (card?.recordedPhase) {
            expect(card.recordedPhase, label).toBe(stored);
            expect(card.phase, label).toBeNull();
          }
        }
      }
    }
  });
  it('ReportView renders only through this helper, with the report claims', () => {
    const source = readFileSync(new URL('../pages/ReportView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('cycleContextCard(report, interpretation?.cycle_context, reportClaims)');
    expect(source).not.toMatch(/aiCycle|cycle_context\?\.estimated_cycle_(phase|day)/);
  });
});
