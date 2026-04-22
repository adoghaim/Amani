import type { LinkingOptions, ParamListBase } from '@react-navigation/native';
import * as ExpoLinking from 'expo-linking';

export const AUTH_CALLBACK_PATH = 'auth/callback';
export const PASSWORD_RESET_PATH = 'reset-password';

function normalizePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return '/';
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function createAppUrl(path: string) {
  return ExpoLinking.createURL(normalizePath(path));
}

export const authCallbackUrl = createAppUrl(AUTH_CALLBACK_PATH);
export const passwordResetUrl = createAppUrl(PASSWORD_RESET_PATH);

function getPath(url: string) {
  return (ExpoLinking.parse(url).path ?? '').replace(/^\/+|\/+$/g, '');
}

function shouldRouteThroughNavigation(url: string) {
  return getPath(url) !== AUTH_CALLBACK_PATH;
}

export const navigationLinking: LinkingOptions<ParamListBase> = {
  prefixes: [ExpoLinking.createURL('/'), 'amani://'],
  config: {
    screens: {
      Login: 'login',
      Signup: 'signup',
      ResetPassword: 'forgot-password',
      UpdatePassword: PASSWORD_RESET_PATH,
      Onboarding: 'onboarding',
      MainTabs: {
        path: '',
        screens: {
          Dashboard: '',
          ReportsList: 'reports',
          Tracker: 'tracker',
          Settings: 'settings',
        },
      },
      UploadReport: 'reports/new',
      ReportDetail: 'reports/:reportId',
      Billing: 'billing',
    },
  } as any,
  async getInitialURL() {
    const url = await ExpoLinking.getInitialURL();
    if (!url) {
      return null;
    }

    return shouldRouteThroughNavigation(url) ? url : null;
  },
  subscribe(listener) {
    const subscription = ExpoLinking.addEventListener('url', ({ url }: { url: string }) => {
      if (shouldRouteThroughNavigation(url)) {
        listener(url);
      }
    });

    return () => subscription.remove();
  },
};
