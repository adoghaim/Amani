/*
  Amani is for adults. The Terms say "You must be at least 18 years old to use
  Amani" and the Privacy Policy says it "is not intended for anyone under 18",
  so no picker offers an under-18 age any more.

  Earlier builds did offer 'Under 18', so some stored profiles may still hold
  it. Stored values are NOT migrated: this constant exists only so code that
  reads a stored value can recognise it (onboarding blocks on it; Settings
  shows it as the current answer without offering it again).
*/
export const RETIRED_UNDER_18_AGE_RANGE = 'Under 18';

/** True for the retired under-18 age value, ignoring case and spacing. */
export function isUnder18AgeRange(value: string | null | undefined): boolean {
  return (
    (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase() ===
    RETIRED_UNDER_18_AGE_RANGE.toLowerCase()
  );
}

export const AGE_RANGES = [
  '18–24',
  '25–34',
  '35–44',
  '45–54',
  '55–64',
  '65+',
  'Prefer not to say',
];

export const SEX_OPTIONS = ['Female', 'Male', 'Intersex', 'Prefer not to say'];

export const PREGNANCY_OPTIONS = [
  'None',
  'Pregnant',
  'Postpartum',
  'Breastfeeding',
  'Prefer not to say',
];

export const HEALTH_GOALS = [
  'General lab results',
  'Hormones or fertility',
  'Thyroid health',
  'Iron, fatigue, or energy',
  'Vitamins and nutrients',
  'Inflammation or autoimmune markers',
  'Blood sugar or metabolism',
  "I'm not sure yet",
];
