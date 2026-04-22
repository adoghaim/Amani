import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  addDays,
  formatDate,
  formatMonthDay,
  type CyclePrediction,
  type LabReport,
  type NotificationPreferences,
} from '@amani/shared';
import { navigate } from '../navigation/rootNavigation';

const REMINDERS_CHANNEL_ID = 'amani-reminders';
const LAB_RESULTS_CHANNEL_ID = 'amani-lab-results';
const MANAGED_NOTIFICATION_SOURCE = 'amani';
const READY_REPORTS_STORAGE_PREFIX = 'amani.ready-report-cache:';
const PUSH_TOKEN_STORAGE_KEY = 'amani.expo-push-token';
const DEFAULT_REMINDER_TIME = '08:00';

type ManagedNotificationKind = 'cycle-reminder' | 'lab-ready';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function isPermissionGranted(status: Notifications.NotificationPermissionsStatus) {
  const baseStatus = status as unknown as { granted?: boolean };

  if (typeof baseStatus.granted === 'boolean') {
    return baseStatus.granted;
  }

  const iosStatus = status.ios?.status;
  return (
    iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

function getReminderTimeParts(reminderTime: string | null) {
  const [hoursRaw = '08', minutesRaw = '00'] = (reminderTime || DEFAULT_REMINDER_TIME).split(':');
  const hours = Number.parseInt(hoursRaw, 10);
  const minutes = Number.parseInt(minutesRaw, 10);

  return {
    hours: Number.isFinite(hours) ? hours : 8,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  };
}

function atReminderTime(date: Date, reminderTime: string | null) {
  const next = new Date(date);
  const { hours, minutes } = getReminderTimeParts(reminderTime);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function moveIntoFuture(date: Date, cycleLength: number) {
  const next = new Date(date);
  const now = new Date();

  while (next <= now) {
    next.setTime(addDays(next, cycleLength).getTime());
  }

  return next;
}

function buildManagedData(kind: ManagedNotificationKind, extra: Record<string, unknown> = {}) {
  return {
    managedBy: MANAGED_NOTIFICATION_SOURCE,
    kind,
    target: 'Dashboard',
    ...extra,
  };
}

function isManagedScheduledNotification(
  request: Notifications.NotificationRequest,
  kind: ManagedNotificationKind
) {
  return (
    request.content.data?.managedBy === MANAGED_NOTIFICATION_SOURCE &&
    request.content.data?.kind === kind
  );
}

async function cancelManagedScheduledNotificationsAsync(kind: ManagedNotificationKind) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => isManagedScheduledNotification(request, kind))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
  );
}

export function getDefaultNotificationPreferences(userId: string): NotificationPreferences {
  const now = new Date().toISOString();

  return {
    id: '',
    user_id: userId,
    period_reminders: true,
    fertile_reminders: true,
    ovulation_reminders: true,
    lab_reminders: true,
    intervention_reminders: true,
    reminder_time: DEFAULT_REMINDER_TIME,
    expo_push_token: null,
    push_token_updated_at: null,
    created_at: now,
    updated_at: now,
  };
}

export async function ensureNotificationChannelsAsync() {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
    name: 'Cycle reminders',
    description: 'Period, fertile window, and ovulation reminders.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 150, 150, 150],
    lightColor: '#C97C8B',
  });

  await Notifications.setNotificationChannelAsync(LAB_RESULTS_CHANNEL_ID, {
    name: 'Lab results',
    description: 'Alerts when lab reports are ready to review.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#7A3E55',
  });
}

