import { useState } from 'react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Trash2, AlertTriangle } from 'lucide-react';

export function Settings() {
  const { user, userProfile } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setError('Please type DELETE to confirm');
      return;
    }

    setDeleting(true);
    setError('');

    try {
      if (user) {
        const { data: reports } = await supabase
          .from('lab_reports')
          .select('file_url')
          .eq('user_id', user.id);

        if (reports) {
          for (const report of reports) {
            if (report.file_url) {
              const fileName = report.file_url.split('/').pop();
              if (fileName) {
                await supabase.storage
                  .from('lab-files')
                  .remove([`${user.id}/${fileName}`]);
              }
            }
          }
        }

        await supabase
          .from('lab_reports')
          .delete()
          .eq('user_id', user.id);

        await supabase
          .from('users')
          .delete()
          .eq('id', user.id);

        await supabase.auth.signOut();
        window.location.href = '/';
      }
    } catch (err) {
      setError('Failed to delete account. Please try again.');
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

          <Card className="border-red-200">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  Delete Account
                </h2>
                <p className="text-gray-600 mb-4">
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
                {!showDeleteConfirm ? (
                  <Button
                    variant="danger"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    Delete My Account
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
                            Deleting your account will:
                          </p>
                          <ul className="text-sm text-red-800 list-disc list-inside mt-2 space-y-1">
                            <li>Permanently delete all your lab reports</li>
                            <li>Remove all uploaded files</li>
                            <li>Delete all biomarker data and interpretations</li>
                            <li>Cancel any active subscriptions</li>
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
                        onClick={handleDeleteAccount}
                        disabled={deleting || deleteConfirmText !== 'DELETE'}
                      >
                        {deleting ? 'Deleting...' : 'Yes, Delete My Account'}
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
