import { describe, expect, it } from 'vitest';
import {
  CORRECTION_INPUT_ERROR, confirmationQuestion, correctedFlag, needsConfirmation, parseCorrectionInput,
  type CorrectionTarget,
} from './correctionInput';
import { uploadFlag } from '../scoring/uploadFlag';
import { parseValueWithPrefix } from '../../utils/parser/valueExtraction';

/*
  PK-CORRECT-01, Q1 and R23: her input takes the upload's path (value parsing,
  unit normalization, the upload's scoring), and a value more than 10 times
  away from what Amani read asks once.
*/

const ferritin: CorrectionTarget = { rawName: 'Ferritin', canonicalSlug: 'ferritin', isCore: true };
const basophils: CorrectionTarget = { rawName: 'Basophils', canonicalSlug: null, isCore: false };

describe('Q1: her value is parsed like the upload', () => {
  it('a plain number', () => {
    expect(parseCorrectionInput('45', 'ng/mL', ferritin)).toEqual({ ok: true, value: 45, rawText: '45', unit: 'ng/mL' });
    expect(parseCorrectionInput(' 45.0 ', 'ng/mL', ferritin)).toEqual({ ok: true, value: 45, rawText: '45.0', unit: 'ng/mL' });
  });

  it('a decimal comma reads as a decimal point', () => {
    expect(parseCorrectionInput('5,2', 'ng/mL', ferritin)).toEqual({ ok: true, value: 5.2, rawText: '5.2', unit: 'ng/mL' });
  });

  it('keeps a "<" or ">" qualifier as raw text with the numeric part, exactly as the upload does', () => {
    const lt = parseCorrectionInput('<0,5', 'mg/L', basophils);
    const upload = parseValueWithPrefix('<0.5')!;
    expect(lt).toEqual({ ok: true, value: upload.value, rawText: upload.rawValue, unit: 'mg/L' });
    expect(lt.ok && lt.rawText).toBe('<0.5');
    const gt = parseCorrectionInput('> 90', 'mL/min/1.73m2', basophils);
    expect(gt).toEqual({ ok: true, value: 90, rawText: '>90', unit: 'mL/min/1.73m2' });
  });

  it('normalizes the unit the way the upload does', () => {
    expect(parseCorrectionInput('45', 'ng/ml', ferritin)).toMatchObject({ ok: true, unit: 'ng/mL' });
    expect(parseCorrectionInput('5', ' pmol/l ', basophils)).toMatchObject({ ok: true, unit: 'pmol/L' });
    expect(parseCorrectionInput('5', '', basophils)).toMatchObject({ ok: true, unit: null });
  });

  it('refuses anything that is not a number, with one inline message', () => {
    for (const text of ['', '   ', 'abc', '4.5.6', '1,500,000', 'about 5', '5 ng/mL', '--', '<', '1e3']) {
      expect(parseCorrectionInput(text, 'ng/mL', ferritin), JSON.stringify(text))
        .toEqual({ ok: false, field: 'value', error: CORRECTION_INPUT_ERROR });
    }
    expect(parseCorrectionInput('5', 'x'.repeat(33), ferritin)).toMatchObject({ ok: false, field: 'unit' });
  });
});

describe('the recomputed flag is the upload\'s', () => {
  it('scores a value with a biomarkers row with uploadFlag against the report\'s phase', () => {
    for (const value of [5, 45, 400]) {
      expect(correctedFlag(ferritin, value, 'follicular', true)).toBe(uploadFlag('ferritin', value, 'follicular'));
    }
  });

  it('has no flag without a biomarkers row, and "unknown" outside the range the upload scores', () => {
    expect(correctedFlag(basophils, 1, 'unknown', false)).toBeNull();
    expect(correctedFlag(ferritin, 45, 'unknown', false)).toBeNull();
    expect(correctedFlag(ferritin, 100001, 'unknown', true)).toBe('unknown');
  });
});

describe('R23: a value far from what Amani read asks once', () => {
  it('asks for a change of more than 10 times, up or down', () => {
    expect(needsConfirmation(15, 1500)).toBe(true);
    expect(needsConfirmation(1500, 15)).toBe(true);
    expect(needsConfirmation(15, 150.01)).toBe(true);
    expect(needsConfirmation(15, 1.49)).toBe(true);
  });

  it('does not ask for a change of 10 times or less', () => {
    expect(needsConfirmation(15, 150)).toBe(false);
    expect(needsConfirmation(15, 1.5)).toBe(false);
    expect(needsConfirmation(15, 15)).toBe(false);
    expect(needsConfirmation(15, 20)).toBe(false);
  });

  it('asks when one side is zero, and never without a reading to compare', () => {
    expect(needsConfirmation(0, 5)).toBe(true);
    expect(needsConfirmation(5, 0)).toBe(true);
    expect(needsConfirmation(0, 0)).toBe(false);
    expect(needsConfirmation(null, 5)).toBe(false);
  });

  it('asks in the approved words', () => {
    expect(confirmationQuestion('150 ng/mL'))
      .toBe("That's very different from what we read (150 ng/mL). Is that what your report says?");
  });
});
