export interface StripeProduct {
  id: string;
  priceId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  mode: 'payment' | 'subscription';
}

export const stripeProducts: StripeProduct[] = [
  {
    id: 'prod_TzWOKu75bqEM0F',
    priceId: 'price_1T1XLT0qFZxXyzLU9mGfg7Ba',
    name: 'Amani Yearly',
    description: 'Annual subscription with full access to all features',
    price: 79.99,
    currency: 'usd',
    mode: 'subscription'
  },
  {
    id: 'prod_TzWNgMx4Mw4VNa',
    priceId: 'price_1T1XKd0qFZxXyzLUfmtmpqxx',
    name: 'Amani Monthly',
    description: 'Monthly subscription with full access to all features',
    price: 9.99,
    currency: 'usd',
    mode: 'subscription'
  }
];

export function getProductByPriceId(priceId: string): StripeProduct | undefined {
  return stripeProducts.find(product => product.priceId === priceId);
}