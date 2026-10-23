import { describe, expect, it } from 'vitest';
import { extractCycleContextFromText } from './cycleContext';
import { questHormoneFixture } from './__fixtures__/questHormones';
import { labcorpHormoneFixture } from './__fixtures__/labcorpHormones';

/*
  F010: a cycle day or phase comes only from her own labelled line on the
  report ("Cycle Day: 21", "Phase: Luteal"), outside any reference-range block.
  Before F010 the phase words on the lab's reference intervals and marker names
  such as CD4 set them. Synthetic text only.
*/
const NONE = { cycleDay: null, cyclePhase: null };
const read = (text: string) => extractCycleContextFromText(text);

describe('F010: reference intervals and marker names never give her cycle phase or day', () => {
  it('the Quest and LabCorp hormone panels print phase-labelled intervals only: no phase (was follicular)', () => {
    expect(read(questHormoneFixture)).toEqual(NONE);
    expect(read(labcorpHormoneFixture)).toEqual(NONE);
  });

  it('a phase label on an interval, or on its own line, is never her phase', () => {
    for (const text of [
      'Follicular Phase 2.1-11.1',
      'Follicular Phase              2.1–11.1',
      'Luteal Phase',
      'Ovulatory phase',
      'Progesterone 8.2 ng/mL Follicular phase 0.1 – 1.1',
      'ESTRADIOL 145 pg/mL\n  Luteal Phase 51-251',
      'Phase: Follicular 21-121',
    ]) expect(read(text), text).toEqual(NONE);
  });

  it('marker names and loose day words are never her cycle day (CD4 Count 812 was day 4)', () => {
    for (const text of [
      'CD4 Count 812 cells/uL',
      'CD 4 Count 812 cells/uL',
      'C.D. 14',
      'Specimen received Day 3 after collection',
      'Day 21 Progesterone 8.2 ng/mL',
      'Day 14',
      'Cycle Day: 21-23 recommended',
      'Cycle day 3 FSH 6.1 mIU/mL',
    ]) expect(read(text), text).toEqual(NONE);
  });
});

describe('F010: a labelled line inside a reference-range block is the lab\'s label, not her cycle', () => {
  it('under a reference heading, or directly above or below an interval', () => {
    for (const text of [
      'Reference Range:\nPhase: Follicular\n<=1.1',
      'PROGESTERONE 8.2 ng/mL\n    Reference Range:\n    Phase: Follicular\n    Phase: Luteal',
      'ESTRADIOL 145 pg/mL\nPhase: Follicular\n21-121\nPhase: Luteal\n51-251',
      'Ref. Interval\nCycle Day: 3\n2.5 - 10.2 mIU/mL',
      'FSH 6.1 mIU/mL\nCycle Phase: Luteal\nRange: 1.3-8.8',
      'Postmenopausal <=0.4\nPhase: Luteal',
    ]) expect(read(text), text).toEqual(NONE);
  });
});

describe('F010: her labelled patient line still gives the day and phase', () => {
  it('reads a cycle-day line and a phase line', () => {
    expect(read('Cycle Day: 21\nPhase: Luteal')).toEqual({ cycleDay: 21, cyclePhase: 'luteal' });
    expect(read('Patient: Synthetic\r\nCycle day 9\r\nCycle Phase: Follicular\r\n')).toEqual({ cycleDay: 9, cyclePhase: 'follicular' });
    expect(read('  Menstrual  Cycle  Day :  14  ')).toEqual({ cycleDay: 14, cyclePhase: null });
    expect(read('Cycle Day #28')).toEqual({ cycleDay: 28, cyclePhase: null });
  });

  it('normalises the phase word as before', () => {
    expect(read('Phase: Ovulation').cyclePhase).toBe('ovulatory');
    expect(read('Phase: ovulating').cyclePhase).toBe('ovulatory');
    expect(read('Phase: Ovulatory').cyclePhase).toBe('ovulatory');
    expect(read('Cycle phase: MENSTRUAL').cyclePhase).toBe('menstrual');
    expect(read('Menstrual Cycle Phase: Luteal Phase').cyclePhase).toBe('luteal');
  });

  it('reads her line in a report whose reference intervals are phase-labelled (was follicular)', () => {
    for (const [fixture, headerLine] of [
      [questHormoneFixture, 'Reporting Physician: Dr. Synthetic\n'],
      [labcorpHormoneFixture, 'Laboratory Director: Dr. Synthetic\n'],
    ] as const) {
      expect(fixture).toContain(headerLine);
      const report = fixture.replace(headerLine, `${headerLine}Cycle Day: 21\nPhase: Luteal\n`);
      expect(read(report), headerLine).toEqual({ cycleDay: 21, cyclePhase: 'luteal' });
    }
  });

  it('a printed date or phone number beside her line is not an interval', () => {
    expect(read('Collected: 2026-10-21\nCycle Day: 21\nPhone: 555-555-5555')).toEqual({ cycleDay: 21, cyclePhase: null });
  });

  it('a cycle day outside 1-45 is ignored, as before', () => {
    for (const text of ['Cycle Day: 0', 'Cycle Day: 46', 'Cycle Day: 99']) expect(read(text), text).toEqual(NONE);
    expect(read('Cycle Day: 1').cycleDay).toBe(1);
    expect(read('Cycle Day: 45').cycleDay).toBe(45);
  });

  it('no text, no cycle facts', () => {
    expect(read('')).toEqual(NONE);
    expect(read(undefined as unknown as string)).toEqual(NONE);
  });
});
