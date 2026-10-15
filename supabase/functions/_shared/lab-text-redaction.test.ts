import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { REDACTION_TOKEN, redactLabText } from './lab-text-redaction.ts';
import { parseAllReportItems } from '../../../src/utils/parser/pipeline';
import { questFixture } from '../../../src/utils/parser/__fixtures__/quest';
import { labcorpFixture } from '../../../src/utils/parser/__fixtures__/labcorp';
import { honeFixture } from '../../../src/utils/parser/__fixtures__/hone';
import { genericFixture } from '../../../src/utils/parser/__fixtures__/generic';
import { edgeCasesFixture } from '../../../src/utils/parser/__fixtures__/edgeCases';

/*
 * PK-PRIV-01: every report below is fabricated. The people, numbers and
 * addresses are invented (555 phone numbers, example.com addresses); the layouts
 * imitate what PDF.js text extraction produces for common US lab reports.
 * Each fixture lists the identifiers planted in it and the result rows that must
 * survive byte for byte.
 */

interface Fixture {
  name: string;
  text: string;
  identifiers: string[];
  resultRows: string[];
}

const QUEST_ROWS = [
  'TSH                               4.85 (H)    mIU/L       0.40-4.50',
  'Free T4                           1.1         ng/dL       0.8-1.8',
  'Ferritin                          18 (L)      ng/mL       16-232',
  'Vitamin D, 25-Hydroxy             28          ng/mL       30-100',
  'Vitamin B12                       450         pg/mL       232-1245',
  'Hemoglobin                        13.2        g/dL        11.7-15.5',
];

const questWithPhi: Fixture = {
  name: 'Quest-style, columned patient block',
  text: `
Quest Diagnostics Incorporated
Patient Information                 Specimen Information           Client Information
RIVERA, MARISOL K                   Specimen: QD458217Z            Client #: 97512345
DOB: 03/14/1988  AGE: 37            Requisition: 0012345           Northside Women's Health
Gender: F                           Collected: 09/30/2026 / 07:45 EDT
Phone: 555-867-5309                 Received: 09/30/2026 / 11:02 EDT
Patient ID: 4455667788              Reported: 10/01/2026 / 06:13 EDT
1427 Larkspur Lane, Apt 3B
Fairview Heights, IL 62208

Test                              Result      Units       Reference Range
${QUEST_ROWS.join('\n')}

Ordering Physician: Dr. Smith
`,
  identifiers: ['RIVERA', 'MARISOL', '03/14/1988', 'QD458217Z', '97512345', '0012345', '555-867-5309',
    '4455667788', '1427 Larkspur', 'Fairview Heights', '62208'],
  resultRows: QUEST_ROWS,
};

const LABCORP_ROWS = [
  'Total Cholesterol     212      mg/dL      125-200',
  'HDL Cholesterol       58       mg/dL      >40',
  'LDL Cholesterol       132      mg/dL      0-99',
  'Triglycerides         110      mg/dL      0-149',
  'Hemoglobin A1c        5.6      %          4.8-5.6',
  'Estradiol             145.2    pg/mL      Follicular 12.5-166.0',
  'Progesterone          0.4      ng/mL      Luteal 1.8-23.9',
];

const labcorpWithPhi: Fixture = {
  name: 'LabCorp-style, single-line fields',
  text: `
LabCorp
Laboratory Corporation of America
Patient Name: Okafor, Adaeze N    DOB: 1991-07-22    Sex: F
Accession Number: 2847193650    Account Number: 30451877
MRN: A00983321    Phone: (555) 201-4478
Patient Address: 88 W Maple Ave, Springfield, MO 65804
Email: adaeze.okafor@example.com
Date Collected: 10/02/2026

Test                  Result   Units      Ref. Interval
${LABCORP_ROWS.join('\n')}
`,
  identifiers: ['Okafor', 'Adaeze', '1991-07-22', '2847193650', '30451877', 'A00983321', '201-4478',
    '88 W Maple', '65804', 'adaeze.okafor@example.com'],
  resultRows: LABCORP_ROWS,
};

