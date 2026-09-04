import { describe, expect, it } from 'vitest';
import {
  normalizeLabInsights,
  parseLabInsightsCompletion,
} from './lab-insights-output';

/**
 * The crash this suite exists for: `InsightsModal.tsx` renders
 * `<ChangeIcon text={change.change} />` and `ChangeIcon` calls
 * `text.toLowerCase()` unguarded. One `notable_changes` element without a
 * `change` field throws inside render, and because ErrorBoundary sits at the app
 * root with no per-route boundary, that blanks the whole app.
 *
 * The invariant below — every surviving element has a non-empty string `change`
 * — is what makes that unreachable, including for the shipped 1.0.3 native
 * builds that still contain the unguarded call and cannot be updated.
 */

const wellFormed = {
  summary: 'Two markers moved since your last draw.',
  notable_changes: [
    { biomarker: 'TSH', change: 'increased from 2.1 to 3.4', possible_factors: ['stress'] },
  ],
  questions_to_ask: ['Should we retest?'],
  next_steps_general: ['Book a follow-up'],
};

describe('normalizeLabInsights — the crash invariant', () => {
  it('guarantees every surviving change has a non-empty string `change`', () => {
    const hostile = {
      notable_changes: [
        { biomarker: 'TSH' },                              // no change  <- the crash
        { biomarker: 'Ferritin', change: null },
        { biomarker: 'B12', change: '' },
        { biomarker: 'Iron', change: '   ' },
        { change: 'rose' },                                // no biomarker
        { biomarker: 'Folate', change: 'fell', possible_factors: null },
        null,
        'not an object',
        42,
        [],
      ],
    };
    const result = normalizeLabInsights(hostile);
    expect(result.notable_changes).toHaveLength(1);
    for (const change of result.notable_changes) {
      expect(typeof change.change).toBe('string');
      expect(change.change.length).toBeGreaterThan(0);
      expect(typeof change.biomarker).toBe('string');
      expect(Array.isArray(change.possible_factors)).toBe(true);
      // The exact call the client makes.
      expect(() => change.change.toLowerCase()).not.toThrow();
    }
  });

  it('keeps the good entries when one is malformed', () => {
    // Degrade, don't reject: one bad element must not cost the user everything.
    const mixed = {
      summary: 'ok',
      notable_changes: [
        { biomarker: 'TSH', change: 'increased' },
        { biomarker: 'Ferritin' },
        { biomarker: 'B12', change: 'decreased' },
      ],
    };
    const result = normalizeLabInsights(mixed);
    expect(result.notable_changes.map((c) => c.biomarker)).toEqual(['TSH', 'B12']);
    expect(result.summary).toBe('ok');
  });
});

describe('normalizeLabInsights — every field is always present', () => {
  it('passes a well-formed payload through', () => {
    expect(normalizeLabInsights(wellFormed)).toEqual({
      summary: 'Two markers moved since your last draw.',
      notable_changes: [
        { biomarker: 'TSH', change: 'increased from 2.1 to 3.4', possible_factors: ['stress'] },
      ],
      questions_to_ask: ['Should we retest?'],
      next_steps_general: ['Book a follow-up'],
    });
  });

  it('returns empty defaults for junk input', () => {
    for (const junk of [null, undefined, 42, 'string', [], true]) {
      expect(normalizeLabInsights(junk)).toEqual({
        summary: '',
        notable_changes: [],
        questions_to_ask: [],
        next_steps_general: [],
      });
    }
  });

  it('drops non-string list items rather than rendering them', () => {
    const result = normalizeLabInsights({
      questions_to_ask: ['real', null, 42, '', '  ', { a: 1 }, 'also real'],
    });
    expect(result.questions_to_ask).toEqual(['real', 'also real']);
  });

  it('trims and bounds long strings', () => {
    const result = normalizeLabInsights({ summary: `  ${'x'.repeat(9000)}  ` });
    expect(result.summary.length).toBe(4000);
  });

  it('bounds the number of notable changes', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      biomarker: `B${i}`, change: 'moved',
    }));
    expect(normalizeLabInsights({ notable_changes: many }).notable_changes).toHaveLength(25);
  });
});

describe('parseLabInsightsCompletion — no more throwing on choices[0]', () => {
  const completion = (content: string) => ({ choices: [{ message: { content } }] });

  it('parses a normal completion', () => {
    const result = parseLabInsightsCompletion(completion(JSON.stringify(wellFormed)));
    expect(result?.summary).toBe('Two markers moved since your last draw.');
  });

  it('returns null for an empty choices array instead of throwing', () => {
    // `openaiData.choices[0].message.content` used to throw a TypeError here,
    // which surfaced as a generic 500 with no explanation.
    expect(parseLabInsightsCompletion({ choices: [] })).toBeNull();
  });

  it('returns null for every malformed envelope', () => {
    for (const bad of [
      null, undefined, 42, 'text', {},
      { choices: null }, { choices: [null] }, { choices: [{}] },
      { choices: [{ message: null }] }, { choices: [{ message: {} }] },
      { choices: [{ message: { content: 42 } }] },
    ]) {
      expect(parseLabInsightsCompletion(bad)).toBeNull();
    }
  });

  it('returns null when the content is not valid JSON', () => {
    expect(parseLabInsightsCompletion(completion('this is not json'))).toBeNull();
  });

  it('normalizes hostile content rather than passing it through', () => {
    const result = parseLabInsightsCompletion(
      completion(JSON.stringify({ notable_changes: [{ biomarker: 'TSH' }] })),
    );
    expect(result).not.toBeNull();
    expect(result?.notable_changes).toEqual([]);
  });
});
