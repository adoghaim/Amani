import { useState, useEffect } from 'react';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { supabase } from '../../../lib/supabase';
import { isFeatureEnabled, loadRuntimeConfig } from '../../../lib/runtimeConfig';
import { Bell, BellOff, Check } from 'lucide-react';
import { NotificationPreferences } from '../../../types';
import type { SettingsSectionProps } from './types';

/** features.local_reminders (docs/runtime-config.md): off until on-device reminders ship (PK-NOTIF-LOCAL, D7.7). */
export const LOCAL_REMINDERS_FLAG = 'local_reminders';

function useLocalRemindersEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => isFeatureEnabled(LOCAL_REMINDERS_FLAG));
  useEffect(() => {
    let live = true;
    void loadRuntimeConfig().then(() => {
      if (live) setEnabled(isFeatureEnabled(LOCAL_REMINDERS_FLAG));
    });
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}

/**
 * Nothing delivers a reminder today, so the section stays hidden (and reads no
 * preferences) until the owner switches features.local_reminders on (D7.7).
 */
export function RemindersSection(props: SettingsSectionProps) {
  if (!useLocalRemindersEnabled()) return null;
  return <RemindersCard {...props} />;
}

function RemindersCard({ user }: SettingsSectionProps) {
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);
  const [notifSaveFailed, setNotifSaveFailed] = useState(false);

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
    } catch {
      setNotifPrefs(null);
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
    setNotifSaved(false);
    setNotifSaveFailed(false);
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

      // supabase-js returns { error } rather than throwing: "Saved" only after a clean answer.
      if (notifPrefs?.id) {
        const { error } = await supabase
          .from('notification_preferences')
          .update(payload)
          .eq('id', notifPrefs.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('notification_preferences')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        if (data) setNotifPrefs(data as NotificationPreferences);
      }

      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 2500);
    } catch {
      setNotifSaved(false);
      setNotifSaveFailed(true);
    } finally {
      setNotifSaving(false);
    }
  };

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
    <Card>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-theme-surface-2 rounded-full flex items-center justify-center">
            <Bell className="w-4 h-4 text-theme-primary" />
          </div>
          <div>
            <h2 className="text-lg text-theme-neutral-900">Reminder preferences</h2>
            {/*
              Nothing delivers a reminder today: no notification plugin,
              no scheduled sender, and nothing reads the reminders table.
              Say so rather than describe a delivery channel.
            */}
            <p className="text-xs text-theme-muted-text">
              Reminders aren&rsquo;t sent yet.
            </p>
          </div>
        </div>
      </div>

      {notifLoading ? (
        <div className="text-sm text-theme-muted-text py-2">Loading preferences...</div>
      ) : (
        <div className="space-y-4">
          {reminders.map(({ key, label, description }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-theme-text">{label}</p>
                <p className="text-xs text-theme-muted-text">{description}</p>
              </div>
              <button
                onClick={() => updatePref(key, !(prefs[key] as boolean))}
                className={`shrink-0 w-11 h-6 rounded-full transition-colors duration-200 relative ${
                  prefs[key] ? 'bg-theme-primary' : 'bg-theme-neutral-200'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-theme-surface rounded-full shadow-sm transition-transform duration-200 ${
                    prefs[key] ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}

          <div className="pt-2 border-t border-theme-border">
            <label className="block text-xs font-medium text-theme-muted-text mb-2">
              Preferred reminder time
            </label>
            <input
              type="time"
              value={prefs.reminder_time || '08:00'}
              onChange={(e) => updatePref('reminder_time', e.target.value)}
              className="px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text"
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
            {notifSaveFailed && (
              <span role="alert" className="text-sm text-theme-muted-text">
                We couldn&rsquo;t save your preferences. Please try again.
              </span>
            )}
            {notifSaved && (
              <span className="flex items-center gap-1.5 text-sm text-theme-success font-medium">
                <Check className="w-4 h-4" />
                Saved
              </span>
            )}
          </div>

          <div className="p-3 bg-theme-background border border-theme-border rounded-xl">
            <div className="flex items-start gap-2">
              <BellOff className="w-4 h-4 text-theme-muted-text mt-0.5 shrink-0" />
              <p className="text-xs text-theme-muted-text leading-relaxed">
                Nothing is sent to you yet, in the app or on your phone. We&rsquo;ll use
                these preferences when notifications launch.
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
