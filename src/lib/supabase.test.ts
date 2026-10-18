// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ native: false, createClient: vi.fn(() => ({})) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => env.native } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: env.createClient }));

beforeEach(() => {
  vi.resetModules();
  env.createClient.mockClear();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'synthetic-anon');
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([
  [false, '1.0.7', false],
  [false, '2.0.0', false],
  [true, '1.0.6', false],
  [true, '1.0.6.1', false],
  [true, 'broken', false],
  [true, '1.0.7', true],
  [true, '1.0.10', true],
  [true, '2.0.0', true],
] as const)('native=%s release=%s secure=%s', async (native, version, active) => {
  env.native = native;
  vi.stubGlobal('__APP_RELEASE__', `amani@${version}+abcdef0`);
  localStorage.setItem('sb-synthetic-auth-token', 'unchanged');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const remove = vi.spyOn(Storage.prototype, 'removeItem');
  await import('./supabase');
  const { authSessionStorage } = await import('./native/authStorage');
  const expected = {
    autoRefreshToken: true, persistSession: true, detectSessionInUrl: true,
    ...(active ? { storage: authSessionStorage() } : {}),
  };
  expect(env.createClient).toHaveBeenCalledWith('https://synthetic.invalid', 'synthetic-anon', { auth: expected });
  const options = (env.createClient.mock.calls[0] as unknown as [string, string, { auth: unknown }])[2];
  expect(options.auth).toStrictEqual(expected);
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(localStorage.getItem('sb-synthetic-auth-token')).toBe('unchanged');
  expect(localStorage.getItem('amani.install-marker.v1')).toBeNull();
  expect(localStorage.getItem('amani.device-lock.v1')).toBeNull();
  vi.restoreAllMocks();
});
