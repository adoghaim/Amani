import React, { useEffect, useState } from 'react';
import { CheckCircle, ArrowRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export const Success: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [subscriptionData, setSubscriptionData] = useState<any>(null);

  useEffect(() => {
    const fetchSubscriptionData = async () => {
      try {
        const { data, error } = await supabase
          .from('stripe_user_subscriptions')
          .select('*')
          .single();

        if (!error && data) {
          setSubscriptionData(data);
        }
      } catch (error) {
        console.error('Error fetching subscription:', error);
      } finally {
        setLoading(false);
      }
    };

    // Add a small delay to allow webhook processing
    const timer = setTimeout(fetchSubscriptionData, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-6">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Payment Successful!
          </h1>
          
          <p className="text-gray-600 mb-8">
            Thank you for subscribing to Amani. Your account has been activated and you now have full access to all features.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
              <span className="ml-2 text-gray-600">Setting up your account...</span>
            </div>
          ) : subscriptionData ? (
            <div className="bg-white rounded-lg p-6 border border-gray-200 mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Subscription Details</h3>
              <div className="text-sm text-gray-600 space-y-1">
                <p><span className="font-medium">Plan:</span> {subscriptionData.price_id?.includes('yearly') ? 'Amani Yearly' : 'Amani Monthly'}</p>
                <p><span className="font-medium">Status:</span> <span className="capitalize text-green-600">{subscriptionData.subscription_status}</span></p>
                {subscriptionData.current_period_end && (
                  <p><span className="font-medium">Next billing:</span> {new Date(subscriptionData.current_period_end * 1000).toLocaleDateString()}</p>
                )}
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            <Link
              to="/dashboard"
              className="w-full flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 transition-colors duration-200"
            >
              Go to Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            
            <Link
              to="/upload"
              className="w-full flex items-center justify-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-200"
            >
              Upload Your First Lab Report
            </Link>
          </div>

          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">
              Need help? <a href="mailto:support@amani.health" className="text-indigo-600 hover:text-indigo-500">Contact our support team</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};