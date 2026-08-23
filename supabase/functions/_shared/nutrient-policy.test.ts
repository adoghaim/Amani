import { describe, expect, it } from 'vitest';
import {
  ALLOWED_NUTRIENTS,
  ALLOWED_NUTRIENTS_PROMPT_LIST,
  BANNED_SUPPLEMENTS,
  BANNED_SUPPLEMENT_ABBREVIATIONS,
  findTextViolations,
  sanitizeViolations,
  validateInterpretationOutput,
} from './nutrient-policy';

// A clean interpretation in the shape `InterpretationSchema` enforces. Every
// field below is deliberately compliant; individual tests clone it and poison
// exactly one field.
function cleanInterpretation(): Record<string, unknown> {
  return {
    headline: 'Your panel is broadly steady, with ferritin the one to watch.',
    primary_concern: {
      title: 'Ferritin is on the low side',
      summary: 'Your ferritin came back at 9 ng/mL, below the mark for solid stores.',
      why_it_matters: 'Low stores often show up as fatigue before anything else does.',
    },
    key_findings: [
      {
        biomarker_slug: 'ferritin',
        title: 'Ferritin',
        status: 'attention',
        explanation: 'This result sits below the reference range for your panel.',
      },
    ],
    pattern_signals: [
      {
        title: 'Depletion pattern',
        confidence: 'moderate',
        explanation: 'Two related markers sit low together.',
        related_biomarkers: ['ferritin', 'hemoglobin'],
      },
    ],
    what_you_can_do_now: [
      'Aim for a few minutes of midday sun several times a week.',
      'Notice how your energy tracks against your cycle over the next month.',
    ],
    what_to_do_next: ['Discuss whether retesting ferritin in a few months makes sense.'],
    overall_interpretation: 'Most markers are within range; ferritin is the exception.',
    questions_for_doctor: ['What could be driving my ferritin down?'],
    cycle_context: 'Drawn on cycle day 7, follicular phase.',
    disclaimer: 'Educational only — not medical advice.',
  };
}

// Trips dosage unit, prescriptive verb, and dosing frequency at once.
const VIOLATING = 'Take 65 mg of iron daily with food.';

describe('the clean baseline is actually clean', () => {
  it('passes validation with no violations', () => {
    expect(validateInterpretationOutput(cleanInterpretation())).toEqual({
      valid: true,
      violations: [],
    });
  });
});

describe('allow-list is the single source for the prompt', () => {
  it('derives the prompt list from ALLOWED_NUTRIENTS so the two cannot drift', () => {
    expect(ALLOWED_NUTRIENTS_PROMPT_LIST).toBe(ALLOWED_NUTRIENTS.join(', '));
  });

  it('still emits the nine canonical nutrient names', () => {
    expect(ALLOWED_NUTRIENTS).toHaveLength(9);
    expect(ALLOWED_NUTRIENTS_PROMPT_LIST).toBe(
      'vitamin D, vitamin B12, folate, iron, magnesium, omega-3, iodine, selenium, zinc',
    );
  });
});

describe('banned supplements', () => {
  it.each([...BANNED_SUPPLEMENTS])('catches %s on bare mention', (term) => {
    const violations = findTextViolations(`Some clinicians discuss ${term} in this context.`);
    expect(violations).toContain(`banned_supplement:${term}`);
  });

  it.each([...BANNED_SUPPLEMENT_ABBREVIATIONS])(
    'catches the abbreviation %s that a model actually writes',
    (abbrev) => {
      const violations = findTextViolations(`Some clinicians discuss ${abbrev} for estrogen metabolism.`);
      expect(violations).toContain(`banned_supplement:${abbrev}`);
    },
  );

  it('catches DIM even though only the spelled-out form was listed before', () => {
    expect(findTextViolations('DIM is sometimes discussed here.')).toContain(
      'banned_supplement:DIM',
    );
  });

  it('does not flag the ordinary adjective "dim"', () => {
    expect(findTextViolations('The signal here is dim and hard to read.')).toEqual([]);
  });

  it('catches a banned supplement wherever it hides in the object', () => {
    const doc = cleanInterpretation();
    (doc.primary_concern as Record<string, unknown>).why_it_matters =
      'Ashwagandha is often raised here.';
    expect(validateInterpretationOutput(doc).violations).toContain(
      'banned_supplement:ashwagandha',
    );
  });
});

