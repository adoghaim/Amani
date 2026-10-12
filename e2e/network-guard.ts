import { expect, type WebSocketRoute } from '@playwright/test';

export const origin = 'http://127.0.0.1:4173';
const socketOrigin = origin.replace(/^http:/, 'ws:');

export async function guardWebSocket(
  socket: Pick<WebSocketRoute, 'url' | 'connectToServer' | 'close'>,
  unexpected: string[],
) {
  const url = new URL(socket.url());
  if (url.origin === socketOrigin) {
    socket.connectToServer();
    return;
  }
  // Never retain query strings, headers, credentials, or payloads.
  unexpected.push(`WebSocket ${url.origin}${url.pathname}`);
  await socket.close();
}

export function assertNetworkAllowed(unexpected: string[]) {
  expect(unexpected, 'All browser requests must be local assets or explicit synthetic fixtures').toEqual([]);
}
