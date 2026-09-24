import { describe, expect, it, vi } from 'vitest';
import {
  FLOOR_FINDING_KEYS,
  FLOOR_REQUIRED_KEYS,
  MEDICAL_FLOOR,
  findFloorViolations,
  shapeInterpretation,
  shouldRequestDeepInterpretation,
  shouldGenerateDeepInterpretation,
  type InterpretationPayload,
} from './response-shaping';

/**
 * The two payload shapes below mirror what the real code produces:
 * `InterpretationSchema` (_shared/schemas/interpretation.ts) for the AI path,
 * and `generateFallbackInterpretation` for the deterministic one. They
 * deliberately disagree on field names, because the real ones do.
 */

const AI_PAYLOAD: InterpretationPayload = Object.freeze({
  headline: 'Your thyroid markers need a closer look',
  primary_concern: { title: 'TSH', summary: 'Elevated', why_it_matters: 'Energy' },
  key_findings: [
    { biomarker_slug: 'tsh', title: 'TSH', status: 'attention', explanation: 'Above range' },
  ],
  pattern_signals: [
    { title: 'Thyroid', confidence: 'moderate', explanation: '...', related_biomarkers: ['tsh'] },
  ],
  what_you_can_do_now: ['Rest'],
  what_to_do_next: ['Book a follow-up'],
  overall_interpretation: 'One marker is outside range.',
  questions_for_doctor: ['Should we retest TSH?'],
  cycle_context: 'luteal',
  disclaimer: 'Educational purposes only.',
});

const DETERMINISTIC_PAYLOAD: InterpretationPayload = Object.freeze({
  headline: 'One marker is outside its reference range',
  summary_bullets: ['TSH is above range'],
  top_findings: [{ biomarker_slug: 'tsh', title: 'TSH', status: 'discuss' }],
  pattern_signals: [],
  overall_interpretation: 'One marker is outside range.',
  cycle_context: {
    estimated_cycle_day: 21,
    estimated_cycle_phase: 'luteal',
    confidence: 'medium',
    explanation: '',
  },
  questions_for_doctor: ['Should we retest TSH?'],
  disclaimer: 'Educational purposes only.',
});

const base = {
  aiInterpretation: AI_PAYLOAD,
  deterministicInterpretation: () => DETERMINISTIC_PAYLOAD,
};

describe('shapeInterpretation — selects a whole payload, never edits one', () => {
  it('returns the AI payload BY REFERENCE for an entitled deep read', () => {
    /*
      The central invariant. Field-level stripping is the failure mode this
      design exists to make unrepresentable — and it would not even work,
      because InterpretationSchema requires every field.
    */
    const result = shapeInterpretation({ ...base, tier: 'plus', deepAccessGranted: true });
    expect(result.payload).toBe(AI_PAYLOAD);
  });

  it('returns the deterministic payload BY REFERENCE otherwise', () => {
    const result = shapeInterpretation({ ...base, tier: 'free', deepAccessGranted: false });
    expect(result.payload).toBe(DETERMINISTIC_PAYLOAD);
  });

  it('never returns a payload that is neither input', () => {
    for (const tier of ['free', 'plus'] as const) {
      for (const deepAccessGranted of [true, false]) {
        for (const aiInterpretation of [AI_PAYLOAD, null]) {
          const result = shapeInterpretation({
            ...base, tier, deepAccessGranted, aiInterpretation,
          });
          expect(
            result.payload === AI_PAYLOAD || result.payload === DETERMINISTIC_PAYLOAD,
          ).toBe(true);
        }
      }
    }
  });
});

describe('shapeInterpretation — the deterministic payload is built lazily', () => {
  it('does NOT build it when the deep interpretation is used', () => {
    /*
      Before tiering, generateFallbackInterpretation ran only when OpenAI
      failed. If shaping evaluated it eagerly it would run on every request
      including successful Plus ones, so a latent throw inside it would start
      breaking reports that previously succeeded. This asserts the frequency is
      unchanged.
    */
    let built = 0;
    shapeInterpretation({
      tier: 'plus',
      deepAccessGranted: true,
      aiInterpretation: AI_PAYLOAD,
      deterministicInterpretation: () => { built++; return DETERMINISTIC_PAYLOAD; },
    });
    expect(built).toBe(0);
  });

  it('builds it exactly once when it is used', () => {
    let built = 0;
    const result = shapeInterpretation({
      tier: 'free',
      deepAccessGranted: false,
      aiInterpretation: AI_PAYLOAD,
      deterministicInterpretation: () => { built++; return DETERMINISTIC_PAYLOAD; },
    });
    expect(built).toBe(1);
    expect(result.payload).toBe(DETERMINISTIC_PAYLOAD);
  });

  it('builds it when the model failed, even for Plus', () => {
    let built = 0;
    shapeInterpretation({
      tier: 'plus',
      deepAccessGranted: true,
      aiInterpretation: null,
      deterministicInterpretation: () => { built++; return DETERMINISTIC_PAYLOAD; },
    });
    expect(built).toBe(1);
  });
});

