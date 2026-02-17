import React, { useEffect, useState } from 'react';
import { Crown, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getProductByPriceId } from '../stripe-config';

export function SubscriptionStatus() {
  const { user } = useAuth();
  const [subscriptionData, setSubscriptionData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubscriptionData = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from('stripe_user_subscriptions')
          .select('*')
          .single();

        if (!error && data) {
          setSubscriptionData(data);
        }
      } catch (error) {
        console.error('Error fetching subscription data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSubscriptionData();
  }, [user]);

  if (loading || !subscriptionData) {
    return null;
  }

  const product = getProductByPriceId(subscriptionData.price_id);
  const isActive = subscriptionData.subscription_status === 'active';

  return (
    <div className={`rounded-lg p-4 ${isActive ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
      <div className="flex items-center">
        {isActive ? (
          <Crown className="h-5 w-5 text-green-600 mr-2" />
        ) : (
          <AlertCircle className="h-5 w-5 text-yellow-600 mr-2" />
        )}
        <div className="flex-1">
          <p className={`text-sm font-medium ${isActive ? 'text-green-800' : 'text-yellow-800'}`}>
            {product?.name || 'Subscription'} - {subscriptionData.subscription_status}
          </p>
          {subscriptionData.current_period_end && (
            <p className={`text-xs ${isActive ? 'text-green-600' : 'text-yellow-600'}`}>
              {subscriptionData.cancel_at_period_end ? 'Cancels' : 'Renews'} on{' '}
              {new Date(subscriptionData.current_period_end * 1000).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}