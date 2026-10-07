import { test, expect, type WebSocketRoute } from '@playwright/test';
import { assertNetworkAllowed, guardWebSocket } from './network-guard';

function socketDouble(url: string) {
  const calls: string[] = [];
  const socket = {
    url: () => url,
    connectToServer: () => {
      calls.push('connect');
      return {} as WebSocketRoute;
    },
    close: async () => { calls.push('close'); },
  };
  return { socket, calls };
}

test('same-origin socket connects without a guard failure', async () => {
  const { socket, calls } = socketDouble('ws://127.0.0.1:4173/local?synthetic=value');
  const unexpected: string[] = [];
  await guardWebSocket(socket, unexpected);
  expect(calls).toEqual(['connect']);
  assertNetworkAllowed(unexpected);
});

for (const url of [
  'ws://localhost:4173/socket',
  'ws://127.0.0.1:4174/socket',
  'wss://127.0.0.1:4173/socket',
  'ws://127.0.0.1.evil.invalid:4173/socket',
  'wss://amani-e2e.invalid/realtime/v1/websocket',
]) {
  test(`non-local socket fails the guard: ${url}`, async () => {
    const { socket, calls } = socketDouble(`${url}?synthetic-secret=never-log-this`);
    const unexpected: string[] = [];
    await guardWebSocket(socket, unexpected);
    expect(calls).toEqual(['close']);
    expect(unexpected).toEqual([`WebSocket ${url}`]);
    expect(() => assertNetworkAllowed(unexpected)).toThrow('All browser requests must be local assets');
    try {
      assertNetworkAllowed(unexpected);
    } catch (error) {
      expect(String(error)).toContain(url);
      expect(String(error)).not.toContain('never-log-this');
    }
  });
}
