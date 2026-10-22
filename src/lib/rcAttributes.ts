/**
 * RevenueCat subscriber attributes from the first-touch attribution
 * (firstPartyEvents) and the saved signup promo code. Used by both the native
 * (iap.ts) and web (rcWeb.ts) SDKs so dashboards/webhooks see the same keys.
 *
 * Reserved keys: $mediaSource / $campaign / $adGroup / $keyword / $creative.
 * Custom keys: promo_code, ref_code, utm_* (raw).
 */
import type { Attribution } from './firstPartyEvents';
import { PROMO_CODE_PATTERN } from './savedPromoCode';

export type RcAttributes = Record<string, string>;

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
const RESERVED: Record<(typeof UTM_KEYS)[number], string> = {
  utm_source: '$mediaSource',
  utm_campaign: '$campaign',
  utm_medium: '$adGroup',
  utm_term: '$keyword',
  utm_content: '$creative',
};

export function buildRcAttributes(
  params: Attribution | null | undefined,
  savedPromo: string | null | undefined,
): RcAttributes {
  const out: RcAttributes = {};
  const p = (params ?? {}) as Record<string, string | undefined>;
  for (const k of UTM_KEYS) {
    const v = p[k]?.trim();
    if (v) {
      out[k] = v;
      out[RESERVED[k]] = v;
    }
  }
  const promo = (savedPromo ?? p.promo)?.trim();
  if (promo && PROMO_CODE_PATTERN.test(promo)) out.promo_code = promo;
  const ref = p.ref?.trim();
  if (ref && PROMO_CODE_PATTERN.test(ref)) out.ref_code = ref;
  return out;
}

/** Reads the browser-side sources lazily (keeps buildRcAttributes pure). */
export async function currentRcAttributes(): Promise<RcAttributes> {
  try {
    const [{ firstPartyEvents }, { readSavedPromoCode }] = await Promise.all([
      import('./firstPartyEventsClient'),
      import('./savedPromoCode'),
    ]);
    return buildRcAttributes(firstPartyEvents.readFirstTouch()?.params, readSavedPromoCode());
  } catch {
    return {};
  }
}
