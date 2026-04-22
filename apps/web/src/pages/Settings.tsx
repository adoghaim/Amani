import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  Trash2,
  AlertTriangle,
  ShieldCheck,
  Lock,
  Bell,
  BellOff,
  Check,
} from 'lucide-react';
import { NotificationPreferences } from '../types';

export function Settings() {
  const { user, userProfile } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);

  useEffect(() => {
    if (user) fetchNotifPrefs();
  }, [user]);

  const fetchNotifPrefs = async () => {
    if (!user) return;
    setNotifLoading(true);
    try {
      const { data } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      setNotifPrefs(data as NotificationPreferences | null);
    } catch (_) {
    } finally {
      setNotifLoading(false);
    }
  };

  const getPrefs = (): NotificationPreferences => {
    if (notifPrefs) return notifPrefs;
    return {
      id: '',
      user_id: user?.id || '',
      period_reminders: true,
      fertile_reminders: true,
      ovulation_reminders: true,
      lab_reminders: true,
      intervention_reminders: true,
      reminder_time: '08:00',
      created_at: '',
      updated_at: '',
    };
  };

  const updatePref = (key: keyof NotificationPreferences, value: boolean | string) => {
    setNotifPrefs((prev) => ({
      ...getPrefs(),
      ...prev,
      [key]: value,
    } as NotificationPreferences));
  };

  const handleSaveNotifPrefs = async () => {
    if (!user) return;
    setNotifSaving(true);
    try {
      const prefs = getPrefs();
      const payload = {
        user_id: user.id,
        period_reminders: prefs.period_reminders,
        fertile_reminders: prefs.fertile_reminders,
        ovulation_reminders: prefs.ovulation_reminders,
        lab_reminders: prefs.lab_reminders,
        intervention_reminders: prefs.intervention_reminders,
        reminder_time: prefs.reminder_time,
        updated_at: new Date().toISOString(),
      };

      if (notifPrefs?.id) {
        await supabase
          .from('notification_preferences')
          .update(payload)
          .eq('id', notifPrefs.id);
      } else {
        const { data } = await supabase
          .from('notification_preferences')
          .insert(payload)
          .select()
          .single();
        if (data) setNotifPrefs(data as NotificationPreferences);
      }

      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 2500);
    } catch (_) {
    } finally {
      setNotifSaving(false);
    }
  };

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

  const prefs = getPrefs();

  const reminders: { key: keyof NotificationPreferences; label: string; description: string }[] = [
    {
      key: 'period_reminders',
      label: 'Period reminder',
      description: 'Get notified when your period is expected soon',
    },
    {
      key: 'fertile_reminders',
      label: 'Fertile window',
      description: 'Know when your fertile window is approaching',
    },
    {
      key: 'ovulation_reminders',
      label: 'Ovulation day',
      description: 'Get notified on your estimated ovulation day',
    },
    {
      key: 'lab_reminders',
      label: 'Lab reminder',
      description: 'Reminder to upload labs when it has been a while',
    },
    {
      key: 'intervention_reminders',
      label: 'Intervention check-in',
      description: 'Follow up on ongoing interventions',
    },
  ];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

        <div className="space-y-6">
          <Card>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Account Information</h2>
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

          <Card>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#F6ECEB] rounded-full flex items-center justify-center">
                  <Bell className="w-4 h-4 text-[#C97C8B]" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Reminder Preferences</h2>
                  <p className="text-xs text-[#6B5B60]">
                    In-app notifications. Mobile push support coming soon.
                  </p>
                </div>
              </div>
            </div>

            {notifLoading ? (
              <div className="text-sm text-[#6B5B60] py-2">Loading preferences...</div>
            ) : (
              <div className="space-y-4">
                {reminders.map(({ key, label, description }) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#2A1F23]">{label}</p>
                      <p className="text-xs text-[#6B5B60]">{description}</p>
                    </div>
                    <button
                      onClick={() => updatePref(key, !(prefs[key] as boolean))}
                      className={`shrink-0 w-11 h-6 rounded-full transition-colors duration-200 relative ${
                        prefs[key] ? 'bg-[#C97C8B]' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                          prefs[key] ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                ))}

                <div className="pt-2 border-t border-[#E9D6DA]">
                  <label className="block text-xs font-medium text-[#6B5B60] mb-2">
                    Preferred reminder time
                  </label>
                  <input
                    type="time"
                    value={prefs.reminder_time || '08:00'}
                    onChange={(e) => updatePref('reminder_time', e.target.value)}
                    className="px-3 py-2 text-sm border border-[#E9D6DA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C97C8B]/30 focus:border-[#C97C8B] text-[#2A1F23]"
                  />
                </div>

                <div className="pt-2 flex items-center gap-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSaveNotifPrefs}
                    disabled={notifSaving}
                  >
                    {notifSaving ? 'Saving...' : 'Save preferences'}
                  </Button>
                  {notifSaved && (
                    <span className="flex items-center gap-1.5 text-sm text-[#2F8F6B] font-medium">
                      <Check className="w-4 h-4" />
                      Saved
                    </span>
                  )}
                </div>

                <div className="p-3 bg-[#FFF8F7] border border-[#E9D6DA] rounded-xl">
                  <div className="flex items-start gap-2">
                    <BellOff className="w-4 h-4 text-[#6B5B60] mt-0.5 shrink-0" />
                    <p className="text-xs text-[#6B5B60] leading-relaxed">
                      Reminders currently appear as in-app notifications. Native mobile push
                      notifications are planned and will use these same preferences when available.
                    </p>
                  </div>
                </div>
              </div>
            )}
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
                  Your data is protected with account-based access controls and encryption in
                  transit. Only you can access your lab results and health information — no other
                  user or third party can view your data.
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
                <h2 className="text-xl font-semibold text-gray-900 mb-2">Delete My Data</h2>
                <p className="text-gray-600 mb-4">
                  Permanently delete all your health data and account. This action cannot be undone.
                </p>
                {!showDeleteConfirm ? (
                  <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
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
                          <p className="text-sm text-red-800">Deleting your data will:</p>
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
