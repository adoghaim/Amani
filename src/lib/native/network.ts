import { isNative } from './platform';

// ─── Network: connectivity awareness ──────────────────────────────────────

export type NetworkStatus = { connected: boolean; connectionType: string };

/**
 * Returns the current network status.
 * Falls back to navigator.onLine on web.
 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  if (isNative()) {
    const { Network } = await import('@capacitor/network');
    const status = await Network.getStatus();
    return { connected: status.connected, connectionType: status.connectionType };
  }
  return { connected: navigator.onLine, connectionType: 'unknown' };
}

/**
 * Subscribes to network status changes.
 * Returns an unsubscribe function — call it on component unmount.
 */
export function onNetworkChange(
  callback: (status: NetworkStatus) => void
): () => void {
  if (isNative()) {
    let handle: { remove: () => void } | null = null;

    import('@capacitor/network').then(({ Network }) => {
      Network.addListener('networkStatusChange', (status) => {
        callback({ connected: status.connected, connectionType: status.connectionType });
      }).then((h) => {
        handle = h;
      });
    });

    return () => handle?.remove();
  }

  // Web fallback
  const onOnline  = () => callback({ connected: true,  connectionType: 'unknown' });
  const onOffline = () => callback({ connected: false, connectionType: 'none' });
  window.addEventListener('online',  onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online',  onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
