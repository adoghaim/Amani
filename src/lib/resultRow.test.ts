import { describe, expect, it } from 'vitest';
import { applicableRangeIndex, labelPhase, printedLabFlag, printedRanges, rangePhaseOf } from './resultRow';
import { bindReferenceRange } from '../utils/parser/rangeDetection';

// Placeholder intervals from the synthetic PK-FIX-05 fixtures. Not clinical ranges.
const FSH = 'Follicular Phase 2.1-11.1; Mid-Cycle Peak 5.2-22.2; Luteal Phase 1.3-8.8; Postmenopausal 22.2-133.3';
const E2 = 'Follicular Phase 21-121; Mid-Cycle Phase 61-361; Luteal Phase 51-251; Postmenopausal <=31';

describe('printedRanges: every range as the lab printed it, never rewritten', () => {
  it('a single bound range is one unlabelled line, unchanged', () => {
    expect(printedRanges('0.40-4.50')).toEqual([{ label: null, interval: '0.40-4.50' }]);
  });

  it('splits the persisted multi-range text back into its printed lines, label and interval verbatim', () => {
    expect(printedRanges(FSH)).toEqual([
      { label: 'Follicular Phase', interval: '2.1-11.1' },
      { label: 'Mid-Cycle Peak', interval: '5.2-22.2' },
      { label: 'Luteal Phase', interval: '1.3-8.8' },
      { label: 'Postmenopausal', interval: '22.2-133.3' },
    ]);
    expect(printedRanges(E2)[3]).toEqual({ label: 'Postmenopausal', interval: '<=31' });
    expect(printedRanges('Follicular phase 2.5 – 10.5')).toEqual([{ label: 'Follicular phase', interval: '2.5 – 10.5' }]);
  });

  it('two labelled ranges printed on one line split into two ranges, never one merged row', () => {
    const split = printedRanges('Follicular Phase 2.1-11.1 Luteal Phase 1.3-8.8; Postmenopausal 22.2-133.3');
    expect(split).toEqual([
      { label: 'Follicular Phase', interval: '2.1-11.1' },
      { label: 'Luteal Phase', interval: '1.3-8.8' },
      { label: 'Postmenopausal', interval: '22.2-133.3' },
    ]);
    expect(applicableRangeIndex(split, 'follicular')).toBe(0);
    expect(applicableRangeIndex(split, 'luteal')).toBe(1);
    // Units and comparators printed with an interval stay with it, verbatim.
    expect(printedRanges('Follicular 21-121 pg/mL Postmenopausal <=31 pg/mL')).toEqual([
      { label: 'Follicular', interval: '21-121 pg/mL' },
      { label: 'Postmenopausal', interval: '<=31 pg/mL' },
    ]);
  });

  it('round trip through the real binder: the saved text splits like the parser\'s own candidates', () => {
    for (const lines of [
      ['FSH 6.1 mIU/mL', 'Follicular Phase 2.1-11.1 Luteal Phase 1.3-8.8', 'Postmenopausal 22.2-133.3'],
      ['FSH 6.1 mIU/mL Follicular 2.1-11.1 Luteal 1.3-8.8'],
    ]) {
      const binding = bindReferenceRange(lines);
      const saved = binding.ambiguous?.printed ?? '';
      expect(saved).not.toBe('');
      const fromSaved = printedRanges(saved);
      expect(fromSaved.map(r => r.label)).toEqual(binding.candidates.map(c => c.label));
      expect(fromSaved.map(r => r.interval)).toEqual(binding.candidates.map(c => c.raw));
      expect(applicableRangeIndex(fromSaved, 'follicular')).toBe(0);
      expect(applicableRangeIndex(fromSaved, 'luteal')).toBe(1);
    }
  });

  it('an ordinal belongs to the label, not the interval', () => {
    expect(printedRanges('1st Trimester 3.3-33.3; 2nd Trimester 4.4-44.4')).toEqual([
      { label: '1st Trimester', interval: '3.3-33.3' },
      { label: '2nd Trimester', interval: '4.4-44.4' },
    ]);
  });

  it('prefers the parser\'s in-memory candidates and keeps their raw text', () => {
    const candidates = [
      { label: 'Follicular Phase', raw: '2.1-11.1', min: 2.1, max: 11.1 },
      { label: 'Luteal Phase', raw: '1.3-8.8', min: 1.3, max: 8.8 },
    ];
    expect(printedRanges('ignored', candidates)).toEqual([
      { label: 'Follicular Phase', interval: '2.1-11.1' },
      { label: 'Luteal Phase', interval: '1.3-8.8' },
    ]);
  });

  it('no printed range gives none (Amani never supplies one)', () => {
    expect(printedRanges(null)).toEqual([]);
    expect(printedRanges('  ')).toEqual([]);
  });
});

describe('applicableRangeIndex: only the lab\'s own label decides, and only with cycle context', () => {
  const ranges = printedRanges(FSH);

  it('marks the one range whose label names the draw-day phase', () => {
    expect(applicableRangeIndex(ranges, 'follicular')).toBe(0);
    expect(applicableRangeIndex(ranges, 'luteal')).toBe(2);
  });

  it('marks none with no cycle context', () => {
    for (const phase of [null, undefined, 'unknown', 'pregnancy_t1', '']) {
      expect(applicableRangeIndex(ranges, phase)).toBeNull();
    }
  });

  it('marks none when no label names the phase (no inferred equivalence such as mid-cycle)', () => {
    expect(applicableRangeIndex(ranges, 'ovulatory')).toBeNull();
    expect(applicableRangeIndex(ranges, 'menstrual')).toBeNull();
  });

  it('marks none when two labels name the phase', () => {
    const split = printedRanges('Early Follicular 1-2; Late Follicular 3-4; Luteal 5-6');
    expect(applicableRangeIndex(split, 'follicular')).toBeNull();
    expect(applicableRangeIndex(split, 'luteal')).toBe(2);
  });

  it('marks none on a single printed range, even a labelled one', () => {
    expect(applicableRangeIndex(printedRanges('Luteal Phase 1.3-8.8'), 'luteal')).toBeNull();
  });

  it('a label naming two phases names none', () => {
    expect(labelPhase('Follicular/Luteal')).toBeNull();
    expect(labelPhase('Ovulation')).toBe('ovulatory');
    expect(rangePhaseOf('luteal')).toBe('luteal');
    expect(rangePhaseOf('unknown')).toBeNull();
  });
});

describe('printedLabFlag: the lab\'s own flag exactly as printed', () => {
  it('reads the token printed right after the value', () => {
    expect(printedLabFlag('TSH                               4.85 (H)    mIU/L       0.40-4.50', '4.85', 'mIU/L')).toBe('(H)');
    expect(printedLabFlag('Ferritin 9 L ng/mL 15-150', '9', 'ng/mL')).toBe('L');
    expect(printedLabFlag('Glucose 140 High mg/dL 70-99', '140', 'mg/dL')).toBe('High');
  });

  it('never takes the unit, a lowercase letter, or a missing value for a flag', () => {
    expect(printedLabFlag('Glucose 94 mg/dL 70-99', '94', 'mg/dL')).toBeNull();
    expect(printedLabFlag('Volume 5 L 1-10', '5', 'L')).toBeNull();
    expect(printedLabFlag('Thing 5 l 1-10', '5', null)).toBeNull();
    expect(printedLabFlag(null, '5', null)).toBeNull();
    expect(printedLabFlag('TSH 4.85 (H)', null, null)).toBeNull();
    expect(printedLabFlag('TSH 4.85 (H)', '9.99', null)).toBeNull();
  });
});
