import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  Shield,
} from 'lucide-react-native';
import { getTrialDaysRemaining } from '@amani/shared';
import { Button, Card, Notice, Text } from '../components';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';

interface SubscriptionRecord {
  customer_id: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  price_id: string | null;
  current_period_start: number | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean | null;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
}

const PLANS = [
  {
    id: 'yearly',
    name: 'Amani Yearly',
    priceLabel: '$99.99 / year',
    priceId: 'price_1T1XLT0qFZxXyzLU9mGfg7Ba',
    highlight: 'Best value',
  },
  {
    id: 'monthly',
    name: 'Amani Monthly',
    priceLabel: '$9.99 / month',
    priceId: 'price_1T1XKd0qFZxXyzLUfmtmpqxx',
    highlight: 'Flexible billing',
  },
] as const;

function formatPeriodEnd(timestamp: number | null) {
  if (!timestamp) {
    return null;
  }

  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function BillingScreen() {
  const navigation = useNavigation<any>();
  const { userProfile } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const isActive = subscription?.subscription_status === 'active';
  const trialDaysRemaining = getTrialDaysRemaining(userProfile);

  const paymentMethodLabel = useMemo(() => {
    if (!subscription?.payment_method_brand || !subscription.payment_method_last4) {
      return null;
    }

    const brand =
      `${subscription.payment_method_brand[0].toUpperCase()}${subscription.payment_method_brand.slice(1)}`;
    return `${brand} ending in ${subscription.payment_method_last4}`;
  }, [subscription]);

  const fetchSubscription = async () => {
    try {
      setLoading(true);
      const { data, error: subscriptionError } = await supabase
        .from('stripe_user_subscriptions')
        .select('*')
        .maybeSingle();

      if (subscriptionError) {
        throw subscriptionError;
      }

      setSubscription((data ?? null) as SubscriptionRecord | null);
      setError('');
    } catch (fetchError) {
      console.error('Failed to fetch subscription:', fetchError);
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load billing details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSubscription();

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void fetchSubscription();
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, []);

  const openCheckout = async (priceId: string) => {
    try {
      setActionLoading(priceId);
      setError('');
      const { data, error: invokeError } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          priceId,
          successUrl: 'amani://billing?status=success',
          cancelUrl: 'amani://billing?status=cancelled',
        },
      });

      if (invokeError) {
        throw invokeError;
      }

      if (!data?.url) {
        throw new Error('Stripe checkout did not return a URL.');
      }

      await Linking.openURL(data.url);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Unable to open checkout.');
    } finally {
      setActionLoading(null);
    }
  };

  const openPortal = async () => {
    try {
      setActionLoading('portal');
      setError('');
      const { data, error: invokeError } = await supabase.functions.invoke('create-portal-session', {
        body: {
          returnUrl: 'amani://billing',
        },
      });

      if (invokeError) {
        throw invokeError;
      }

      if (!data?.url) {
        throw new Error('Stripe portal did not return a URL.');
      }

      await Linking.openURL(data.url);
    } catch (portalError) {
      setError(portalError instanceof Error ? portalError.message : 'Unable to open the billing portal.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text variant="titleSm">Billing</Text>
            <Text variant="caption" tone="muted">
              Stripe-hosted checkout for subscriptions and payment updates.
            </Text>
          </View>
        </View>

        {error ? (
          <Notice tone="error" style={styles.notice}>
            {error}
          </Notice>
        ) : null}

        <Card style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={styles.statusIcon}>
              <CreditCard size={20} color={theme.colors.primary} />
            </View>
            <View style={styles.statusCopy}>
              <Text variant="body" weight="bold">
                {isActive ? 'Active membership' : userProfile?.subscription_status === 'trial' ? 'Free trial' : 'No active membership'}
              </Text>
              <Text variant="bodySm" tone="muted">
                {loading
                  ? 'Refreshing your billing state…'
                  : isActive
                    ? 'Manage card details, renewals, and cancellations in Stripe.'
                    : 'Start a subscription to keep uploading new reports.'}
              </Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : (
            <View style={styles.statusDetails}>
              {trialDaysRemaining != null && !isActive ? (
                <View style={styles.statusLine}>
                  <Text variant="caption" tone="muted">
                    Trial remaining
                  </Text>
                  <Text variant="bodySm" weight="semibold">
                    {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'}
                  </Text>
                </View>
              ) : null}

              {subscription?.current_period_end ? (
                <View style={styles.statusLine}>
                  <Text variant="caption" tone="muted">
                    {subscription.cancel_at_period_end ? 'Ends on' : 'Renews on'}
                  </Text>
                  <Text variant="bodySm" weight="semibold">
                    {formatPeriodEnd(subscription.current_period_end)}
                  </Text>
                </View>
              ) : null}

              {paymentMethodLabel ? (
                <View style={styles.statusLine}>
                  <Text variant="caption" tone="muted">
                    Payment method
                  </Text>
                  <Text variant="bodySm" weight="semibold">
                    {paymentMethodLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          <Button
            label={isActive ? 'Manage in Stripe' : 'Refresh billing status'}
            variant={isActive ? 'primary' : 'outline'}
            onPress={isActive ? openPortal : () => { void fetchSubscription(); }}
            loading={actionLoading === 'portal' || (!isActive && loading)}
            fullWidth
            icon={<ArrowRight />}
            iconPosition="right"
            style={styles.statusAction}
          />
        </Card>

        {!isActive ? (
          <View style={styles.planSection}>
            <Text variant="titleSm">Choose a plan</Text>
            <Text variant="bodySm" tone="muted" style={styles.sectionIntro}>
              The app currently uses Stripe rather than Apple or Google in-app purchases, so checkout opens outside the app.
            </Text>

            {PLANS.map((plan) => (
              <Card key={plan.id} style={styles.planCard}>
                <View style={styles.planHeader}>
                  <View>
                    <Text variant="body" weight="bold">
                      {plan.name}
                    </Text>
                    <Text variant="bodySm" tone="muted">
                      {plan.highlight}
                    </Text>
                  </View>
                  <Text variant="titleSm">{plan.priceLabel}</Text>
                </View>

                <View style={styles.featureList}>
                  <View style={styles.featureRow}>
                    <CheckCircle2 size={16} color={theme.colors.success} />
                    <Text variant="bodySm">Unlimited report uploads</Text>
                  </View>
                  <View style={styles.featureRow}>
                    <CheckCircle2 size={16} color={theme.colors.success} />
                    <Text variant="bodySm">Cycle-aware interpretation</Text>
                  </View>
                  <View style={styles.featureRow}>
                    <CheckCircle2 size={16} color={theme.colors.success} />
                    <Text variant="bodySm">Biomarker trends and report history</Text>
                  </View>
                </View>

                <Button
                  label={`Subscribe to ${plan.name}`}
                  onPress={() => {
                    void openCheckout(plan.priceId);
                  }}
                  loading={actionLoading === plan.priceId}
                  fullWidth
                />
              </Card>
            ))}
          </View>
        ) : null}

        <Card style={styles.securityCard}>
          <View style={styles.securityHeader}>
            <Shield size={18} color={theme.colors.success} />
            <Text variant="body" weight="bold">
              Billing security
            </Text>
          </View>
          <Text variant="bodySm" tone="muted">
            Card entry and subscription changes stay in Stripe-hosted pages. Amani does not store raw card numbers in the app.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
    gap: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  notice: {
    marginTop: -theme.spacing.xs,
  },
  statusCard: {
    gap: theme.spacing.md,
  },
  statusHeader: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  statusIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCopy: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  loadingRow: {
    paddingVertical: theme.spacing.md,
  },
  statusDetails: {
    gap: theme.spacing.sm,
  },
  statusLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  statusAction: {
    marginTop: theme.spacing.xs,
  },
  planSection: {
    gap: theme.spacing.md,
  },
  sectionIntro: {
    marginTop: -theme.spacing.xs,
  },
  planCard: {
    gap: theme.spacing.md,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  featureList: {
    gap: theme.spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  securityCard: {
    gap: theme.spacing.sm,
  },
  securityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
});
