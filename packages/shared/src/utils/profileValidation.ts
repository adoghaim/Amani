export const AGE_RANGE_OPTIONS = ['18-24', '25-34', '35-44', '45-54', '55+'] as const;

export type AgeRangeOption = (typeof AGE_RANGE_OPTIONS)[number];

export const DEFAULT_CYCLE_LENGTH = 28;
export const DEFAULT_PERIOD_LENGTH = 5;

export const CYCLE_LENGTH_RANGE = {
  min: 21,
  max: 40,
} as const;

export const PERIOD_LENGTH_RANGE = {
  min: 2,
  max: 10,
} as const;

export interface OnboardingValidationInput {
  ageRange: string | null | undefined;
  cycleLength: number;
  periodLength: number;
}

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

export function isValidAgeRange(value: string | null | undefined): value is AgeRangeOption {
  return AGE_RANGE_OPTIONS.includes(value as AgeRangeOption);
}

export function validateOnboardingProfile({
  ageRange,
  cycleLength,
  periodLength,
}: OnboardingValidationInput): ValidationResult {
  if (!isValidAgeRange(ageRange)) {
    return {
      valid: false,
      error: 'Choose your age range to continue.',
    };
  }

  if (
    !Number.isInteger(cycleLength) ||
    cycleLength < CYCLE_LENGTH_RANGE.min ||
    cycleLength > CYCLE_LENGTH_RANGE.max
  ) {
    return {
      valid: false,
      error: `Enter a typical cycle length between ${CYCLE_LENGTH_RANGE.min} and ${CYCLE_LENGTH_RANGE.max} days.`,
    };
  }

  if (
    !Number.isInteger(periodLength) ||
    periodLength < PERIOD_LENGTH_RANGE.min ||
    periodLength > PERIOD_LENGTH_RANGE.max
  ) {
    return {
      valid: false,
      error: `Enter a typical period length between ${PERIOD_LENGTH_RANGE.min} and ${PERIOD_LENGTH_RANGE.max} days.`,
    };
  }

  return {
    valid: true,
    error: null,
  };
}
