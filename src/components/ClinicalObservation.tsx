import {
  validateMovementPhrase, type AuthorizedModelProse, type MovementClaim, type ClinicalLanguage,
} from '../lib/scoring/insightCopy';

/** A neutral observation renderer cannot accept a clinical or safety claim. */
export function ClinicalObservation({ language }: {
  language: Extract<ClinicalLanguage, { category: 'factual_observation' | 'comparison_band' }>;
}) {
  // Movement claims must still validate at the render boundary. Copying a
  // language object and strengthening its sentence cannot retain its grant.
  const movement = 'claim' in language;
  if ('claim' in language) {
    const validated = validateMovementPhrase(language.claim as MovementClaim, language.text);
    if (!validated) return null;
    language = validated;
  }
  return <span data-language-claim={movement ? 'measured_movement' : undefined} data-language-category={language.category} data-language-source={language.authority.kind}
    data-language-cue={language.cue}>{language.text}</span>;
}

/** Owner R1: a model sentence renders only as its validated claim, marked with the field it came from. */
export function ModelProse({ prose }: { prose: AuthorizedModelProse }) {
  return <span data-model-field={prose.field}><ClinicalObservation language={prose.language} /></span>;
}

/** Several validated model sentences as one run of text. */
export function ModelProseText({ items }: { items: readonly AuthorizedModelProse[] }) {
  return <>{items.map((prose, i) => <span key={prose.language.text}>{i > 0 && ' '}<ModelProse prose={prose} /></span>)}</>;
}
