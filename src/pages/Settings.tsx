import { useState } from 'react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Trash2, AlertTriangle, ShieldCheck, Lock } from 'lucide-react';

export function Settings() {
  const { user, userProfile } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDeleteData = async () => {
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
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete data');
      }

      await supabase.from('users').delete().eq('id', user!.id);
      await supabase.auth.signOut();
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete data. Please try again.');
      setDeleting(false);
    }
  };

  if (!user || !userProfile) {
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
          Settings
        </h1>

        <div className="space-y-6">
          <Card>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Account Information
            </h2>
            <div className="space-y-3">
              <div>
                <span className="text-sm font-medium text-gray-700">Email:</span>
                <p className="text-gray-900">{user.email}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700">Member Since:</span>
                <p className="text-gray-900">
                  {new Date(userProfile.created_at).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700">Subscription Status:</span>
                <p className="text-gray-900 capitalize">{userProfile.subscription_status}</p>
              </div>
            </div>
          </Card>

          <Card className="border-teal-200 bg-teal-50/40">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-teal-700" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">
                  Data Privacy & Security
                </h2>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Your data is protected with account-based access controls and encryption in transit.
                  Only you can access your lab results and health information — no other user or third party
                  can view your data.
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-teal-700 font-medium">
                  <Lock className="w-3.5 h-3.5" />
                  <span>All data is scoped to your account and encrypted in transit</span>
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-red-200">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Delete My Data
                </h2>
                <p className="text-gray-600 mb-4">
                  Permanently delete all your health data and account. This action cannot be undone.
                </p>
                {!showDeleteConfirm ? (
                  <Button
                    variant="danger"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete My Data
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-start gap-2 mb-3">
                        <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
                        <div>
                          <h3 className="font-semibold text-red-900 mb-1">
                            Warning: This action is permanent
                          </h3>
                          <p className="text-sm text-red-800">
                            Deleting your data will:
                          </p>
                          <ul className="text-sm text-red-800 list-disc list-inside mt-2 space-y-1">
                            <li>Permanently delete all your lab reports</li>
                            <li>Remove all uploaded files</li>
                            <li>Delete all biomarker data and interpretations</li>
                            <li>Delete all cycle events and interventions</li>
                            <li>Remove your account and email from our system</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {error && (
                      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                        {error}
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Type DELETE to confirm
                      </label>
                      <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                        placeholder="DELETE"
                      />
                    </div>

                    <div className="flex gap-3">
                      <Button
                        variant="danger"
                        onClick={handleDeleteData}
                        disabled={deleting || deleteConfirmText !== 'DELETE'}
                      >
                        {deleting ? 'Deleting...' : 'Yes, Delete My Data'}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeleteConfirmText('');
                          setError('');
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
        </div>
      </div>
    </Layout>
  );
}
