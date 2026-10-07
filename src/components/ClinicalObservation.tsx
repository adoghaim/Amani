import type { ClinicalLanguage } from '../lib/scoring/insightCopy';

/** A neutral observation renderer cannot accept a clinical or safety claim. */
export function ClinicalObservation({ language }: {
  language: Extract<ClinicalLanguage, { category: 'factual_observation' | 'comparison_band' }>;
}) {
  return <span data-language-category={language.category} data-language-source={language.authority.kind}
    data-language-cue={language.cue}>{language.text}</span>;
}
