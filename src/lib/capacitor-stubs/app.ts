// Dev-only stub for `@capacitor/app`. Aliased in vite.config.ts when
// `command === 'serve'` so the web dev server runs without the real plugin.
// The export shape mirrors `AppPlugin` from `@capacitor/app` so callers get
// real type errors when they touch APIs the stub doesn't implement.

import type { PluginListenerHandle } from '@capacitor/core';

type AppEvent =
  | 'appStateChange'
  | 'pause'
  | 'resume'
  | 'appUrlOpen'
  | 'appRestoredResult'
  | 'backButton';

export interface AppInfo {
  name: string;
  id: string;
  build: string;
  version: string;
}

export interface AppState {
  isActive: boolean;
}

export interface AppLaunchUrl {
  url: string;
}

export interface AppLanguageCode {
  value: string;
}

const noopHandle: PluginListenerHandle = {
  remove: () => Promise.resolve(),
};

export const App = {
  exitApp: (): Promise<void> => Promise.resolve(),
  getInfo: (): Promise<AppInfo> =>
    Promise.resolve({ id: '', name: '', build: '', version: '' }),
  getState: (): Promise<AppState> => Promise.resolve({ isActive: true }),
  getLaunchUrl: (): Promise<AppLaunchUrl | undefined> => Promise.resolve(undefined),
  minimizeApp: (): Promise<void> => Promise.resolve(),
  getAppLanguage: (): Promise<AppLanguageCode> => Promise.resolve({ value: 'en' }),
  // Web has no hardware back button, no URL-open lifecycle, no app-restored
  // payload, etc. The stub accepts a typed event name and returns a no-op
  // handle so call sites compile but don't fire on web.
  addListener: (
    _eventName: AppEvent,
    _listenerFunc: (...args: unknown[]) => void,
  ): Promise<PluginListenerHandle> => Promise.resolve(noopHandle),
  removeAllListeners: (): Promise<void> => Promise.resolve(),
};
