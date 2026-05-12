import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../hooks/useSubscription';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Calendar, CheckCircle, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { openExternalUrl } from '../lib/native';

export function Billing() {
  const { userProfile } = useAuth();
  const { subscription, loading: subLoading } = useSubscription();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = subscription?.subscription_status === 'active';

  const getTrialDaysRemaining = () => {
    if (!userProfile || !userProfile.trial_start_date) return 0;
    const trialStart = new Date(userProfile.trial_start_date);
    const now = new Date();
    const daysSinceStart = Math.floor((now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, 7 - daysSinceStart);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    date.setDate(date.getDate() + 7);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatPeriodEnd = (timestamp: number | null) => {
    if (!timestamp) return null;
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleManageSubscription = async () => {
    if (!isActive) {
      navigate('/app/pricing');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-portal-session`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        const msg = data.detail || data.error || `HTTP ${response.status}`;
        throw new Error(msg);
      }

      if (data.url) {
        await openExternalUrl(data.url);
      }
    } catch (error) {
      const msg = errorMessage(error);
      console.error('Billing error:', msg);
      setError(`Failed to open billing portal: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  if (!userProfile || subLoading) {
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
                {isActive ? (
                  <div className="space-y-2">
                    <p className="text-theme-text flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-theme-success" />
                      <span className="font-medium">Active Subscription</span>
                    </p>
                    <p className="text-theme-text">Active plan</p>
                    {subscription?.current_period_end && (
                      <p className="text-theme-muted-text text-sm">
                        {subscription.cancel_at_period_end
                          ? `Cancels on ${formatPeriodEnd(subscription.current_period_end)}`
                          : `Renews on ${formatPeriodEnd(subscription.current_period_end)}`}
                      </p>
                    )}
                  </div>
                ) : userProfile.subscription_status === 'trial' ? (
                  <div className="space-y-2">
                    <p className="text-theme-text">
                      <span className="font-medium">Status:</span> Free Trial
                    </p>
                    <p className="text-theme-text">
                      <span className="font-medium">Days Remaining:</span> {getTrialDaysRemaining()} days
                    </p>
                    <p className="text-theme-text">
                      <span className="font-medium">Trial Ends:</span> {userProfile.trial_start_date ? formatDate(userProfile.trial_start_date) : '—'}
                    </p>
                  </div>
                ) : (
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
              {isActive
                ? 'Update your payment method, view billing history, or cancel your subscription.'
                : 'Subscribe to unlock full access to all features.'}
            </p>
            {error && (
              <div className="flex items-start gap-3 p-4 mb-4 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            <Button onClick={handleManageSubscription} disabled={loading}>
              <Calendar className="w-5 h-5 mr-2" />
              {loading ? 'Loading...' : isActive ? 'Manage via Stripe' : 'Subscribe Now'}
            </Button>
          </Card>

          {!isActive && userProfile.subscription_status === 'trial' && getTrialDaysRemaining() > 0 && (
            <Card className="bg-theme-surface-2 border-theme-border">
              <h3 className="font-semibold text-theme-text mb-2">
                Your trial is active
              </h3>
              <p className="text-theme-text">
                You have {getTrialDaysRemaining()} days remaining in your free trial.
                After your trial ends, a subscription is required to continue using Amani.
              </p>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}
