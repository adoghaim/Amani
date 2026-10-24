// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Alert } from './Alert';

/* F064: the shared Alert is a live region, so Login and Signup errors are read out. */
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('Alert', () => {
  it('announces an error assertively', () => {
    act(() => root.render(<Alert type="error">Wrong password</Alert>));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Wrong password');
  });

  it.each(['success', 'warning', 'info'] as const)('announces %s politely, not as an alert', type => {
    act(() => root.render(<Alert type={type}>Saved</Alert>));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Saved');
  });
});
