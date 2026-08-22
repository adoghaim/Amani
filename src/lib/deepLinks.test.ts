import { describe, expect, it } from 'vitest';
import { deepLinkTarget } from './deepLinks';

describe('deepLinkTarget', () => {
  it('routes a password-reset link with an implicit-flow token in the hash', () => {
    expect(
      deepLinkTarget(
        'https://amanibiometrics.com/reset-password#access_token=abc123&type=recovery'
      )
    ).toBe('/reset-password#access_token=abc123&type=recovery');
  });

  it('routes a password-reset link with a PKCE code in the query', () => {
    expect(deepLinkTarget('https://amanibiometrics.com/reset-password?code=xyz789')).toBe(
      '/reset-password?code=xyz789'
    );
  });

  it('routes a Stripe success link and keeps session_id', () => {
    expect(deepLinkTarget('https://amanibiometrics.com/success?session_id=cs_test_1')).toBe(
      '/success?session_id=cs_test_1'
    );
  });

  it('accepts the www host', () => {
    expect(deepLinkTarget('https://www.amanibiometrics.com/success')).toBe('/success');
  });

  it('is case-insensitive about the host', () => {
    expect(deepLinkTarget('https://AmaniBiometrics.com/success')).toBe('/success');
  });

  it('tolerates a trailing slash', () => {
    expect(deepLinkTarget('https://amanibiometrics.com/reset-password/')).toBe('/reset-password');
  });

  it('ignores a host we do not claim', () => {
    expect(deepLinkTarget('https://evil.example.com/reset-password?code=1')).toBeNull();
  });

  it('ignores a lookalike host that merely ends with our domain', () => {
    expect(deepLinkTarget('https://notamanibiometrics.com/success')).toBeNull();
  });

  it('ignores a path we do not claim', () => {
    expect(deepLinkTarget('https://amanibiometrics.com/app/settings')).toBeNull();
  });

  it('ignores non-https schemes', () => {
    expect(deepLinkTarget('http://amanibiometrics.com/success')).toBeNull();
    expect(deepLinkTarget('javascript:alert(1)')).toBeNull();
  });

  it('ignores malformed input', () => {
    expect(deepLinkTarget('not a url')).toBeNull();
    expect(deepLinkTarget('')).toBeNull();
  });
});
