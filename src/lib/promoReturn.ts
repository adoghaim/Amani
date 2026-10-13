/*
  The checkout return page's half of A5 (PK-FIX-03). When Stripe refused her
  saved code at session creation, stripe-checkout created the session without
  it and added promo=not_applied to the success URL. The parameter name and
  value mirror supabase/functions/_shared/checkout-promotion.ts.
*/

export const PROMO_STATUS_PARAM = 'promo';
export const PROMO_NOT_APPLIED = 'not_applied';

/** New copy for Adell to confirm. States the fact; promises nothing. */
export const PROMO_NOT_APPLIED_COPY =
  "Your saved code couldn't be applied at checkout.";

export function promoNotApplied(params: Pick<URLSearchParams, 'get'>): boolean {
  return params.get(PROMO_STATUS_PARAM) === PROMO_NOT_APPLIED;
}
