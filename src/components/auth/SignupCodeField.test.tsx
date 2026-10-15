// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../axe.testkit';

/*
  PK-EXP5 signup code field (owner decisions D6.1, D17, D29; D23 baseline):
  a "Have a promo or referral code?" link above every signup route, one
  labelled field, [A-Za-z0-9._-] up to 64 characters, "Code saved: KEY"
  announced politely, pre-filled by a campaign link, never a discount promise,
  and nothing at all while features.first_party_events is off (D6.2).
*/

const events = vi.hoisted(() => ({
  pendingCode: vi.fn<() => string | null>(() => null),
  setPendingCode: vi.fn<(code: string | null) => boolean>(() => true),
  markSignupStarted: vi.fn(),
}));
const flag = vi.hoisted(() => ({ on: true }));
const auth = vi.hoisted(() => ({ signInWithGoogle: vi.fn(async () => {}), signInWithApple: vi.fn(async () => {}), refreshUserProfile: vi.fn() }));

vi.mock('../../lib/firstPartyEventsClient', () => ({ firstPartyEvents: events }));
vi.mock('../../hooks/useFirstPartyEventsEnabled', () => ({ useFirstPartyEventsEnabled: () => flag.on }));
vi.mock('../../lib/native', () => ({ isNative: () => false }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signUp: vi.fn(async () => ({ error: { message: 'stop here' } })), getUser: vi.fn() }, from: vi.fn() },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));

import { SignupForm } from './SignupForm';
import { SignupCodeField } from './SignupCodeField';

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  flag.on = true;
  events.pendingCode.mockReturnValue(null);
  events.setPendingCode.mockReturnValue(true);
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const renderForm = async () => {
  await act(async () => root.render(<MemoryRouter><SignupForm /></MemoryRouter>));
};
const toggle = () => Array.from(app.querySelectorAll('button')).find(b => b.textContent === 'Have a promo or referral code?');
const field = () => app.querySelector<HTMLInputElement>('input[maxlength="64"]');
const status = () => app.querySelector<HTMLElement>('[aria-live="polite"]');
async function type(value: string) {
  const input = field()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('SignupForm with first-party events off (the default)', () => {
  it('shows no code link or field, and starts no signup tracking', async () => {
    flag.on = false;
    await renderForm();
    expect(toggle()).toBeUndefined();
    expect(field()).toBeNull();
    const form = app.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(events.markSignupStarted).not.toHaveBeenCalled();
    expect(events.pendingCode).not.toHaveBeenCalled();
  });
});

describe('SignupForm with first-party events on', () => {
  it('puts the code link above the Google button and the email form, collapsed', async () => {
    await renderForm();
    const link = toggle()!;
    const google = app.querySelector('[aria-label="Continue with Google"]')!;
    const email = app.querySelector('input[type="email"]')!;
    expect(link.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(link.getAttribute('aria-controls')!)!.hidden).toBe(true);
    // D23: a 44px touch target.
    expect(link.className).toContain('min-h-[44px]');
  });

  it('opens one labelled field; a valid code is held and confirmed politely', async () => {
    await renderForm();
    await act(async () => toggle()!.click());
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true');
    const input = field()!;
    expect(app.querySelector(`label[for="${input.id}"]`)!.textContent).toBe('Promo or referral code');
    await type('SPRING25');
    expect(events.setPendingCode).toHaveBeenLastCalledWith('SPRING25');
    expect(status()!.textContent).toBe('Code saved: SPRING25');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(await axeViolations(app)).toEqual([]);
  });

  it('rejects other characters inline and holds nothing; signup is not blocked', async () => {
    await renderForm();
    await act(async () => toggle()!.click());
    await type('SPRING 25!');
    expect(events.setPendingCode).not.toHaveBeenCalledWith('SPRING 25!');
    const input = field()!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(input.getAttribute('aria-describedby')!)!;
    expect(error.textContent).toBe('Use only letters, numbers, dots, hyphens and underscores.');
    expect(status()!.textContent).toBe('');
    expect(app.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(await axeViolations(app)).toEqual([]);
  });

  it('clearing the field releases the held code', async () => {
    await renderForm();
    await act(async () => toggle()!.click());
    await type('SPRING25');
    await type('');
    expect(events.setPendingCode).toHaveBeenLastCalledWith(null);
    expect(status()!.textContent).toBe('');
  });

  it('a campaign link pre-fills the field, open, with "Code saved: KEY"', async () => {
    events.pendingCode.mockReturnValue('creator.jane');
    await renderForm();
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true');
    expect(field()!.value).toBe('creator.jane');
    expect(status()!.textContent).toBe('Code saved: creator.jane');
    expect(await axeViolations(app)).toEqual([]);
  });

  it('never promises a discount (D29)', async () => {
    events.pendingCode.mockReturnValue('SPRING25');
    await renderForm();
    expect(app.textContent).not.toMatch(/discount|% off|free month|save \$/i);
  });

  it('marks the signup started on submit and before an OAuth redirect', async () => {
    await renderForm();
    const form = app.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(events.markSignupStarted).toHaveBeenCalledTimes(1);
    await act(async () => app.querySelector<HTMLButtonElement>('[aria-label="Continue with Google"]')!.click());
    expect(events.markSignupStarted).toHaveBeenCalledTimes(2);
    expect(auth.signInWithGoogle).toHaveBeenCalled();
  });
});

describe('SignupCodeField alone', () => {
  it('caps input at 64 characters and refuses a 65th by rule as well', async () => {
    await act(async () => root.render(<SignupCodeField events={events} />));
    await act(async () => toggle()!.click());
    expect(field()!.maxLength).toBe(64);
    await type('x'.repeat(65));
    expect(field()!.getAttribute('aria-invalid')).toBe('true');
    expect(events.setPendingCode).not.toHaveBeenCalled();
  });
});
