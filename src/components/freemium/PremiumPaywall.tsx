import { Modal } from '../Modal';
import { PricingCard } from '../pricing/PricingCard';
import { IapPaywall } from '../pricing/IapPaywall';
import { WebBillingPaywall } from '../pricing/WebBillingPaywall';
import { isRcWebEnabled } from '../../lib/rcWeb';
import { stripeProducts } from '../../stripe-config';
import { isNative } from '../../lib/native';
import { FREEMIUM_COPY } from '../../lib/freemium/copy';

interface PremiumPaywallProps {
  open: boolean;
  onClose: () => void;
  /** Native only: a purchase or restore was verified server-side. */
  onEntitled?: () => void;
  /** Optional context line above the plans, e.g. why this surface is Premium. */
  reason?: string;
}

/**
 * The in-context paywall (flag on). Opened from locked cards, the upgrade
 * banner on a Basic report, Billing, and a Premium-only 402 — never from
 * upload completion and never from an error.
 *
 * It sells through exactly what PricingPage does: the native store paywall on
 * iOS/Android (Guideline 3.1.1, mechanics unchanged) and Stripe Checkout on the
 * web.
 */
export function PremiumPaywall({ open, onClose, onEntitled, reason }: PremiumPaywallProps) {
  const yearly = stripeProducts.find(p => p.interval === 'year');
  const monthly = stripeProducts.find(p => p.interval === 'month');
  const ordered = [yearly, monthly].filter(Boolean) as typeof stripeProducts;

  return (
    <Modal open={open} onClose={onClose} title={FREEMIUM_COPY.paywall.title}>
      <div className="space-y-5">
        {reason && <p className="text-sm font-medium text-theme-text">{reason}</p>}
        <p className="text-sm text-theme-muted-text-2">{FREEMIUM_COPY.paywall.intro}</p>
        {isNative() ? (
          <IapPaywall onEntitled={() => { onClose(); onEntitled?.(); }} />
        ) : isRcWebEnabled() ? (
          <WebBillingPaywall onEntitled={() => { onClose(); onEntitled?.(); }} />
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {ordered.map((product, index) => (
              <PricingCard key={product.id} product={product} isPopular={index === 0} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