const HOSPITAL_ROWS = [
  'WBC 6.1 x10E3/uL 3.4-10.8',
  'Platelets 250 x10E3/uL 150-450',
  'Sodium 140 mmol/L 136-145',
  'Potassium 4.2 mmol/L 3.5-5.1',
  'pH 6.0 5.0-8.0',
  'Iron, Total 61 ug/dL 27-159',
];

const hospitalWithPhi: Fixture = {
  name: 'hospital portal export, single-spaced',
  text: `St. Mercy Regional Medical Center Laboratory
Name: Chen, Wei-Ling
Date of Birth: March 3, 1985
Medical Record Number: 00-447-1932
SSN: 123-45-6789
Home Phone: 555.310.2299 Mobile: +1 555 412 7781
Address: 4502 Old Orchard Rd, Unit 12
Contact: wchen85@example.org
Fasting: Yes
${HOSPITAL_ROWS.join('\n')}
`,
  identifiers: ['Chen', 'Wei-Ling', 'March 3, 1985', '00-447-1932', '123-45-6789', '555.310.2299',
    '412 7781', '4502 Old Orchard', 'wchen85@example.org'],
  resultRows: [...HOSPITAL_ROWS, 'Fasting: Yes'],
};

const HONE_ROWS = [
  'Estradiol', 'Your Result: 145 pg/mL', 'Optimal Range: 30-400',
  'Progesterone', 'Your Result: 8.2 ng/mL', 'Optimal Range: 1.8-24',
];

const honeWithPhi: Fixture = {
  name: 'Hone-style, two-line results',
  text: `
Hone Health
honehealth.com
Member ID: HM-00481
Patient
Jordan Ellis-Baptiste
D.O.B. 11/05/1979
Email: j.ellis.b@example.net

${HONE_ROWS.join('\n')}
`,
  identifiers: ['HM-00481', 'Jordan', 'Ellis-Baptiste', '11/05/1979', 'j.ellis.b@example.net'],
  resultRows: HONE_ROWS,
};

const FIXTURES = [questWithPhi, labcorpWithPhi, hospitalWithPhi, honeWithPhi];

describe('redactLabText: identifiers are removed', () => {
  for (const f of FIXTURES) {
    it(`${f.name}: no planted identifier survives`, () => {
      const { text, total } = redactLabText(f.text);
      for (const id of f.identifiers) expect(text, `leaked ${id}`).not.toContain(id);
      expect(total).toBeGreaterThan(0);
    });
  }

  it('reports counts per kind, never values', () => {
    const r = redactLabText(labcorpWithPhi.text);
    expect(r.counts).toEqual({ name: 1, dob: 1, id: 3, address: 1, phone: 1, email: 1, ssn: 0 });
    expect(r.total).toBe(8);
    expect(JSON.stringify(r.counts)).not.toContain('Okafor');
  });

  it('keeps the field labels so the model still reads the layout', () => {
    const { text } = redactLabText(labcorpWithPhi.text);
    expect(text).toContain(`Patient Name: ${REDACTION_TOKEN.name}    DOB: ${REDACTION_TOKEN.dob}    Sex: F`);
    expect(text).toContain(`MRN: ${REDACTION_TOKEN.id}    Phone: ${REDACTION_TOKEN.phone}`);
  });

  it('cuts a DOB to the date and keeps the age beside it', () => {
    const { text } = redactLabText('DOB: 03/14/1988  AGE: 37');
    expect(text).toBe(`DOB: ${REDACTION_TOKEN.dob}  AGE: 37`);
  });

  it.each([
    ['Gender: F DOB: 01/02/1990 Age: 35', `Gender: F DOB: ${REDACTION_TOKEN.dob} Age: 35`],
    ['DOB 1/2/90', `DOB ${REDACTION_TOKEN.dob}`],
    ['Patient: GARCIA, ELENA Sex: F', `Patient: ${REDACTION_TOKEN.name} Sex: F`],
    ['Specimen Number: 2026-SPN-00471  Specimen: Serum', `Specimen Number: ${REDACTION_TOKEN.id}  Specimen: Serum`],
    ['Call (555) 010-2233 with questions', `Call ${REDACTION_TOKEN.phone} with questions`],
    ['P.O. Box 4471', REDACTION_TOKEN.address],
  ])('single-line field: %s', (input, expected) => {
    expect(redactLabText(input).text).toBe(expected);
  });

  it('redacts a name under a "Patient Information" column heading only', () => {
    const { text } = redactLabText(questWithPhi.text);
    expect(text).toContain(`${REDACTION_TOKEN.name}                   Specimen: ${REDACTION_TOKEN.id}`);
  });

  it('handles CRLF text and joins it back with the same separators', () => {
    const crlf = labcorpWithPhi.text.replace(/\n/g, '\r\n');
    const { text } = redactLabText(crlf);
    expect(text.split('\r\n').length).toBe(crlf.split('\r\n').length);
    for (const row of LABCORP_ROWS) expect(text).toContain(`${row}\r\n`);
  });

  it('is idempotent', () => {
    for (const f of FIXTURES) {
      const once = redactLabText(f.text).text;
      const twice = redactLabText(once);
      expect(twice.text).toBe(once);
      expect(twice.total).toBe(0);
    }
  });

  it('never throws on empty or non-string input', () => {
    expect(redactLabText('').text).toBe('');
    expect(redactLabText(undefined as unknown as string).text).toBe('');
  });
});

