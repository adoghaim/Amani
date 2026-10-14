/**
 * The launch consent policy, client side (PK-CONSENT-01; owner decision D7.1).
 *
 * A MIRROR of supabase/functions/_shared/consent.ts, following the convention
 * of src/lib/tier.ts: the constants and `missingConsents` must agree with the
 * server's, and consentPolicy.test.ts fails when they do not. The server (the
 * edge functions and the lab_reports trigger) is the boundary; this copy only
 * decides what the app shows.
 */

export const CONSENT_TYPES = ['age_18_plus', 'health_data', 'ai_processing'] as const;
export type ConsentType = typeof CONSENT_TYPES[number];

/** The copy version a grant carries. DRAFT until the lawyer approves the copy (D7.1). */
export const CURRENT_CONSENT_VERSION = 'draft-1';

/** features.<name> in app_public_config, read through src/lib/runtimeConfig.ts (D5). */
export const CONSENT_GATE_FLAG = 'consent_gate';

/**
 * What a withdrawal in Settings withdraws: processing. The 18+ attestation is
 * a statement of fact, not a permission, so it stays on record.
 */
export const WITHDRAWN_TYPES: readonly ConsentType[] = ['health_data', 'ai_processing'];

/** Her latest answer for one consent type, as consent_current returns it. */
export interface ConsentAnswer {
  readonly consent_type: string;
  readonly version: string;
  readonly granted: boolean;
}

/**
 * The consent types she has not currently granted, in CONSENT_TYPES order: no
 * answer, a withdrawal, or a grant at another version. Throws on a reply that
 * is not a list, so a malformed read fails closed.
 */
export function missingConsents(answers: unknown): ConsentType[] {
  if (!Array.isArray(answers)) throw new Error('consent: expected a list of answers');
  const current = new Set<string>();
  for (const answer of answers as unknown[]) {
    if (typeof answer !== 'object' || answer === null) continue;
    const { consent_type, version, granted } = answer as Partial<ConsentAnswer>;
    if (granted === true && version === CURRENT_CONSENT_VERSION && typeof consent_type === 'string') {
      current.add(consent_type);
    }
  }
  return CONSENT_TYPES.filter(type => !current.has(type));
}
