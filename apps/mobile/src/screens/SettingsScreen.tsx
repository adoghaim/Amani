import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  Bell,
  ChevronRight,
  CreditCard,
  Lock,
  LogOut,
  Shield,
  Trash2,
  User,
} from 'lucide-react-native';
import { type NotificationPreferences } from '@amani/shared';
import { Button, Card, Input, Notice, Text } from '../components';
import { useAuth } from '../contexts/AuthContext';
import {
  clearStoredPushTokenAsync,
  registerForPushNotificationsAsync,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';

const DEFAULT_PREFS = {
  period_reminders: true,
  fertile_reminders: true,
  ovulation_reminders: true,
  lab_reminders: true,
  intervention_reminders: true,
  reminder_time: '08:00',
  expo_push_token: null,
  push_token_updated_at: null,
} as const;

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { user, userProfile, signOut } = useAuth();
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      void fetchNotifPrefs();
    }
  }, [user]);

  const prefs = useMemo(() => {
    return (
      notifPrefs ?? {
        id: '',
        user_id: user?.id ?? '',
        ...DEFAULT_PREFS,
        created_at: '',
        updated_at: '',
      }
    );
  }, [notifPrefs, user?.id]);

  const fetchNotifPrefs = async () => {
    if (!user) {
      return;
    }

    try {
      setNotifLoading(true);
      const { data, error: prefsError } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (prefsError) {
        throw prefsError;
      }

      setNotifPrefs((data ?? null) as NotificationPreferences | null);
    } catch (fetchError) {
      console.error('Failed to fetch notification preferences:', fetchError);
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load notification preferences.');
    } finally {
      setNotifLoading(false);
    }
  };

  const updatePref = (key: keyof NotificationPreferences, value: boolean | string) => {
    setNotifPrefs({
      ...prefs,
      [key]: value,
    } as NotificationPreferences);
    setSaved(false);
  };

  const savePrefs = async (nextPrefs?: NotificationPreferences) => {
    if (!user) {
      return;
    }
    const prefsToSave = nextPrefs ?? prefs;

    try {
      setNotifSaving(true);
      setError('');
      const payload = {
        user_id: user.id,
        period_reminders: prefsToSave.period_reminders,
        fertile_reminders: prefsToSave.fertile_reminders,
        ovulation_reminders: prefsToSave.ovulation_reminders,
        lab_reminders: prefsToSave.lab_reminders,
        intervention_reminders: prefsToSave.intervention_reminders,
        reminder_time: prefsToSave.reminder_time || DEFAULT_PREFS.reminder_time,
        expo_push_token: prefsToSave.expo_push_token,
        push_token_updated_at: prefsToSave.push_token_updated_at,
        updated_at: new Date().toISOString(),
      };

      if (notifPrefs?.id) {
        const { error: updateError } = await supabase
          .from('notification_preferences')
          .update(payload)
          .eq('id', notifPrefs.id);
        if (updateError) {
          throw updateError;
        }
      } else {
        const { data, error: insertError } = await supabase
          .from('notification_preferences')
          .insert(payload)
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        setNotifPrefs(data as NotificationPreferences);
      }

      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save preferences.');
    } finally {
      setNotifSaving(false);
    }
  };

  const savePrefsWithPushRegistration = async () => {
    const remindersEnabled = [
      prefs.period_reminders,
      prefs.fertile_reminders,
      prefs.ovulation_reminders,
      prefs.lab_reminders,
      prefs.intervention_reminders,
    ].some(Boolean);

    if (!remindersEnabled) {
      const nextPrefs = {
        ...prefs,
        expo_push_token: null,
        push_token_updated_at: null,
      } as NotificationPreferences;
      setNotifPrefs(nextPrefs);
      await clearStoredPushTokenAsync();
      await savePrefs(nextPrefs);
      return;
    }

    const token = await registerForPushNotificationsAsync();
    if (!token) {
      Alert.alert(
        'Notifications disabled',
        'Enable notification permissions in system settings to receive reminders.'
      );
    }

    const nextPrefs = {
      ...prefs,
      expo_push_token: token,
      push_token_updated_at: token ? new Date().toISOString() : null,
    } as NotificationPreferences;
    setNotifPrefs(nextPrefs);
    await savePrefs(nextPrefs);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently removes your reports, tracker history, and profile. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteAccount();
          },
        },
      ]
    );
  };

  const deleteAccount = async () => {
    if (!user) {
      return;
    }

    try {
      setDeleting(true);
      setError('');

      const { error: deleteDataError } = await supabase.functions.invoke('delete-user-data');
      if (deleteDataError) {
        throw deleteDataError;
      }

      const { error: deleteProfileError } = await supabase.from('users').delete().eq('id', user.id);
      if (deleteProfileError) {
        throw deleteProfileError;
      }

      await signOut();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete the account.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text variant="title">Settings</Text>
          <Text variant="bodySm" tone="muted">
            Profile, reminders, billing, and account controls.
          </Text>
        </View>

        {error ? (
          <Notice tone="error" style={styles.notice}>
            {error}
          </Notice>
        ) : null}

        <Card style={styles.profileCard}>
          <View style={styles.avatar}>
            <User size={28} color={theme.colors.primary} />
          </View>
          <View style={styles.profileCopy}>
            <Text variant="body" weight="bold">
              {user?.email ?? 'Signed out'}
            </Text>
            <Text variant="caption" tone="muted">
              Member since {userProfile?.created_at ? new Date(userProfile.created_at).toLocaleDateString() : 'today'}
            </Text>
            <Text variant="caption" tone="muted">
              Subscription: {userProfile?.subscription_status ?? 'trial'}
            </Text>
          </View>
        </Card>

        <Card style={styles.rowCard}>
          <TouchableOpacity style={styles.navRow} onPress={() => navigation.navigate('Billing')}>
            <View style={styles.rowIcon}>
              <CreditCard size={18} color={theme.colors.primary} />
            </View>
            <View style={styles.rowCopy}>
              <Text variant="bodySm" weight="semibold">
                Billing & subscription
              </Text>
              <Text variant="caption" tone="muted">
                Manage Stripe checkout, renewals, and payment details.
              </Text>
            </View>
            <ChevronRight size={18} color={theme.colors.mutedText3} />
          </TouchableOpacity>
        </Card>

        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Bell size={18} color={theme.colors.primary} />
            </View>
            <View style={styles.sectionHeaderCopy}>
              <Text variant="body" weight="bold">
                Reminder preferences
              </Text>
              <Text variant="caption" tone="muted">
                These settings drive the local reminders scheduled on your device.
              </Text>
            </View>
          </View>

          {notifLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : (
            <View style={styles.preferenceList}>
              {[
                ['period_reminders', 'Period reminder', 'Upcoming period alerts'],
                ['fertile_reminders', 'Fertile window', 'Cycle timing nudges'],
                ['ovulation_reminders', 'Ovulation day', 'Estimated ovulation alert'],
                ['lab_reminders', 'Lab reminders', 'Report-ready and lab cadence alerts'],
                ['intervention_reminders', 'Intervention check-ins', 'Follow-up reminders for routines'],
              ].map(([key, title, description]) => (
                <View key={key} style={styles.preferenceRow}>
                  <View style={styles.preferenceCopy}>
                    <Text variant="bodySm" weight="semibold">
                      {title}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {description}
                    </Text>
                  </View>
                  <Switch
                    value={Boolean(prefs[key as keyof NotificationPreferences])}
                    onValueChange={(value) => updatePref(key as keyof NotificationPreferences, value)}
                    trackColor={{ false: theme.colors.border, true: theme.colors.primaryLight }}
                    thumbColor={Boolean(prefs[key as keyof NotificationPreferences]) ? theme.colors.primary : theme.colors.white}
                  />
                </View>
              ))}

              <Input
                label="Preferred reminder time"
                value={prefs.reminder_time ?? DEFAULT_PREFS.reminder_time}
                onChangeText={(value) => updatePref('reminder_time', value)}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="08:00"
                hint="24-hour format, for example 08:00."
              />

              <View style={styles.preferenceActions}>
                <Button
                  label={notifSaving ? 'Saving…' : saved ? 'Saved' : 'Save preferences'}
                  onPress={() => {
                    void savePrefsWithPushRegistration();
                  }}
                  loading={notifSaving}
                />
              </View>
            </View>
          )}
        </Card>

        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Shield size={18} color={theme.colors.success} />
            </View>
            <View style={styles.sectionHeaderCopy}>
              <Text variant="body" weight="bold">
                Privacy & security
              </Text>
              <Text variant="caption" tone="muted">
                Billing stays in Stripe and health data stays scoped to your account.
              </Text>
            </View>
          </View>
          <View style={styles.securityRow}>
            <Lock size={16} color={theme.colors.mutedText3} />
            <Text variant="bodySm" tone="muted" style={styles.securityText}>
              Data is transmitted over encrypted connections, and account-scoped access rules prevent other users from reading your records.
            </Text>
          </View>
        </Card>

        <Card style={styles.sectionCard}>
          <Text variant="body" weight="bold">
            Account actions
          </Text>
          <View style={styles.actionStack}>
            <Button
              label="Sign out"
              onPress={() => {
                void signOut();
              }}
              variant="outline"
              icon={<LogOut />}
              fullWidth
            />
            <Button
              label={deleting ? 'Deleting account…' : 'Delete account'}
              onPress={handleDeleteAccount}
              variant="danger"
              icon={<Trash2 />}
              loading={deleting}
              fullWidth
            />
          </View>
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
    gap: theme.spacing.xs,
  },
  notice: {
    marginTop: -theme.spacing.xs,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCopy: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  rowCard: {
    padding: 0,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  sectionCard: {
    gap: theme.spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderCopy: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  loadingRow: {
    paddingVertical: theme.spacing.md,
  },
  preferenceList: {
    gap: theme.spacing.md,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  preferenceCopy: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  preferenceActions: {
    marginTop: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  securityRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  securityText: {
    flex: 1,
  },
  actionStack: {
    gap: theme.spacing.sm,
  },
});
