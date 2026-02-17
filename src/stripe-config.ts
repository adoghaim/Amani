export interface StripeProduct {
  id: string;
  priceId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  mode: 'subscription' | 'payment';
}

export const stripeProducts: StripeProduct[] = [
  {
    id: 'prod_TzWOKu75bqEM0F',
    priceId: 'price_1T1XLT0qFZxXyzLU9mGfg7Ba',
    name: 'Amani Yearly',
    description: 'Full access to Amani with yearly billing',
    price: 79.99,
    currency: 'usd',
    mode: 'subscription'
  },
  {
    id: 'prod_TzWNgMx4Mw4VNa',
    priceId: 'price_1T1XKd0qFZxXyzLUfmtmpqxx',
    name: 'Amani Monthly',
    description: 'Full access to Amani with monthly billing',
    price: 9.99,
    currency: 'usd',
    mode: 'subscription'
  }
];

export const getProductByPriceId = (priceId: string): StripeProduct | undefined => {
  return stripeProducts.find(product => product.priceId === priceId);
};

export const formatPrice = (price: number, currency: string): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(price);
};