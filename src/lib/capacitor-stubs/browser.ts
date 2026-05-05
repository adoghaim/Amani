// Dev-only stub for `@capacitor/browser`. Aliased in vite.config.ts when
// `command === 'serve'`. Mirrors `BrowserPlugin` from `@capacitor/browser`.

import type { PluginListenerHandle } from '@capacitor/core';

type BrowserEvent = 'browserFinished' | 'browserPageLoaded';

export interface OpenOptions {
  url: string;
  windowName?: string;
  toolbarColor?: string;
  presentationStyle?: 'fullscreen' | 'popover';
  width?: number;
  height?: number;
}

const noopHandle: PluginListenerHandle = {
  remove: () => Promise.resolve(),
};

export const Browser = {
  open: (options: OpenOptions): Promise<void> => {
    window.open(options.url, options.windowName ?? '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  },
  close: (): Promise<void> => Promise.resolve(),
  addListener: (
    _eventName: BrowserEvent,
    _listenerFunc: () => void,
  ): Promise<PluginListenerHandle> => Promise.resolve(noopHandle),
  removeAllListeners: (): Promise<void> => Promise.resolve(),
};
