import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  computeCyclePrediction,
  type LabReport,
  type NotificationPreferences,
  type PeriodLog,
} from '@amani/shared';
import { useAuth } from '../contexts/AuthContext';
import {
  getDefaultNotificationPreferences,
  handleIncomingNotification,
  handleNotificationData,
  notifyForNewReadyReportsAsync,
  registerForPushNotificationsAsync,
  scheduleCycleReminderNotificationsAsync,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';

async function fetchNotificationPreferencesAsync(userId: string) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return getDefaultNotificationPreferences(userId);
  }

  return data as NotificationPreferences;
}

async function syncPushTokenAsync(userId: string, token: string | null) {
  const existing = await fetchNotificationPreferencesAsync(userId);
  const nextToken = token?.trim() || null;

  if (existing.expo_push_token === nextToken) {
    return;
  }

  const payload = {
    user_id: userId,
    period_reminders: existing.period_reminders,
    fertile_reminders: existing.fertile_reminders,
    ovulation_reminders: existing.ovulation_reminders,
    lab_reminders: existing.lab_reminders,
    intervention_reminders: existing.intervention_reminders,
    reminder_time: existing.reminder_time,
    expo_push_token: nextToken,
    push_token_updated_at: nextToken ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('notification_preferences')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    throw error;
  }
}

async function fetchPeriodLogsAsync(userId: string) {
  const { data, error } = await supabase
    .from('period_logs')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as PeriodLog[];
}

async function fetchLabReportsAsync(userId: string) {
  const { data, error } = await supabase
    .from('lab_reports')
    .select('*')
    .eq('user_id', userId)
    .order('report_date', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as LabReport[];
}

export function useNotificationSync() {
  const { user, userProfile } = useAuth();

  useEffect(() => {
    if (!user || !userProfile) {
      return;
    }

    let active = true;

    const syncNotifications = async () => {
      try {
        const pushToken = await registerForPushNotificationsAsync();

        if (!active) {
          return;
        }

        await syncPushTokenAsync(user.id, pushToken);

        const [preferences, periodLogs, reports] = await Promise.all([
          fetchNotificationPreferencesAsync(user.id),
          fetchPeriodLogsAsync(user.id),
          fetchLabReportsAsync(user.id),
        ]);

        if (!active) {
          return;
        }

        const prediction =
          periodLogs.length > 0
            ? computeCyclePrediction(periodLogs, userProfile)
            : null;
        await scheduleCycleReminderNotificationsAsync(prediction, preferences);
        await notifyForNewReadyReportsAsync(user.id, reports, preferences.lab_reminders);
      } catch (error) {
        console.error('Failed to sync notifications:', error);
      }
    };

    void syncNotifications();

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationData(response.notification.request.content.data);
    });

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      handleIncomingNotification(notification);
    });

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncNotifications();
      }
    });

    return () => {
      active = false;
      responseSubscription.remove();
      receivedSubscription.remove();
      appStateSubscription.remove();
    };
  }, [
    user?.id,
    userProfile?.age_range,
    userProfile?.default_cycle_length,
    userProfile?.default_period_length,
    userProfile?.trial_start_date,
  ]);
}
