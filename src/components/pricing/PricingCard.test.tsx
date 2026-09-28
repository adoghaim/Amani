import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { STRIPE_PRODUCTS } from '../../stripe-config';
import type { IapStoreProduct } from '../../lib/iap';
import { IAP_PRODUCTS } from '../../lib/iap-config';
import { PricingCard } from './PricingCard';
import { IapPricingCard } from './IapPricingCard';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/native', () => ({ isNative: () => false, openExternalUrl: vi.fn() }));
vi.mock('../../lib/iap', () => ({ purchaseIapProduct: vi.fn(), syncIapEntitlement: vi.fn() }));

describe('pricing without comparison anchors', () => {
  it.each(STRIPE_PRODUCTS)('keeps the real $interval price on Stripe and IAP', product => {
    expect(product.price).toBe(product.interval === 'year' ? 99.99 : 9.99);
    expect(product.beforePrice).toBe(product.price);
    const stripe = renderToStaticMarkup(<PricingCard product={product} isPopular />);
    const iap = renderToStaticMarkup(<IapPricingCard product={{
      productId: IAP_PRODUCTS.find(p => p.interval === product.interval)!.productId,
      title: product.name, description: product.description, price: product.price,
      priceString: `$${product.price}`, currencyCode: 'USD', interval: product.interval,
      rcProduct: {} as IapStoreProduct['rcProduct'],
    }} isPopular onPurchased={() => {}} />);
    for (const html of [stripe, iap]) {
      expect(html).toContain(`$${product.price}`);
      expect(html).toMatch(/Best value/i);
      expect(html).not.toMatch(/line-through|Save |\$199\.99|\$19\.99/);
    }
  });
});