describe('dosage units', () => {
  it.each([
    'Take 2000 IU of vitamin D.',
    'A 500mg magnesium capsule is often discussed.',
    'Discussion of 5 g doses is out of scope.',
    'A 1 mcg vitamin B12 tablet came up.',
  ])('flags %s', (text) => {
    expect(findTextViolations(text).some((v) => v.startsWith('dosage_unit:'))).toBe(true);
  });

  it.each([
    'Your fasting glucose was 95 mg/dL, just above the optimal window.',
    'Hemoglobin came in at 13.2 g/dL.',
    'Serum iron was 45 µg/dL this draw.',
    'Total cholesterol 210 mg/dL and LDL 130 mg/dL.',
    'Your ferritin came back at 9 ng/mL.',
  ])('does not mistake the lab concentration in %s for a dose', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });

  // Volume denominators were exempted from the start; mass, molar, and
  // per-collection-interval denominators are concentrations too. eGFR is the
  // one that bites hardest — `mL/min/1.73m2` is a unit in the analyte catalog.
  it.each([
    'Urine albumin was 30 mg/g creatinine on this panel.',
    'Urinary iodine came in at 150 mcg/g creatinine.',
    'Free cortisol was 45 µg/24h across the overnight collection.',
    'The 24-hour result was 12 mg/24 hr.',
    'Estimated GFR 90 mL/min/1.73m2 sits comfortably in range.',
  ])('does not mistake the non-volume lab denominator in %s for a dose', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });

  it('still flags a per-mass dosing expression', () => {
    expect(
      findTextViolations('A 5 mg/kg dose was mentioned.').some((v) =>
        v.startsWith('dosage_unit:'),
      ),
    ).toBe(true);
  });
});

describe('prescriptive verbs', () => {
  it.each([
    'Take a magnesium supplement each morning.',
    'You should start taking a vitamin D supplement.',
    'Begin taking the tablets your provider suggested.',
    'Consume some iron capsules alongside meals.',
    'Swallow the capsule whole.',
  ])('flags %s', (text) => {
    expect(findTextViolations(text).some((v) => v.startsWith('prescriptive_verb:'))).toBe(true);
  });

  it.each([
    'At this level, energy and focus are usually the first things to take a hit.',
    'Long stretches of poor sleep take a toll on how these markers read.',
  ])('does not flag the everyday idiom in %s', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });
});

describe('dosing frequency', () => {
  it.each([
    'Take 2000 IU of vitamin D daily.',
    'A magnesium capsule twice a day was mentioned.',
    'The tablets are usually taken with food.',
    'Iron supplements are often discussed on an empty stomach.',
  ])('flags %s', (text) => {
    expect(findTextViolations(text).some((v) => v.startsWith('dosing_frequency:'))).toBe(true);
  });

  it.each([
    'Track how your energy and sleep align with these results daily.',
    'Symptoms that show up every morning are worth logging.',
  ])('does not flag the non-dosing use in %s', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });
});

// ─── F1 regression net ────────────────────────────────────────────────────────
// `/` is a word boundary, so a bare `mg` token in SUBSTANCE_CONTEXT_REGEX used to
// match inside "210 mg/dL". Any ordinary concentration therefore supplied
// "substance context" and re-enabled the prescriptive-verb and dosing-frequency
// checks — the exact checks that guard exists to suppress. One clinically
// required sentence was then enough to fail both OpenAI attempts, make
// `sanitizeViolations` return null on an unfilterable scalar field, and serve a
// paying user the deterministic non-AI fallback.

describe('lab units do not manufacture substance context', () => {
  it.each([
    'Your fasting glucose was 105 mg/dL, drawn on an empty stomach.',
    'Total cholesterol 210 mg/dL; these numbers take a hit after a stretch of poor sleep.',
    'Morning cortisol was 18 µg/dL, collected every morning as the lab asks.',
    'Morning cortisol was 18 mcg/dL, collected every morning as the lab asks.',
    'Creatinine 0.9 mg/dL — worth noticing how it tracks daily against your hydration.',
    'Your ferritin came back at 9 ng/mL, and energy tends to take a dip below that.',
  ])('passes the clinically ordinary sentence %s', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });

  it.each([
    ['Take 65 mg of iron daily with food.', ['dosage_unit', 'prescriptive_verb', 'dosing_frequency']],
    ['A 5 mg/kg dose was mentioned.', ['dosage_unit']],
    ['Consider 2 capsules twice daily.', ['dosing_frequency']],
  ])('still catches the genuine violation in %s', (text, expectedCodes) => {
    const codes = findTextViolations(text as string).map((v) => v.split(':')[0]);
    for (const code of expectedCodes as string[]) expect(codes).toContain(code);
  });

  it('takes substance context from a dosage form, not from the unit beside it', () => {
    expect(findTextViolations('Ferritin 9 ng/mL — log how you feel daily.')).toEqual([]);
    expect(
      findTextViolations('Take the capsules daily.').some((v) =>
        v.startsWith('dosing_frequency:'),
      ),
    ).toBe(true);
  });
});