describe('shapeInterpretation — the tier matrix', () => {
  it('gives Plus the deep interpretation', () => {
    expect(shapeInterpretation({ ...base, tier: 'plus', deepAccessGranted: true }))
      .toMatchObject({ depth: 'deep', source: 'ai', tier: 'plus' });
  });

  it('gives a Free user WITH an introductory credit the deep interpretation', () => {
    // The 2 lifetime Introductory Deep Access reports are full AI reports.
    expect(shapeInterpretation({ ...base, tier: 'free', deepAccessGranted: true }))
      .toMatchObject({ depth: 'deep', source: 'ai', tier: 'free' });
  });

  it('gives a Free user past their credits the deterministic interpretation', () => {
    expect(shapeInterpretation({ ...base, tier: 'free', deepAccessGranted: false }))
      .toMatchObject({ depth: 'standard', source: 'fallback', tier: 'free' });
  });

  it('falls back for Plus when the model failed — unchanged from today', () => {
    // Pre-existing behaviour: OpenAI failure lands on the deterministic path.
    expect(shapeInterpretation({
      ...base, tier: 'plus', deepAccessGranted: true, aiInterpretation: null,
    })).toMatchObject({ depth: 'standard', source: 'fallback', tier: 'plus' });
  });
});

describe('shouldRequestDeepInterpretation — Free past its credits costs nothing', () => {
  it('does not call the model when deep access was denied', () => {
    expect(shouldRequestDeepInterpretation(false, true, true)).toBe(false);
  });

  it('calls the model when access is granted and inputs exist', () => {
    expect(shouldRequestDeepInterpretation(true, true, true)).toBe(true);
  });

  it('still respects the pre-existing preconditions', () => {
    expect(shouldRequestDeepInterpretation(true, false, true)).toBe(false); // no API key
    expect(shouldRequestDeepInterpretation(true, true, false)).toBe(false); // no analytes
  });
});

describe('the medical floor survives every tier', () => {
  it('passes the real AI shape', () => {
    expect(findFloorViolations(AI_PAYLOAD)).toEqual([]);
  });

  it('passes the real deterministic shape', () => {
    expect(findFloorViolations(DETERMINISTIC_PAYLOAD)).toEqual([]);
  });

  it('passes whatever shaping chooses, at either tier', () => {
    for (const tier of ['free', 'plus'] as const) {
      for (const deepAccessGranted of [true, false]) {
        const { payload } = shapeInterpretation({ ...base, tier, deepAccessGranted });
        expect(findFloorViolations(payload)).toEqual([]);
      }
    }
  });

  it('catches a payload missing the disclaimer', () => {
    const { disclaimer: _dropped, ...withoutDisclaimer } = DETERMINISTIC_PAYLOAD;
    expect(findFloorViolations(withoutDisclaimer))
      .toContainEqual({ key: 'disclaimer', reason: 'missing' });
  });

  it('catches a payload with no findings surface at all', () => {
    const stripped = {
      headline: 'x', cycle_context: {}, questions_for_doctor: [], disclaimer: 'y',
    };
    expect(findFloorViolations(stripped))
      .toContainEqual({ key: FLOOR_FINDING_KEYS.join('|'), reason: 'missing' });
  });

  it('accepts any one of the three findings surfaces', () => {
    for (const key of FLOOR_FINDING_KEYS) {
      const payload = {
        headline: 'x', cycle_context: {}, questions_for_doctor: [], disclaimer: 'y',
        [key]: [],
      };
      expect(findFloorViolations(payload)).toEqual([]);
    }
  });

  it('rejects a null or non-object payload', () => {
    expect(findFloorViolations(null)).toEqual([{ key: '<payload>', reason: 'missing' }]);
    expect(findFloorViolations(undefined)).toEqual([{ key: '<payload>', reason: 'missing' }]);
  });

  it('treats every required key as required', () => {
    for (const key of FLOOR_REQUIRED_KEYS) {
      const payload: InterpretationPayload = { ...DETERMINISTIC_PAYLOAD };
      delete payload[key];
      expect(findFloorViolations(payload)).toContainEqual({ key, reason: 'missing' });
    }
  });
});

