// BEGIN GENERATED MOVEMENT POLICY
// Dependency-free policy kernel, copied byte-for-byte for Edge packaging.
// Only deterministic application code supplies facts; model output is never a fact input.
export interface MovementLanguage {
  category: 'factual_observation';
  text: string;
  cue: 'neutral';
  authority: { kind: 'lab_data'; subject: string; previous: number | null; current: number; unit: string };
}
export interface MovementClaim {
  readonly category: 'factual_observation';
  readonly fact: Readonly<MeasuredMovement>;
  readonly authority: MovementLanguage['authority'];
  readonly recommendationAuthority: 'none';
  readonly safetyAuthority: 'none';
}

export interface ValidatedMovementLanguage extends MovementLanguage {
  readonly claim: MovementClaim;
}

// Object identity is deliberately local: deserialized/model-authored claims are not grants.
// A server must reconstruct claims from its own persisted facts, not accept client grants.
const movementClaims = new WeakMap<MovementClaim, readonly string[]>();
const MOVEMENT_PLURAL_SUBJECT = /(antibodies|cells|ratios|levels|counts|enzymes|lipids|electrolytes|hormones|platelets|lymphocytes|monocytes|eosinophils|basophils|neutrophils|reticulocytes|triglycerides|globulins)\b/i;

export interface MeasuredMovement {
  displayName: string;
  previousValue: number | null;
  currentValue: number;
  unit: string;
  /** Comes from the existing deterministic magnitude calculation. */
  significance: 'minor' | 'moderate' | 'significant';
}

/** No status or band placement can authorize harm, benefit, or care advice. */
function movementLanguage(
  movement: MeasuredMovement,
  format: 'values' | 'direction' | 'magnitude' = 'values',
): MovementLanguage {
  const { displayName, previousValue, currentValue, unit, significance } = movement;
  let text: string;
  if (previousValue === null) {
    text = `${displayName} was measured at ${currentValue} ${unit}.`;
  } else if (format === 'magnitude') {
    text = significance === 'minor'
      ? `${displayName} has not changed significantly.`
      : currentValue === previousValue ? `${displayName} has the same measured value as before.`
      : `${displayName} has changed since your prior report.`;
  } else if (format === 'direction' && currentValue !== previousValue) {
    const has = MOVEMENT_PLURAL_SUBJECT.test(displayName) ? 'have' : 'has';
    text = `${displayName} ${has} ${currentValue > previousValue ? 'risen' : 'dropped'} from ${previousValue} to ${currentValue} ${unit}.`;
  } else if (significance === 'minor') {
    text = `${displayName} has not changed significantly: ${previousValue} to ${currentValue} ${unit}.`;
  } else {
    // Equality remains factual even if an upstream significance is inconsistent.
    const verb = currentValue > previousValue ? 'increased' : currentValue < previousValue ? 'decreased' : 'remained';
    text = currentValue === previousValue
      ? `${displayName} ${verb} at ${currentValue} ${unit}.`
      : `${displayName} ${verb} from ${previousValue} to ${currentValue} ${unit}.`;
  }
  return {
    category: 'factual_observation', text, cue: 'neutral',
    authority: { kind: 'lab_data', subject: displayName, previous: previousValue, current: currentValue, unit },
  };
}

/** Issue from deterministic measurements only; never call with model-extracted authority. */
export function createMovementClaim(movement: MeasuredMovement): MovementClaim {
  if (!movement.displayName.trim() || !Number.isFinite(movement.currentValue)
    || (movement.previousValue !== null && !Number.isFinite(movement.previousValue))
    || !['minor', 'moderate', 'significant'].includes(movement.significance)) {
    throw new Error('Movement claim requires finite measurements and deterministic significance');
  }
  const fact = Object.freeze({ ...movement });
  const authority = Object.freeze(movementLanguage(fact).authority);
  const claim: MovementClaim = Object.freeze({
    category: 'factual_observation', fact, authority,
    recommendationAuthority: 'none', safetyAuthority: 'none',
  });
  const phrases = ['values', 'direction', 'magnitude'].map(format =>
    movementLanguage(fact, format as 'values' | 'direction' | 'magnitude').text);
  if (fact.previousValue !== null && fact.currentValue !== fact.previousValue) {
    const verb = fact.currentValue > fact.previousValue ? 'increased' : 'decreased';
    phrases.push(`Your ${fact.displayName} ${verb} from your previous result.`);
  }
  movementClaims.set(claim, Object.freeze(phrases));
  return claim;
}

/**
 * Optional model phrasing is a finite semantic selection, not free prose checked
 * with a denylist. Unknown phrasing, forged provenance, added advice or stronger
 * meaning is suppressed. Caller may separately render the canonical observation.
 */
export function validateMovementPhrase(claim: MovementClaim, proposal: unknown): ValidatedMovementLanguage | null {
  const phrases = movementClaims.get(claim);
  if (typeof proposal !== 'string' || !phrases?.includes(proposal)) return null;
  return Object.freeze({ category: 'factual_observation', text: proposal, cue: 'neutral', authority: claim.authority, claim });
}

/** Existing movement surfaces now pass through fact -> claim -> policy -> validator. */
export function describeMeasuredMovement(
  movement: MeasuredMovement,
  format: 'values' | 'direction' | 'magnitude' = 'values',
): ValidatedMovementLanguage {
  const claim = createMovementClaim(movement);
  const language = validateMovementPhrase(claim, movementLanguage(claim.fact, format).text);
  if (!language) throw new Error('Canonical movement phrase failed policy validation');
  return language;
}
// END GENERATED MOVEMENT POLICY
