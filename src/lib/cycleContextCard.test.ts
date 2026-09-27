import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cycleContextCard } from './cycleContextCard';

const report = { estimated_cycle_phase: 'luteal', estimated_cycle_day: 21 };
// What the server's Basic sanitizer emits (basicCycleContext) for each source.
const basicAi = { estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', confidence: 'medium', explanation: '' };
const basicFallback = { ...basicAi, explanation: 'Labs drawn on cycle day 21 during the luteal phase.' };
// A model that ignored the contract and returned its own phase/day.
const modelOverride = { estimated_cycle_day: 3, estimated_cycle_phase: 'pregnancy_t2', confidence: 'high',
  explanation: 'Premium supplemental cycle context.' };

describe('cycle context card: deterministic phase/day, model prose supplemental only', () => {
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
  it('Basic deterministic row keeps the rule-based sentence and its stored confidence', () => {
    expect(cycleContextCard(report, basicFallback)).toEqual({ phase: 'luteal', day: 21, confidence: 'medium',
      explanation: basicFallback.explanation });
  });
  it('Full: explanation shown, phase/day always from the report', () => {
    expect(cycleContextCard(report, modelOverride)).toEqual({ phase: 'luteal', day: 21, confidence: 'high',
      explanation: modelOverride.explanation });
    expect(cycleContextCard({ estimated_cycle_phase: 'luteal', estimated_cycle_day: null }, modelOverride))
      .toEqual({ phase: 'luteal', day: null, confidence: 'high', explanation: modelOverride.explanation });
  });
  it('a model phase never creates a card when the report has none', () => {
    for (const phase of ['unknown', null, undefined]) {
      expect(cycleContextCard({ estimated_cycle_phase: phase, estimated_cycle_day: 21 }, modelOverride)).toBeNull();
    }
  });
  it('old string cycle_context rows show only report facts', () => {
    expect(cycleContextCard(report, 'Old model cycle narrative')).toEqual({ phase: 'luteal', day: 21, confidence: null, explanation: null });
  });
  it('ReportView renders only through this helper', () => {
    const source = readFileSync(new URL('../pages/ReportView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('cycleContextCard(report, interpretation?.cycle_context)');
    expect(source).not.toMatch(/aiCycle|cycle_context\?\.estimated_cycle_(phase|day)/);
  });
});