export async function registerForPushNotificationsAsync() {
  await ensureNotificationChannelsAsync();

  if (!Device.isDevice) {
    return null;
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = isPermissionGranted(existing);

  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = isPermissionGranted(requested);
  }

  if (!granted) {
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

  const token = projectId
    ? (await Notifications.getExpoPushTokenAsync({ projectId })).data
    : (await Notifications.getExpoPushTokenAsync()).data;

  await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
  return token;
}

export async function getStoredPushTokenAsync() {
  return AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
}

export async function clearStoredPushTokenAsync() {
  await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
}

export async function scheduleCycleReminderNotificationsAsync(
  prediction: CyclePrediction | null,
  preferences: NotificationPreferences
) {
  await cancelManagedScheduledNotificationsAsync('cycle-reminder');

  if (!prediction) {
    return;
  }

  const requests: Array<{
    date: Date;
    title: string;
    body: string;
    notificationType: string;
  }> = [];

  if (preferences.period_reminders) {
    const periodReminder = moveIntoFuture(
      atReminderTime(addDays(prediction.nextPeriodStart, -1), preferences.reminder_time),
      prediction.cycleLength
    );

    requests.push({
      date: periodReminder,
      title: 'Period reminder',
      body: `Your next period is expected around ${formatMonthDay(prediction.nextPeriodStart)}.`,
      notificationType: 'period',
    });
  }

  if (preferences.fertile_reminders) {
    const fertileReminder = moveIntoFuture(
      atReminderTime(prediction.fertileWindowStart, preferences.reminder_time),
      prediction.cycleLength
    );

    requests.push({
      date: fertileReminder,
      title: 'Fertile window reminder',
      body: `Your fertile window is expected to begin around ${formatMonthDay(
        prediction.fertileWindowStart
      )}.`,
      notificationType: 'fertile_window',
    });
  }

  if (preferences.ovulation_reminders) {
    const ovulationReminder = moveIntoFuture(
      atReminderTime(prediction.ovulationDay, preferences.reminder_time),
      prediction.cycleLength
    );

    requests.push({
      date: ovulationReminder,
      title: 'Ovulation reminder',
      body: `Ovulation is estimated around ${formatMonthDay(prediction.ovulationDay)}.`,
      notificationType: 'ovulation',
    });
  }

  await Promise.all(
    requests.map((request) =>
      Notifications.scheduleNotificationAsync({
        content: {
          title: request.title,
          body: request.body,
          sound: 'default',
          data: buildManagedData('cycle-reminder', {
            notificationType: request.notificationType,
            scheduledFor: request.date.toISOString(),
          }),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: request.date,
          channelId: Platform.OS === 'android' ? REMINDERS_CHANNEL_ID : undefined,
        },
      })
    )
  );
}

export async function notifyForNewReadyReportsAsync(
  userId: string,
  reports: LabReport[],
  enabled: boolean
) {
  const storageKey = `${READY_REPORTS_STORAGE_PREFIX}${userId}`;
  const readyReports = reports.filter((report) => report.status === 'ready');
  const readyIds = readyReports.map((report) => report.id);
  const cached = await AsyncStorage.getItem(storageKey);

  if (!cached) {
    await AsyncStorage.setItem(storageKey, JSON.stringify(readyIds));
    return;
  }

  const seenIds = new Set<string>(JSON.parse(cached) as string[]);
  const newReadyReports = readyReports.filter((report) => !seenIds.has(report.id));

  await AsyncStorage.setItem(storageKey, JSON.stringify(readyIds));

  if (!enabled || newReadyReports.length === 0) {
    return;
  }

  const latestReport = newReadyReports[0];
  const title =
    newReadyReports.length === 1 ? 'Lab results ready' : `${newReadyReports.length} lab results ready`;
  const body =
    newReadyReports.length === 1
      ? `Your lab report from ${formatDate(latestReport.report_date)} is ready to review.`
      : 'Open Amani to review your newly processed lab reports.';

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      data: buildManagedData('lab-ready', {
        reportIds: newReadyReports.map((report) => report.id),
      }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      channelId: Platform.OS === 'android' ? LAB_RESULTS_CHANNEL_ID : undefined,
    },
  });
}

export function handleNotificationData(data: Record<string, unknown> | undefined) {
  const kind = data?.kind;

  if (kind === 'cycle-reminder' || kind === 'lab-ready') {
    navigate('Dashboard');
  }
}

export function handleIncomingNotification(
  notification: Notifications.Notification
) {
  handleNotificationData(notification.request.content.data);
}
