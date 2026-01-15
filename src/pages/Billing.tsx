import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../contexts/AuthContext';
import { CreditCard, Calendar, CheckCircle } from 'lucide-react';

export function Billing() {
  const { userProfile } = useAuth();

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
    alert('Stripe integration is not yet configured. Please add your Stripe keys to enable subscription management.');
  };

  if (!userProfile) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-gray-600">Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Billing & Subscription
        </h1>

        <div className="space-y-6">
          <Card>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-teal-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Current Plan
                </h2>
                {userProfile.subscription_status === 'trial' && (
                  <div className="space-y-2">
                    <p className="text-gray-700">
                      <span className="font-medium">Status:</span> Free Trial
                    </p>
                    <p className="text-gray-700">
                      <span className="font-medium">Days Remaining:</span> {getTrialDaysRemaining()} days
                    </p>
                    <p className="text-gray-700">
                      <span className="font-medium">Trial Ends:</span> {formatDate(userProfile.trial_start_date)}
                    </p>
                  </div>
                )}
                {userProfile.subscription_status === 'active' && (
                  <div className="space-y-2">
                    <p className="text-gray-700 flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="font-medium">Active Subscription</span>
                    </p>
                    <p className="text-gray-700">
                      $24/month
                    </p>
                  </div>
                )}
                {userProfile.subscription_status === 'expired' && (
                  <div className="space-y-2">
                    <p className="text-gray-700">
                      <span className="font-medium">Status:</span> Expired
                    </p>
                    <p className="text-gray-600">
                      Reactivate your subscription to create new lab reports.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Plan Details
            </h2>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-teal-600" />
                <span className="text-gray-700">Unlimited lab report uploads</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-teal-600" />
                <span className="text-gray-700">AI-powered educational explanations</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-teal-600" />
                <span className="text-gray-700">Cycle-aware context</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-teal-600" />
                <span className="text-gray-700">Questions to ask your doctor</span>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Manage Subscription
            </h2>
            <p className="text-gray-600 mb-4">
              Update your payment method, view billing history, or cancel your subscription.
            </p>
            <Button onClick={handleManageSubscription}>
              <Calendar className="w-5 h-5 mr-2" />
              Manage via Stripe
            </Button>
          </Card>

          {userProfile.subscription_status === 'trial' && getTrialDaysRemaining() > 0 && (
            <Card className="bg-teal-50 border-teal-200">
              <h3 className="font-semibold text-gray-900 mb-2">
                Your trial is active
              </h3>
              <p className="text-gray-700">
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
