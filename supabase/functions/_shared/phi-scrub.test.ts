import { describe, expect, it } from 'vitest';
import { errorType, MAX_SCRUBBED_LENGTH, REPORT_TEXT_REMOVED, scrubbedErrorMessage, scrubServerText } from './phi-scrub.ts';

/*
  PK-FIX-01b: what an edge function's error report may carry. The server
  scrubber is stricter than the web one: no lab value, no number, no quoted
  text, no identifier, and never more than MAX_SCRUBBED_LENGTH characters.
*/

const USER_ID = '3f9a1c2e-7b4d-4e8a-9f01-2c5d6e7a8b90';

describe('scrubServerText', () => {
  it('removes emails, UUIDs, JWTs, bearer tokens and key-shaped secrets', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEF-_123';
    const out = scrubServerText(
      `user jane.doe+lab@example.co.uk (${USER_ID}) token ${jwt} Bearer abc.def-ghi key sk-proj-abcdefgh12345678`,
    );
    expect(out).not.toContain('jane.doe');
    expect(out).not.toContain('example.co.uk');
    expect(out).not.toContain(USER_ID);
    expect(out).not.toContain('eyJhbGci');
    expect(out).not.toContain('abc.def-ghi');
    expect(out).not.toContain('sk-proj');
    expect(out).toContain('[email]');
    expect(out).toContain('[id]');
  });

  it.each([
    ['TSH 4.2 uIU/mL out of range', '4.2'],
    ['Glucose 95 mg/dL', '95'],
    ['Ferritin 12 ng/mL', '12'],
    ['HbA1c 6.1%', '6.1'],
    ['Vitamin D <20 ng/mL', '20'],
    ['estradiol 145.5 pg/mL', '145.5'],
    ['value 7 bare', '7'],
  ])('removes the lab value in %j', (input, value) => {
    const out = scrubServerText(input);
    expect(out).not.toContain(value);
  });

  it('removes quoted report text and Postgres row details, where names and values hide', () => {
    const out = scrubServerText(
      `Unexpected token in JSON at "Patient: Jane Doe, Ferritin 12" and 'DOB 1990-04-02'; `
      + 'Key (email)=(jane@example.com) already exists',
    );
    expect(out).not.toContain('Jane');
    expect(out).not.toContain('Doe');
    expect(out).not.toContain('1990');
    expect(out).not.toContain('jane@example.com');
    expect(out).toContain('[text]');
  });

  it('removes dates, phone and record numbers', () => {
    const out = scrubServerText('MRN 00412345 seen 04/02/2024 call 555-867-5309');
    expect(out).not.toMatch(/\d/);
  });

  it('cuts echoed report text, unquoted names and all, to the words that name the failure', () => {
    const reportText = `Parse failed on QUEST Patient: Jane Doe ${'COMPREHENSIVE METABOLIC PANEL '.repeat(20)}`;
    expect(reportText.length).toBeGreaterThan(MAX_SCRUBBED_LENGTH);
    expect(scrubServerText(reportText)).toBe(`Parse failed on ${REPORT_TEXT_REMOVED}`);
    // Two lab values in a short message are report text too.
    expect(scrubServerText('Row mapping failed Jane Doe TSH 4.2 uIU/mL Ferritin 12 ng/mL'))
      .toBe(`Row mapping failed ${REPORT_TEXT_REMOVED}`);
  });

  it('keeps a fixed message readable', () => {
    expect(scrubServerText('Report erasure failed: permission denied for table lab_reports'))
      .toBe('Report erasure failed: permission denied for table lab_reports');
  });

  it('is stateless across repeated calls (module-level /g patterns)', () => {
    const input = `a@b.com ${USER_ID} 12 mg/dL`;
    expect(scrubServerText(input)).toBe(scrubServerText(input));
  });
});

describe('errorType and scrubbedErrorMessage', () => {
  it('reports the error class name, never its content', () => {
    class OpenAIShapeError extends Error {
      constructor(message: string) { super(message); this.name = 'OpenAIShapeError'; }
    }
    expect(errorType(new OpenAIShapeError('x'))).toBe('OpenAIShapeError');
    expect(errorType(new TypeError('x'))).toBe('TypeError');
    expect(errorType('Ferritin 12')).toBe('StringError');
    expect(errorType({ value: 12 })).toBe('UnknownError');
    const odd = new Error('x');
    odd.name = 'Name with Jane Doe 12';
    expect(errorType(odd)).toBe('UnknownError');
  });

  it('scrubs the message, and never serialises a thrown object', () => {
    expect(scrubbedErrorMessage(new Error('Ferritin 12 ng/mL for jane@example.com')))
      .toBe('Ferritin [value] for [email]');
    expect(scrubbedErrorMessage({ biomarker: 'Ferritin', value: 12 })).toBe('non-Error value thrown');
  });
});
