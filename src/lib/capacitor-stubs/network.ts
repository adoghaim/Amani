// Dev-only stub for `@capacitor/network`. Aliased in vite.config.ts when
// `command === 'serve'`. Mirrors `NetworkPlugin` from `@capacitor/network`.

import type { PluginListenerHandle } from '@capacitor/core';

export type ConnectionType = 'wifi' | 'cellular' | 'none' | 'unknown';

export interface ConnectionStatus {
  connected: boolean;
  connectionType: ConnectionType;
}

type NetworkEvent = 'networkStatusChange';

const noopHandle: PluginListenerHandle = {
  remove: () => Promise.resolve(),
};

export const Network = {
  getStatus: (): Promise<ConnectionStatus> =>
    Promise.resolve({
      connected: navigator.onLine,
      connectionType: 'unknown',
    }),
  addListener: (
    _eventName: NetworkEvent,
    _listenerFunc: (status: ConnectionStatus) => void,
  ): Promise<PluginListenerHandle> => Promise.resolve(noopHandle),
  removeAllListeners: (): Promise<void> => Promise.resolve(),
};
