/*
  What a web plan button says (PK-FIX-03 part 1).

  stripe-checkout starts a paid subscription straight away: it passes no trial
  period, so the card is charged when checkout completes. The button and the
  line under it must say exactly that, whichever way the freemium switch is set.
  Flag off, the old label "Start free trial" was untrue: the 7-day trial is the
  account's in-app trial from signup, not something checkout adds.

  Flag on keeps the owner's existing label (FREEMIUM_COPY.pricing.subscribe).
  The note under the button is new copy for Adell to confirm.
*/

import type { StripeProduct } from '../stripe-config';
import { formatPrice } from '../stripe-config';
import { FREEMIUM_COPY } from './freemium/copy';

export interface PlanCta {
  /** Button label. */
  label: string;
  /** One line under the button saying what checkout does. */
  note: string;
}

export function planCheckoutCta(
  product: Pick<StripeProduct, 'price' | 'currency' | 'interval' | 'mode'>,
  options: { freemium: boolean },
): PlanCta {
  const price = formatPrice(product.price, product.currency);
  const label = options.freemium ? FREEMIUM_COPY.pricing.subscribe : 'Subscribe';
  const note = product.mode === 'subscription'
    ? `${price} is charged when you check out, then every ${product.interval} until you cancel.`
    : `${price} is charged when you check out.`;
  return { label, note };
}
