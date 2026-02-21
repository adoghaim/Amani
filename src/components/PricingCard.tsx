import React, { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { StripeProduct, formatPrice } from '../stripe-config';
import { supabase } from '../lib/supabase';

interface PricingCardProps {
  product: StripeProduct;
  isPopular?: boolean;
}

export const PricingCard: React.FC<PricingCardProps> = ({ product, isPopular = false }) => {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    try {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Redirect to login if not authenticated
        window.location.href = '/login';
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId: product.priceId,
          mode: product.mode,
          successUrl: `${window.location.origin}/success`,
          cancelUrl: `${window.location.origin}/pricing`,
        }),
      });

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('Checkout error:', error);
    } finally {
      setLoading(false);
    }
  };

  const features = [
    'Unlimited lab report uploads',
    'AI-powered hormone analysis',
    'Personalized insights',
    'Cycle tracking',
    'Intervention tracking',
    'Export reports',
    'Priority support'
  ];

  const isYearly = product.name.toLowerCase().includes('yearly');
  const monthlyPrice = isYearly ? product.price / 12 : product.price;

  return (
    <div className={`relative bg-white rounded-2xl shadow-lg border-2 transition-all duration-300 hover:shadow-xl ${
      isPopular ? 'border-indigo-500 scale-105' : 'border-gray-200'
    }`}>
      {isPopular && (
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
          <span className="bg-indigo-500 text-white px-4 py-1 rounded-full text-sm font-medium">
            Most Popular
          </span>
        </div>
      )}
      
      <div className="p-8">
        <div className="text-center">
          <h3 className="text-2xl font-bold text-gray-900 mb-2">{product.name}</h3>
          <p className="text-gray-600 mb-6">{product.description}</p>
          
          <div className="mb-6">
            <div className="flex items-baseline justify-center">
              <span className="text-4xl font-bold text-gray-900">
                {formatPrice(monthlyPrice, product.currency)}
              </span>
              <span className="text-gray-600 ml-1">/month</span>
            </div>
            {isYearly && (
              <div className="mt-2">
                <span className="text-lg text-gray-900">
                  {formatPrice(product.price, product.currency)} billed annually
                </span>
                <div className="text-sm text-green-600 font-medium">Save 17%</div>
              </div>
            )}
          </div>

          <button
            onClick={handleCheckout}
            disabled={loading}
            className={`w-full py-3 px-6 rounded-lg font-medium transition-all duration-200 ${
              isPopular
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-gray-900 hover:bg-gray-800 text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Get Started'
            )}
          </button>
        </div>

        <div className="mt-8">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Everything included:</h4>
          <ul className="space-y-3">
            {features.map((feature, index) => (
              <li key={index} className="flex items-center">
                <Check className="w-4 h-4 text-green-500 mr-3 flex-shrink-0" />
                <span className="text-sm text-gray-600">{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};