/*
 * Pre-existing client-parser defects, found by this suite and reported in the
 * PR, not fixed here (parser scope). On the Hone layout the parser's lookahead
 * window reaches the header block: it reads Estradiol as 481, the digits of
 * "Member ID: HM-00481", and it emits an "alt" item from the "Hone Health"
 * header ("Health" contains "alt"). Those two items are drawn from the
 * identifier block, so redaction legitimately changes them, and for Estradiol it
 * corrects the value to the printed 145. Every other item must be identical.
 * source_snippet is a raw window of the surrounding text and is compared apart.
 */
const IDENTIFIER_CONTAMINATED_ON_HONE = new Set(['estradiol', 'alt']);
const isHone = (text: string) => text.includes('Hone Health');
function parsedResults(text: string) {
  const items = parseAllReportItems(text).map(({ source_snippet: _snippet, ...rest }) => rest);
  return isHone(text) ? items.filter((i) => !IDENTIFIER_CONTAMINATED_ON_HONE.has(String(i.canonical_slug))) : items;
}

describe('redactLabText: biomarker names, values, units and ranges are untouched', () => {
  it('Hone layout: the parser stops reading Estradiol from the Member ID once it is redacted', () => {
    const value = (t: string) => parseAllReportItems(t).find((i) => i.canonical_slug === 'estradiol')?.value_numeric;
    expect(value(honeFixture)).toBe(481);
    expect(value(redactLabText(honeFixture).text)).toBe(145);
    for (const t of [questFixture, labcorpFixture, genericFixture, edgeCasesFixture]) expect(isHone(t)).toBe(false);
  });

  it('source snippets differ only where they include a redacted identifier', () => {
    for (const t of [questFixture, labcorpFixture, genericFixture, edgeCasesFixture, ...FIXTURES.map((f) => f.text)]) {
      const before = parseAllReportItems(t);
      const after = parseAllReportItems(redactLabText(t).text);
      expect(after.length).toBe(before.length);
      before.forEach((item, i) => {
        if (item.source_snippet !== after[i].source_snippet) expect(after[i].source_snippet).toContain('[REDACTED-');
      });
    }
  });

  for (const f of FIXTURES) {
    it(`${f.name}: every result row survives byte for byte`, () => {
      const lines = redactLabText(f.text).text.split('\n');
      for (const row of f.resultRows) expect(lines).toContain(row);
    });

    it(`${f.name}: the client parser reads the same biomarkers before and after`, () => {
      expect(parsedResults(redactLabText(f.text).text)).toEqual(parsedResults(f.text));
    });
  }

  const parserFixtures = { questFixture, labcorpFixture, honeFixture, genericFixture, edgeCasesFixture };
  for (const [name, text] of Object.entries(parserFixtures)) {
    it(`parser fixture ${name}: parsed items are identical after redaction`, () => {
      expect(parsedResults(redactLabText(text).text)).toEqual(parsedResults(text));
    });
  }

  it.each([
    ['a value followed by its range is not a phone number', 'Vitamin B12 450 232-1245 pg/mL'],
    ['a value-range pair with spaces is not a phone number', 'Platelets 250 150 - 450'],
    ['urinalysis pH is not a phone label', 'pH: 6.0'],
    ['a bare ten-digit number with no label stays', 'Lot 1234567890'],
    ['collection and report dates stay', 'Collection Date: 2026-04-01   Reported: 10/01/2026'],
    ['a comma-named analyte on its own line stays', 'Iron, Total'],
    ['a non-identifier account status stays', 'Account: Active'],
    ['a specimen type stays', 'Specimen: Serum'],
    ['an analyte with a unit suffix that looks like a street word stays', 'Glucose, Pl 94 mg/dL 70-99'],
    ['a vitamin D line stays', '25 Hydroxy Vitamin D 28 ng/mL 30-100'],
    ['the deliberate "Preferred name" personalisation line stays', 'Preferred name: Amara'],
    ['a comparator result stays', 'HDL Cholesterol >40 mg/dL'],
  ])('%s', (_label, line) => {
    const r = redactLabText(line);
    expect(r.text).toBe(line);
    expect(r.total).toBe(0);
  });
});