describe('biomarker data cannot be withheld by any tier', () => {
  it('is structurally absent from the shaped payload', () => {
    /*
      The strongest form of the medical-floor promise: the user's values,
      reference ranges and abnormal flags are not in `json_output` at all. They
      live in `report_analytes` / `biomarkers`, which the client reads directly
      and which this module never touches. Shaping therefore CANNOT hide them —
      not "is careful not to", cannot.

      If a future change ever moves biomarker values into the interpretation
      payload, this test fails and that conversation happens before it ships.
    */
    for (const tier of ['free', 'plus'] as const) {
      for (const deepAccessGranted of [true, false]) {
        const { payload } = shapeInterpretation({ ...base, tier, deepAccessGranted });
        for (const key of ['biomarkers', 'analytes', 'report_analytes', 'values']) {
          expect(payload).not.toHaveProperty(key);
        }
      }
    }
  });

  it('keeps the floor definition in one place', () => {
    expect(MEDICAL_FLOOR).toEqual({
      rawValues: true,
      abnormalFlags: true,
      fullHistory: true,
      deterministicInterpretation: true,
    });
  });
});

describe('tier is carried outside the payload', () => {
  it('never writes a tier marker into json_output', () => {
    /*
      `sanitizeViolations` filters every top-level string array in the payload
      and the nutrient validator walks every string in it. A `tier: "free"`
      field would be scanned; upgrade copy could be silently filtered, or could
      fail the whole interpretation if it happened to name a nutrient. So tier
      rides in its own column.
    */
    for (const tier of ['free', 'plus'] as const) {
      const result = shapeInterpretation({ ...base, tier, deepAccessGranted: true });
      expect(result.payload).not.toHaveProperty('tier');
      expect(result.payload).not.toHaveProperty('depth');
      expect(result.tier).toBe(tier);
    }
  });
});

// Post-limit generation changes cost/depth, never the access decision.

const exhausted = { granted: false as const, reason: 'introductory_access_exhausted' as const,
  claimsUsed: 3, claimsRemaining: 0 as const, consumesCredit: false as const };
const postLimitInput = { freemiumActive: true, tier: 'free' as const,
  deepAccessGranted: false, decision: exhausted };

describe('post-limit generation policy', () => {
  it.each([undefined, 'always'])('generates full AI after exhaustion with setting %s', postLimitGeneration => {
    const deep = shouldGenerateDeepInterpretation({ ...postLimitInput, postLimitGeneration });
    expect(deep).toBe(true);
    const ai = { headline: 'Full model output', pattern_signals: ['full'] };
    const fallback = vi.fn();
    const result = shapeInterpretation({ tier: 'free', deepAccessGranted: deep, aiInterpretation: ai,
      deterministicInterpretation: fallback });
    expect(result).toEqual({ payload: ai, tier: 'free', depth: 'deep', source: 'ai' });
    expect(result.payload).toBe(ai);
    expect(fallback).not.toHaveBeenCalled();
    expect(exhausted.consumesCredit).toBe(false);
  });
  it.each(['on_demand', 'invalid', ''])('retains deterministic generation for %s', postLimitGeneration => {
    expect(shouldGenerateDeepInterpretation({ ...postLimitInput, postLimitGeneration })).toBe(false);
  });
  it.each([undefined, 'always', 'on_demand'])('does not affect Premium or an existing grant: %s', postLimitGeneration => {
    for (const tier of ['plus', 'free'] as const) {
      expect(shouldGenerateDeepInterpretation({ ...postLimitInput, tier,
        deepAccessGranted: true, decision: null, postLimitGeneration })).toBe(true);
    }
  });
  it('preserves the flag-off generation predicate for all settings and grants', () => {
    for (const postLimitGeneration of [undefined, 'always', 'on_demand']) {
      for (const deepAccessGranted of [true, false]) {
        expect(shouldGenerateDeepInterpretation({ ...postLimitInput, freemiumActive: false,
          deepAccessGranted, postLimitGeneration })).toBe(deepAccessGranted);
      }
    }
  });
  it('does not bypass missing access context or missing model prerequisites', () => {
    expect(shouldGenerateDeepInterpretation({ ...postLimitInput, decision: null })).toBe(false);
    expect(shouldRequestDeepInterpretation(true, false, true)).toBe(false);
    expect(shouldRequestDeepInterpretation(true, true, false)).toBe(false);
  });
});
