import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { CreditCard, Calendar, CheckCircle } from 'lucide-react';
import { useState } from 'react';

export function Billing() {
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(false);

  const getTrialDaysRemaining = () => {
    if (!userProfile) return 0;
    const trialStart = new Date(userProfile.trial_start_date);
    const now = new Date();
    const daysSinceStart = Math.floor((now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, 30 - daysSinceStart);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    date.setDate(date.getDate() + 30);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleManageSubscription = async () => {
    try {
      setLoading(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const functionName = userProfile?.subscription_status === 'active'
        ? 'create-portal-session'
        : 'create-checkout-session';

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create session');
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Error:', error);
      alert(`Failed to manage subscription: ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  if (!userProfile) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-theme-muted-text">Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-theme-text mb-8">
          Billing & Subscription
        </h1>

        <div className="space-y-6">
          <Card>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-theme-primary/10 rounded-full flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-theme-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-theme-text mb-2">
                  Current Plan
                </h2>
                {userProfile.subscription_status === 'trial' && (
                  <div className="space-y-2">
                    <p className="text-theme-text">
                      <span className="font-medium">Status:</span> Free Trial
                    </p>
                    <p className="text-theme-text">
                      <span className="font-medium">Days Remaining:</span> {getTrialDaysRemaining()} days
                    </p>
                    <p className="text-theme-text">
                      <span className="font-medium">Trial Ends:</span> {formatDate(userProfile.trial_start_date)}
                    </p>
                  </div>
                )}
                {userProfile.subscription_status === 'active' && (
                  <div className="space-y-2">
                    <p className="text-theme-text flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-theme-success" />
                      <span className="font-medium">Active Subscription</span>
                    </p>
                    <p className="text-theme-text">
                      $24/month
                    </p>
                  </div>
                )}
                {userProfile.subscription_status === 'expired' && (
                  <div className="space-y-2">
                    <p className="text-theme-text">
                      <span className="font-medium">Status:</span> Expired
                    </p>
                    <p className="text-theme-muted-text">
                      Reactivate your subscription to create new lab reports.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold text-theme-text mb-4">
              Plan Details
            </h2>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-theme-primary" />
                <span className="text-theme-text">Unlimited lab report uploads</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-theme-primary" />
                <span className="text-theme-text">AI-powered educational explanations</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-theme-primary" />
                <span className="text-theme-text">Cycle-aware context</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-theme-primary" />
                <span className="text-theme-text">Questions to ask your doctor</span>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold text-theme-text mb-4">
              Manage Subscription
            </h2>
            <p className="text-theme-muted-text mb-4">
              Update your payment method, view billing history, or cancel your subscription.
            </p>
            <Button onClick={handleManageSubscription} disabled={loading}>
              <Calendar className="w-5 h-5 mr-2" />
              {loading ? 'Loading...' : userProfile?.subscription_status === 'active' ? 'Manage via Stripe' : 'Subscribe Now'}
            </Button>
          </Card>

          {userProfile.subscription_status === 'trial' && getTrialDaysRemaining() > 0 && (
            <Card className="bg-theme-surface-2 border-theme-border">
              <h3 className="font-semibold text-theme-text mb-2">
                Your trial is active
              </h3>
              <p className="text-theme-text">
                You have {getTrialDaysRemaining()} days remaining in your free trial.
                After your trial ends, you'll be charged $24/month to continue using Amani.
              </p>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}
