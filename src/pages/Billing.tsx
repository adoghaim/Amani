import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription, sourceHasManageablePurchase } from '../hooks/useSubscription';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Calendar, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { isNative, openExternalUrl } from '../lib/native';
import { initIap, restoreIapPurchases, storeSubscriptionsUrl, syncIapEntitlement } from '../lib/iap';
import { clientFreemiumActive } from '../lib/tier';
import { FREEMIUM_COPY } from '../lib/freemium/copy';
import { ComplimentaryCounter } from '../components/freemium/ComplimentaryCounter';
import { PremiumPaywall } from '../components/freemium/PremiumPaywall';

export function Billing() {
  const { user, userProfile } = useAuth();
  const {
    subscription,
    activeIap,
    source,
    loading: subLoading,
    isActive,
    refetch,
    plan,
    complimentary: complimentaryUsage,
    error: subError,
  } = useSubscription();
  /*
    Flag on: no trial and no countdown. The plan is Free or Premium, Free shows
    the complimentary counter, and subscribing opens the paywall in place.
  */
  const freemium = clientFreemiumActive();
  const [paywallOpen, setPaywallOpen] = useState(false);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  const active = isActive();
  /*
    Full access with no purchase behind it. They must not be shown trial
    countdowns or upgrade prompts, and must not be offered to "manage" a
    subscription they never bought — there is no Stripe customer and no store
    row to send them to.
  */
  const complimentary = !sourceHasManageablePurchase(source) && active;

  /*
    Which storefront the entitlement came from, when it came from a native one.
    Everything below branches on this: neither Apple nor Google lets an app
    cancel or change a subscription on the user's behalf, so "manage" means
    sending them to the system settings screen rather than to Stripe's portal.
    `activeIap` is the row that actually entitles, picked by the hook — an
    account with both a lapsed and a live row for one store would otherwise
    render whichever came back first, wrong plan and wrong renewal date.
  */
  const nativeSource = source === 'ios' || source === 'android' ? source : null;

  const getTrialDaysRemaining = () => {
    if (!userProfile || !userProfile.trial_start_date) return 0;
    const trialStart = new Date(userProfile.trial_start_date);
    const now = new Date();
    const daysSinceStart = Math.floor((now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, 7 - daysSinceStart);
  };

  // "1 day", never "1 days" (PK-FIX-02).
  const dayCount = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`;

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

  const formatIsoDate = (iso: string | null) => {
    if (!iso) return null;
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const manageLabel = () => {
    if (complimentary) return 'Complimentary access';
    if (!active) return freemium ? FREEMIUM_COPY.plan.upgrade : 'Subscribe Now';
    if (source === 'ios') return 'Manage in the App Store';
    if (source === 'android') return 'Manage in Google Play';
    return 'Manage via Stripe';
  };

  const handleManageSubscription = async () => {
    // Defence in depth: the button is not rendered for complimentary access,
    // but nothing here should ever try to manage a purchase that doesn't exist.
    if (complimentary) return;

    if (!active) {
      if (freemium) {
        setPaywallOpen(true);
        return;
      }
      navigate('/app/pricing');
      return;
    }

    /*
      Store subscriptions are managed by the store, full stop. Apple and Google
      both own cancellation, plan changes and payment method for anything bought
      through IAP, and there is no API that lets the app do it — so the correct
      behaviour is a deep link to the right settings screen.
    */
    if (nativeSource) {
      await openExternalUrl(storeSubscriptionsUrl(nativeSource, activeIap?.product_id ?? null));
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

  /*
    Apple requires a restore control to be reachable, and the paywall is not the
    only place a user looks for it — someone who reinstalled the app lands on
    this screen, sees "Subscribe Now" for something they already pay for, and
    needs a way out that is not buying it twice.
  */
  const handleRestore = async () => {
    setRestoring(true);
    setRestoreMessage(null);
    setError(null);

    /*
      The SDK rejects every call until it has an API key and an app user id, and
      a user who lands here straight from the app launcher has never opened the
      paywall that would otherwise have configured it.
    */
    if (user) {
      const init = await initIap(user.id);
      if (!init.ok) {
        setError(
          init.reason === 'unavailable'
            ? 'In-app purchases aren’t available on this device.'
            : init.error ?? 'Could not reach the store',
        );
        setRestoring(false);
        return;
      }
    }

    const restored = await restoreIapPurchases();
    if (!restored.ok) {
      setError(restored.error);
      setRestoring(false);
      return;
    }

    if (restored.activeProductIds.length === 0) {
      setRestoreMessage('No previous subscription was found for this store account.');
      setRestoring(false);
      return;
    }

    const sync = await syncIapEntitlement();
    if (!sync.ok) {
      setError(sync.error);
      setRestoring(false);
      return;
    }

    await refetch();
    setRestoring(false);
    setRestoreMessage(
      sync.entitled
        ? 'Your subscription has been restored.'
        : 'That subscription is no longer active.',
    );
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

  const renewalDate = nativeSource
    ? formatIsoDate(activeIap?.expires_at ?? null)
    : formatPeriodEnd(subscription?.current_period_end ?? null);

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <PageHeader title="Billing" description="Your plan, payment method and invoices." />

        <div className="space-y-6">
          <Card>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-theme-primary/10 rounded-full flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-theme-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl text-theme-text mb-2">
                  Current Plan
                </h2>
                {complimentary ? (
                  <div className="space-y-2">
                    <p className="text-theme-text flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-theme-success" />
                      <span className="font-medium">Complimentary access</span>
                    </p>
                    <p className="text-theme-text">
                      Every Amani feature is unlocked on this account.
                    </p>
                    <p className="text-theme-muted-text text-sm">
                      There is no subscription or payment attached, and nothing expires.
                    </p>
                  </div>
                ) : active ? (
                  <div className="space-y-2">
                    {freemium && <p className="text-theme-text font-medium">{FREEMIUM_COPY.plan.premium}</p>}
                    <p className="text-theme-text flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-theme-success" />
                      <span className="font-medium">Active subscription</span>
                    </p>
                    <p className="text-theme-text">
                      {source === 'ios'
                        ? 'Billed through the App Store'
                        : source === 'android'
                          ? 'Billed through Google Play'
                          : 'Active plan'}
                    </p>
                    {renewalDate && (
                      <p className="text-theme-muted-text text-sm">
                        {!nativeSource && subscription?.cancel_at_period_end
                          ? `Cancels on ${renewalDate}`
                          : `Renews on ${renewalDate}`}
                      </p>
                    )}
                  </div>
                ) : freemium ? (
                  // Never show Free for a read we could not complete.
                  subError || plan !== 'free' ? (
                    <div className="space-y-3">
                      <p className="text-theme-text">{FREEMIUM_COPY.plan.loadError}</p>
                      <Button variant="secondary" size="sm" onClick={() => { void refetch(); }}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {FREEMIUM_COPY.report.retry}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-theme-text font-medium">{FREEMIUM_COPY.plan.free}</p>
                      <p className="text-theme-muted-text">{FREEMIUM_COPY.plan.freeSummary}</p>
                      <ComplimentaryCounter used={complimentaryUsage.used} />
                    </div>
                  )
                ) : userProfile.subscription_status === 'trial' ? (
                  <div className="space-y-2">
                    <p className="text-theme-text">
                      <span className="font-medium">Status:</span> Free Trial
                    </p>
                    <p className="text-theme-text">
                      <span className="font-medium">Days Remaining:</span> {dayCount(getTrialDaysRemaining())}
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
            <h2 className="text-xl text-theme-text mb-4">
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
            <h2 className="text-xl text-theme-text mb-4">
              Manage Subscription
            </h2>
            <p className="text-theme-muted-text mb-4">
              {nativeSource
                ? `Your subscription is billed by ${source === 'ios' ? 'Apple' : 'Google'}. Change your plan, update payment, or cancel in your store account settings.`
                : active
                  ? 'Update your payment method, view billing history, or cancel your subscription.'
                  : freemium
                    ? FREEMIUM_COPY.plan.manageFreeBody
                    : 'Subscribe to unlock full access to all features.'}
            </p>
            {error && (
              <div className="flex items-start gap-3 p-4 mb-4 bg-theme-flag-low-bg border border-theme-flag-low-border rounded-lg">
                <AlertCircle className="w-5 h-5 text-theme-flag-low mt-0.5 flex-shrink-0" />
                <p className="text-sm text-theme-flag-low">{error}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {/*
                No manage button for complimentary access. There is no Stripe
                customer and no store row behind it, so every destination this
                button has — the portal, the App Store, Google Play — would
                either error or show an unrelated account.
              */}
              {/* Flag on, an unresolved plan is a retry above, never an upgrade offer. */}
              {!complimentary && !(freemium && !active && (subError || plan !== 'free')) && (
                <Button onClick={handleManageSubscription} disabled={loading}>
                  <Calendar className="w-5 h-5 mr-2" />
                  {loading ? 'Loading...' : manageLabel()}
                </Button>
              )}

              {isNative() && !complimentary && (
                <Button variant="outline" onClick={handleRestore} loading={restoring}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Restore Purchases
                </Button>
              )}
            </div>
            {restoreMessage && (
              <p className="mt-3 text-sm text-theme-muted-text">{restoreMessage}</p>
            )}
          </Card>

          {!freemium && !active && userProfile.subscription_status === 'trial' && getTrialDaysRemaining() > 0 && (
            <Card className="bg-theme-surface-2 border-theme-border">
              <h3 className="text-theme-text mb-2">
                Your trial is active
              </h3>
              <p className="text-theme-text">
                You have {dayCount(getTrialDaysRemaining())} remaining in your free trial.
                After your trial ends, a subscription is required to continue using Amani.
              </p>
            </Card>
          )}
        </div>
      </div>
      {freemium && (
        <PremiumPaywall
          open={paywallOpen}
          onClose={() => setPaywallOpen(false)}
          onEntitled={() => { void refetch(); }}
        />
      )}
    </Layout>
  );
}
