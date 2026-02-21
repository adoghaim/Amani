export interface StripeProduct {
  id: string;
  priceId: string;
  name: string;
  description: string;
  price: number;
  beforePrice: number;
  currency: string;
  interval: 'month' | 'year';
  mode: 'subscription' | 'payment';
}

export const STRIPE_PRODUCTS: StripeProduct[] = [
  {
    id: 'prod_TzWOKu75bqEM0F',
    priceId: 'price_1T1XLT0qFZxXyzLU9mGfg7Ba',
    name: 'Amani Yearly',
    description: 'Full access to Amani with yearly billing',
    price: 99.99,
    beforePrice: 199.99,
    currency: 'usd',
    interval: 'year',
    mode: 'subscription'
  },
  {
    id: 'prod_TzWNgMx4Mw4VNa',
    priceId: 'price_1T1XKd0qFZxXyzLUfmtmpqxx',
    name: 'Amani Monthly',
    description: 'Full access to Amani with monthly billing',
    price: 9.99,
    beforePrice: 19.99,
    currency: 'usd',
    interval: 'month',
    mode: 'subscription'
  }
];

export const stripeProducts = STRIPE_PRODUCTS;

export const getProductByPriceId = (priceId: string): StripeProduct | undefined => {
  return STRIPE_PRODUCTS.find(p => p.priceId === priceId);
};

export const formatPrice = (price: number, currency: string): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(price);
};