/*
 * The three handlers send their user message through redactLabText at the
 * single place each builds it. Their Deno imports keep them out of Vitest, so
 * the wiring is pinned from source (the technique delete-user-data.erasure.test.ts
 * uses), and each prompt template is checked to come through redaction intact.
 */
const fnSource = (name: string) => readFileSync(new URL(`../${name}/index.ts`, import.meta.url), 'utf8');

describe('handler wiring', () => {
  it('extract-biomarkers redacts the uploaded lab text before building the prompt', () => {
    const src = fnSource('extract-biomarkers');
    expect(src).toContain('import { redactLabText } from "../_shared/lab-text-redaction.ts";');
    expect(src).toMatch(/const labText = redactLabText\(text\)\.text;/);
    const prompt = src.slice(src.indexOf('const userPrompt'), src.indexOf('\n', src.indexOf('const userPrompt')));
    expect(prompt).toContain('${labText}');
    expect(prompt).not.toContain('${text}');
  });

  it('generate-interpretation redacts the user message on every OpenAI attempt', () => {
    const src = fnSource('generate-interpretation');
    expect(src).toContain('import { redactLabText } from "../_shared/lab-text-redaction.ts";');
    const call = src.slice(src.indexOf('async function callOpenAIOnce'));
    expect(call).toContain('{ role: "user", content: redactLabText(prompt).text }');
    expect(src.match(/role: "user"/g)).toHaveLength(1);
  });

  it('lab-insights redacts the user message', () => {
    const src = fnSource('lab-insights');
    expect(src).toContain('import { redactLabText } from "../_shared/lab-text-redaction.ts";');
    expect(src).toMatch(/content: redactLabText\(prompt\)\.text,/);
  });

  it.each(['generate-interpretation', 'lab-insights', 'extract-biomarkers'])(
    '%s: the instruction text of its prompt passes through redaction unchanged',
    (name) => {
      const src = fnSource(name);
      // Every template literal in the handler, with interpolations blanked:
      // what is left is the fixed instruction text the model always receives.
      const templates = [...src.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, ''));
      expect(templates.length).toBeGreaterThan(0);
      for (const t of templates) {
        const r = redactLabText(t);
        expect(r.text, t.slice(0, 80)).toBe(t);
      }
    },
  );
});
