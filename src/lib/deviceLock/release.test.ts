import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDeviceLockActive } from './release';

afterEach(() => vi.unstubAllGlobals());
describe('PK-DEVICE-01 release activation', () => {
  it.each(['1.0.6', '1.0.6.1', '1.0.7.1', '0.9.9', 'broken', '1.0.7-beta'])('rejects %s on native', version => {
    expect(isDeviceLockActive(true, `amani@${version}+abcdef0`)).toBe(false);
  });
  it.each(['1.0.7', '1.0.10', '2.0.0'])('activates native %s but never web', version => {
    const release = `amani@${version}+abcdef0`;
    expect(isDeviceLockActive(true, release)).toBe(true);
    expect(isDeviceLockActive(true, `amani@${version}`)).toBe(true);
    expect(isDeviceLockActive(false, release)).toBe(false);
  });
  it.each(['', '1.0.7', 'amani@1.0.7+unknown'])('fails closed for malformed release %s', release => {
    expect(isDeviceLockActive(true, release)).toBe(false);
  });
  it('uses the build-time release', () => {
    vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.6+abcdef0');
    expect(isDeviceLockActive(true)).toBe(false);
    vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.7+abcdef0');
    expect(isDeviceLockActive(true)).toBe(true);
  });
});