describe('allow-list enforcement (supplementation must name an allowed nutrient)', () => {
  it.each([...ALLOWED_NUTRIENTS])('lets %s through in consultative phrasing', (nutrient) => {
    const text = `Worth asking your provider whether ${nutrient} supplementation is appropriate for you.`;
    expect(findTextViolations(text)).toEqual([]);
  });

  it('passes the documented COMPLIANT example from NUTRIENT_GUIDELINES.md', () => {
    const text =
      'For your vitamin D: dietary sources and a few minutes of midday sun a few times a week can help. ' +
      'Worth asking your provider whether supplementation is appropriate for you.';
    expect(findTextViolations(text)).toEqual([]);
  });

  it.each([
    'berberine',
    'inositol',
    'red clover',
    'dong quai',
    'licorice root',
  ])('fails closed on %s supplementation, which no deny-list entry covered before', (term) => {
    const violations = findTextViolations(
      `Some clinicians discuss ${term} supplementation in this context.`,
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it.each(['calcium', 'vitamin C', 'copper', 'chromium'])(
    'fails closed on %s supplementation because it is not on the allow-list',
    (nutrient) => {
      const violations = findTextViolations(
        `Ask your provider about ${nutrient} supplementation.`,
      );
      expect(violations.some((v) => v.startsWith('unlisted_nutrient:'))).toBe(true);
    },
  );

  it('accepts the b12 alias as the allow-listed nutrient', () => {
    expect(
      findTextViolations('B12 supplementation is worth raising with your provider.'),
    ).toEqual([]);
  });
});

// ─── M1 regression net ────────────────────────────────────────────────────────
// The validator walks every string in the object. Before this suite the
// sanitizer only touched two array fields, so a violation anywhere else was
// detected twice and then persisted untouched.

const POISONABLE_FIELDS: Array<[string, (doc: Record<string, unknown>) => void]> = [
  ['headline', (d) => { d.headline = VIOLATING; }],
  ['primary_concern.title', (d) => { (d.primary_concern as Record<string, unknown>).title = VIOLATING; }],
  ['primary_concern.summary', (d) => { (d.primary_concern as Record<string, unknown>).summary = VIOLATING; }],
  ['primary_concern.why_it_matters', (d) => { (d.primary_concern as Record<string, unknown>).why_it_matters = VIOLATING; }],
  ['key_findings[0].explanation', (d) => { (d.key_findings as Record<string, unknown>[])[0].explanation = VIOLATING; }],
  ['pattern_signals[0].explanation', (d) => { (d.pattern_signals as Record<string, unknown>[])[0].explanation = VIOLATING; }],
  ['what_you_can_do_now[0]', (d) => { (d.what_you_can_do_now as string[])[0] = VIOLATING; }],
  ['what_to_do_next[0]', (d) => { (d.what_to_do_next as string[])[0] = VIOLATING; }],
  ['overall_interpretation', (d) => { d.overall_interpretation = VIOLATING; }],
  ['questions_for_doctor[0]', (d) => { (d.questions_for_doctor as string[])[0] = VIOLATING; }],
  ['cycle_context', (d) => { d.cycle_context = VIOLATING; }],
  ['disclaimer', (d) => { d.disclaimer = VIOLATING; }],
];

describe('validateInterpretationOutput walks every field', () => {
  it.each(POISONABLE_FIELDS)('detects a violation in %s', (_field, poison) => {
    const doc = cleanInterpretation();
    poison(doc);
    expect(validateInterpretationOutput(doc).valid).toBe(false);
  });
});

describe('sanitizeViolations covers every field the validator checks', () => {
  it.each(POISONABLE_FIELDS)('never returns unsafe content for %s', (_field, poison) => {
    const doc = cleanInterpretation();
    poison(doc);
    const result = sanitizeViolations(doc);
    if (result !== null) {
      expect(validateInterpretationOutput(result)).toEqual({ valid: true, violations: [] });
    }
  });

  it('drops the offending item from a top-level string array and keeps the rest', () => {
    const doc = cleanInterpretation();
    (doc.what_you_can_do_now as string[])[0] = VIOLATING;
    const result = sanitizeViolations(doc);
    expect(result).not.toBeNull();
    expect(result!.what_you_can_do_now).toEqual([
      'Notice how your energy tracks against your cycle over the next month.',
    ]);
    expect(result!.what_to_do_next).toEqual(doc.what_to_do_next);
    expect(result!.headline).toBe(doc.headline);
  });

  it('drops an offending question without discarding the whole interpretation', () => {
    const doc = cleanInterpretation();
    (doc.questions_for_doctor as string[]).push('Should I take 65 mg of iron daily?');
    const result = sanitizeViolations(doc);
    expect(result).not.toBeNull();
    expect(result!.questions_for_doctor).toEqual(['What could be driving my ferritin down?']);
  });

  it('fails closed on a scalar field rather than persisting a dosage instruction', () => {
    const doc = cleanInterpretation();
    doc.overall_interpretation =
      'Your ferritin is low — take 65 mg of iron daily with food.';
    expect(sanitizeViolations(doc)).toBeNull();
  });

  it('fails closed on a string nested inside an object array', () => {
    const doc = cleanInterpretation();
    (doc.key_findings as Record<string, unknown>[])[0].explanation = VIOLATING;
    expect(sanitizeViolations(doc)).toBeNull();
  });

  it('returns the object unchanged when nothing violates', () => {
    const doc = cleanInterpretation();
    expect(sanitizeViolations(doc)).toEqual(doc);
  });

  it('does not mutate the object it was handed', () => {
    const doc = cleanInterpretation();
    (doc.what_you_can_do_now as string[])[0] = VIOLATING;
    const before = JSON.parse(JSON.stringify(doc));
    sanitizeViolations(doc);
    expect(doc).toEqual(before);
  });
});
