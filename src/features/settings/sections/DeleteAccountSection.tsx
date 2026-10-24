import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { supabase } from '../../../lib/supabase';
import { errorMessage } from '../../../lib/errors';
import { Trash2, AlertTriangle } from 'lucide-react';
import { openExternalUrl } from '../../../lib/native';
import { storeSubscriptionsUrl } from '../../../lib/iap';
import { useSubscription } from '../../../hooks/useSubscription';

/** The Stripe statuses delete-user-data cancels (cancelStripeSubscriptions). */
const STRIPE_LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

/**
 * A store subscription the server refused to delete the account around.
 * Shape mirrors the 409 body from `delete-user-data`.
 */
interface StoreSubscriptionWarning {
  platform: 'ios' | 'android';
  product_id: string;
  expires_at: string | null;
}

/*
  The 409 body may say whether the server stops Google Play billing as part of
  the deletion (`play_cancellation_enabled`). Servers that do not send it, which
  is every deployed one today, leave the answer "no": deletion does not cancel.
*/
function cancelledByDeletion(sub: StoreSubscriptionWarning, playCancels: boolean) {
  return sub.platform === 'android' && playCancels;
}

export function DeleteAccountSection() {
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  /*
    Non-null once the server has told us the account has a live App Store / Play
    subscription. Deleting the account does not cancel it — only the customer
    can, in their store settings — so the second confirmation exists to make
    sure nobody deletes their way into paying for an app they can't log into.
  */
  const [storeSubs, setStoreSubs] = useState<StoreSubscriptionWarning[] | null>(null);
  const [playCancels, setPlayCancels] = useState(false);
  /*
    A live web (Stripe) subscription is cancelled on the spot by delete-user-data,
    with no proration or refund — the same statuses it cancels. If the read
    failed and no subscription is known, the deletion still cancels one that
    exists, so the line is said conditionally rather than left out.
  */
  const { subscription, error: subscriptionError } = useSubscription();
  const stripeLive = STRIPE_LIVE_STATUSES.has(subscription?.subscription_status ?? '');
  const stripeUnknown = !subscription && Boolean(subscriptionError);

  const handleDeleteData = async (acknowledgeStoreSubscriptions = false) => {
    if (deleteConfirmText !== 'DELETE') {
      setError('Please type DELETE to confirm');
      return;
    }

    setDeleting(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Session expired. Please log in again.');
        setDeleting(false);
        return;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user-data`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          acknowledge_store_subscriptions: acknowledgeStoreSubscriptions,
        }),
      });

      if (!response.ok) {
        // Backend handles the full teardown (Stripe, storage, tables, auth).
        // Any non-2xx here means the deletion is INCOMPLETE — surface the
        // error so the user can retry rather than pretending it succeeded.
        const data = await response.json().catch(() => ({ error: 'Failed to delete account' }));

        /*
          409 is not a failure — nothing was deleted. The account has a live
          store subscription the server won't silently orphan. Show what it is,
          link to the place it can actually be cancelled, and require a second
          deliberate confirmation.
        */
        if (
          response.status === 409 &&
          data.code === 'store_subscription_acknowledgement_required'
        ) {
          setStoreSubs((data.store_subscriptions ?? []) as StoreSubscriptionWarning[]);
          setPlayCancels(data.play_cancellation_enabled === true);
          setDeleting(false);
          return;
        }

        throw new Error(data.error || 'Failed to delete account');
      }

      // Backend already deleted the users row and the auth identity. Don't
      // re-issue a client-side delete — the RLS/row would be gone and any
      // resulting error would be misleading. Just clear the local session.
      await supabase.auth.signOut();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete data. Please try again.'));
      setDeleting(false);
    }
  };

  const keepsBilling = (storeSubs ?? []).filter((sub) => !cancelledByDeletion(sub, playCancels));
  const cancelledNow = (storeSubs ?? []).filter((sub) => cancelledByDeletion(sub, playCancels));

  return (
    <Card className="border-theme-flag-low-border">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 bg-theme-flag-low-bg rounded-full flex items-center justify-center">
          <Trash2 className="w-6 h-6 text-theme-flag-low" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl text-theme-neutral-900 mb-2">Delete my data</h2>
          <p className="text-theme-neutral-600 mb-4">
            Permanently delete all your health data and account. This action cannot be undone.
          </p>
          {!showDeleteConfirm ? (
            <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete My Data
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-lg p-4">
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-theme-flag-low mt-0.5" />
                  <div>
                    <h3 className="text-theme-flag-low mb-1">
                      Warning: This action is permanent
                    </h3>
                    <p className="text-sm text-theme-flag-low">Deleting your data will:</p>
                    <ul className="text-sm text-theme-flag-low list-disc list-inside mt-2 space-y-1">
                      <li>Permanently delete all your lab reports</li>
                      <li>Remove all uploaded files</li>
                      <li>Delete all biomarker data and interpretations</li>
                      <li>Delete all cycle events and interventions</li>
                      <li>Remove your account and email from our system</li>
                      {stripeLive && (
                        <li>
                          Cancel your web subscription immediately. The rest of the period you
                          have paid for is not refunded.
                        </li>
                      )}
                      {stripeUnknown && (
                        <li>
                          If you have a web subscription, it is cancelled immediately and the rest
                          of the period you have paid for is not refunded.
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>

              {storeSubs && storeSubs.length > 0 && (
                <div className="bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-theme-flag-watch mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <h3 className="font-semibold text-theme-flag-watch mb-1">
                        {keepsBilling.length > 0
                          ? 'Your subscription will keep billing'
                          : 'Your subscription will be cancelled'}
                      </h3>
                      {keepsBilling.length > 0 && (
                        <>
                          <p className="text-sm text-theme-flag-watch">
                            This account has an active subscription billed by{' '}
                            {keepsBilling[0]?.platform === 'ios' ? 'Apple' : 'Google'}.{' '}
                            <strong>Deleting your account does not cancel it.</strong> Only you
                            can cancel it, from your store account settings — and once the
                            account is gone, this app can no longer help you find it.
                          </p>
                          <p className="text-sm text-theme-flag-watch mt-2">
                            Cancel it first, then come back and delete.
                          </p>
                        </>
                      )}
                      {cancelledNow.length > 0 && (
                        <p className={`text-sm text-theme-flag-watch${keepsBilling.length > 0 ? ' mt-2' : ''}`}>
                          This account has an active subscription billed by Google.{' '}
                          <strong>Deleting your account will cancel it right away.</strong> A
                          cancelled Google Play subscription cannot be restored.
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {storeSubs.map((sub) => (
                          <Button
                            key={`${sub.platform}-${sub.product_id}`}
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              openExternalUrl(
                                storeSubscriptionsUrl(sub.platform, sub.product_id),
                              )
                            }
                          >
                            {sub.platform === 'ios'
                              ? 'Manage in the App Store'
                              : 'Manage in Google Play'}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-theme-flag-low-bg border border-theme-flag-low-border text-theme-flag-low px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-theme-neutral-700 mb-2">
                  Type DELETE to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full px-4 py-2 border border-theme-neutral-300 rounded-lg focus:ring-2 focus:ring-theme-flag-low-border focus:border-transparent"
                  placeholder="DELETE"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  variant="danger"
                  // The second press carries the acknowledgement. Derived
                  // from state rather than a checkbox so the warning is
                  // always shown before it can possibly be true.
                  onClick={() => handleDeleteData(storeSubs !== null)}
                  disabled={deleting || deleteConfirmText !== 'DELETE'}
                >
                  {deleting
                    ? 'Deleting...'
                    : storeSubs !== null
                      ? keepsBilling.length > 0
                        ? 'Delete anyway — I’ll cancel my subscription myself'
                        : 'Delete and cancel my subscription'
                      : 'Yes, Delete My Data'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText('');
                    setError('');
                    setStoreSubs(null);
                    setPlayCancels(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
