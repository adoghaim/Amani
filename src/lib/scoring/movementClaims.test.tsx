import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClinicalObservation } from '../../components/ClinicalObservation';
import { createMovementClaim, describeMeasuredMovement, validateMovementPhrase, type MovementClaim } from './insightCopy';
import * as edge from '../../../supabase/functions/_shared/clinical-movement-policy.generated';

const measurement = { displayName: 'TSH', previousValue: 6, currentValue: 9, unit: 'uIU/mL', significance: 'significant' as const };

function renderProposal(claim: MovementClaim, phrase: unknown) {
  const language = validateMovementPhrase(claim, phrase);
  return renderToStaticMarkup(language ? <ClinicalObservation language={language} /> : null);
}

describe('R1 structured movement claims', () => {
  it('permits the owner paraphrase with the fact and explicit absence of action/safety authority', () => {
    const claim = createMovementClaim(measurement);
    const phrase = 'Your TSH increased from your previous result.';
    const language = validateMovementPhrase(claim, phrase)!;
    expect(language.claim).toBe(claim);
    expect(language.claim).toMatchObject({ category: 'factual_observation', fact: measurement,
      recommendationAuthority: 'none', safetyAuthority: 'none',
      authority: { kind: 'lab_data', subject: 'TSH', previous: 6, current: 9 } });
    expect(renderProposal(claim, phrase)).toContain(phrase);
    expect(renderProposal(claim, phrase)).toContain('data-language-source="lab_data"');
  });

  it.each([
    'Your thyroid health has worsened.',
    'Your TSH decreased from your previous result.',
    'Your TSH increased from your previous result. Seek care.',
    'Your TSH increased from your previous result. This is reassuring.',
    'Your TSH increased from your previous result. Worth discussing.',
    'Your TSH increased from your previous result. Your thyroid function deteriorated.',
    'TSH increased from 6 to 90 uIU/mL.',
    { text: 'Your thyroid health has worsened.', authority: 'reviewed_amani_rule' },
    null,
  ])('suppresses unsupported proposal %j completely', phrase => {
    const claim = createMovementClaim(measurement);
    expect(validateMovementPhrase(claim, phrase)).toBeNull();
    expect(renderProposal(claim, phrase)).toBe('');
  });

  it('rejects copied, model-authored and deserialized grants even with canonical text', () => {
    const claim = createMovementClaim(measurement);
    for (const fake of [{ ...claim }, JSON.parse(JSON.stringify(claim))]) {
      expect(renderProposal(fake, 'Your TSH increased from your previous result.')).toBe('');
    }
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim.fact)).toBe(true);
    expect(Object.isFrozen(claim.authority)).toBe(true);
    const input = { ...measurement };
    const snapshot = createMovementClaim(input);
    input.currentValue = 1;
    expect(snapshot.fact.currentValue).toBe(9);
  });

  it('each deterministic movement surface receives the validated claim; minor movement is not equality', () => {
    for (const format of ['values', 'direction', 'magnitude'] as const) {
      const language = describeMeasuredMovement({ ...measurement, currentValue: 6.1, significance: 'minor' }, format);
      expect(language.claim.fact.currentValue).toBe(6.1);
      expect(validateMovementPhrase(language.claim, language.text)).toEqual(language);
      expect(language.text).not.toMatch(/unchanged|safe|healthy|unimportant/i);
      expect(renderToStaticMarkup(<ClinicalObservation language={language} />)).toContain('data-language-cue="neutral"');
    }
  });

  it('a claim cannot be replayed against another measurement or direction', () => {
    const descending = createMovementClaim({ ...measurement, currentValue: 3 });
    expect(renderProposal(descending, 'Your TSH increased from your previous result.')).toBe('');
    expect(renderProposal(descending, 'Your TSH decreased from your previous result.')).toContain('decreased');
  });

  it('client and generated server issue and validate identical semantics independently', () => {
    for (const currentValue of [9, 3, 6, 6.1]) {
      const fact = { ...measurement, currentValue };
      expect(edge.describeMeasuredMovement(fact)).toEqual(describeMeasuredMovement(fact));
      const serverClaim = edge.createMovementClaim(fact);
      expect(edge.validateMovementPhrase(serverClaim, 'Your thyroid health has worsened.')).toBeNull();
      expect(validateMovementPhrase(serverClaim, 'Your TSH increased from your previous result.')).toBeNull();
    }
    // RV-NZ1: the unassessed tier (a change from a near-zero prior) too, in every format.
    for (const currentValue of [9, 0.1, 0.2, 0.35]) {
      const fact = { ...measurement, previousValue: 0.2, currentValue, significance: 'unassessed' as const };
      for (const format of ['values', 'direction', 'magnitude'] as const) {
        expect(edge.describeMeasuredMovement(fact, format)).toEqual(describeMeasuredMovement(fact, format));
      }
      const serverClaim = edge.createMovementClaim(fact);
      expect(edge.validateMovementPhrase(serverClaim, 'Your thyroid health has worsened.')).toBeNull();
      expect(validateMovementPhrase(serverClaim, describeMeasuredMovement(fact).text)).toBeNull();
    }
  });

  it('the actual renderer rejects strengthened text and forged claim provenance', () => {
    const language = describeMeasuredMovement(measurement);
    for (const tampered of [
      { ...language, text: 'Your thyroid health has worsened.' },
      { ...language, claim: { ...language.claim } },
    ]) {
      expect(renderToStaticMarkup(<ClinicalObservation language={tampered} />)).toBe('');
    }
    expect(renderToStaticMarkup(<ClinicalObservation language={language} />)).toContain('data-language-claim="measured_movement"');
    const relabelled = { ...language, cue: 'attention' as const, authority: { kind: 'personal_history' as const, subject: 'other' } };
    const html = renderToStaticMarkup(<ClinicalObservation language={relabelled} />);
    expect(html).toContain('data-language-cue="neutral"');
    expect(html).toContain('data-language-source="lab_data"');
    expect(html).not.toContain('personal_history');
  });

  it('nonfinite measurements cannot issue a fact claim', () => {
    expect(() => createMovementClaim({ ...measurement, currentValue: NaN })).toThrow(/finite/);
    expect(() => createMovementClaim({ ...measurement, previousValue: Infinity })).toThrow(/finite/);
  });
});
