import React, { useEffect, useState } from 'react';
import { Crown, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';

interface SubscriptionData {
  subscription_status: string;
  price_id: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
}

export const SubscriptionStatus: React.FC = () => {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const { data, error } = await supabase
          .from('stripe_user_subscriptions')
          .select('*')
          .single();

        if (!error && data) {
          setSubscription(data);
        }
      } catch (error) {
        console.error('Error fetching subscription:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSubscription();
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="animate-pulse flex space-x-4">
          <div className="rounded-full bg-gray-200 h-10 w-10"></div>
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!subscription || subscription.subscription_status === 'canceled') {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-center">
          <AlertCircle className="h-5 w-5 text-yellow-600 mr-3" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-yellow-800">No Active Subscription</h3>
            <p className="text-sm text-yellow-700 mt-1">
              Subscribe to unlock all features and get personalized insights.
            </p>
          </div>
          <Link
            to="/app/pricing"
            className="ml-4 bg-yellow-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-yellow-700 transition-colors"
          >
            View pricing
          </Link>
        </div>
      </div>
    );
  }

  const planName = subscription.price_id?.includes('yearly') ? 'Amani Yearly' : 'Amani Monthly';
  const isActive = subscription.subscription_status === 'active';
  const nextBilling = subscription.current_period_end 
    ? new Date(subscription.current_period_end * 1000).toLocaleDateString()
    : null;

  return (
    <div className={`rounded-lg border p-4 ${
      isActive ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
    }`}>
      <div className="flex items-center">
        <Crown className={`h-5 w-5 mr-3 ${
          isActive ? 'text-green-600' : 'text-gray-400'
        }`} />
        <div className="flex-1">
          <h3 className={`text-sm font-medium ${
            isActive ? 'text-green-800' : 'text-gray-800'
          }`}>
            {planName}
          </h3>
          <div className="text-sm mt-1">
            <span className={`capitalize ${
              isActive ? 'text-green-700' : 'text-gray-600'
            }`}>
              {subscription.subscription_status}
            </span>
            {nextBilling && (
              <span className={isActive ? 'text-green-700' : 'text-gray-600'}>
                {subscription.cancel_at_period_end 
                  ? ` • Expires ${nextBilling}`
                  : ` • Renews ${nextBilling}`
                }
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};