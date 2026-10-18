// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stable objects: Settings re-reads preferences whenever `user` changes identity.
const auth = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'synthetic@example.invalid' },
  userProfile: { created_at: '2026-01-01T00:00:00.000Z', subscription_status: 'active' },
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../features/settings/PersonalContextCard', () => ({ PersonalContextCard: () => null }));
vi.mock('../lib/native', () => ({
  openExternalUrl: vi.fn(),
  isNative: () => false,
  platform: () => 'web',
  checkBiometrics: async () => ({ available: false, kind: null, deviceSecure: false }),
  authenticateWithBiometrics: async () => ({ ok: false, reason: 'unavailable' }),
  setScreenshotsBlocked: async () => false,
}));
vi.mock('../lib/iap', () => ({ storeSubscriptionsUrl: vi.fn() }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
      return query;
    },
  },
}));
import { Settings } from './Settings';
import { Privacy } from './Privacy';

/*
  PK-FIX-01a. Two statements on Settings were false:
  - "no other user or third party can view your data" — lab values, report
    images and extracted text go to OpenAI to be read and explained, and other
    companies run parts of the service (Privacy.tsx, "Who else touches your data");
  - reminders "appear as in-app notifications" — nothing sends or shows one.
  The privacy card may only say what src/pages/Privacy.tsx says, so each of its
  claims is checked against the rendered privacy policy, not against a copy of it.
*/

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function render(node: ReactNode) {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  // Let the notification-preferences read settle so the reminders table renders.
  await act(async () => {});
}
async function renderSettings() {
  await render(<Settings />);
  const card = (heading: string) => {
    const h2 = Array.from(app.querySelectorAll('h2')).find(h => norm(h.textContent) === heading);
    expect(h2, heading).toBeTruthy();
    return h2!.parentElement!;
  };
  return { page: norm(app.textContent), privacyCard: card('Data Privacy & Security'), reminders: card('Reminder preferences') };
}
async function privacyPolicyText() {
  await render(<Privacy />);
  return norm(app.textContent);
}

describe('Settings privacy card says only what the Privacy Policy says', () => {
  it('the false "no third party" promise is gone', async () => {
    const { page } = await renderSettings();
    expect(page).not.toMatch(/third[- ]part/i);
    expect(page).not.toMatch(/only you can access/i);
    expect(page).not.toMatch(/no other user/i);
    expect(page).not.toMatch(/all data is scoped/i);
  });

  it('says lab data goes to OpenAI, and the Privacy Policy says so too', async () => {
    const card = norm((await renderSettings()).privacyCard.textContent);
    expect(card).toContain(
      'To read and explain your labs, we send OpenAI your lab values, context you’ve added such as cycle details '
        + 'and your profile, and sometimes images or text from the report itself.',
    );
    const policy = await privacyPolicyText();
    expect(policy).toContain('We send your lab values');
    expect(policy).toContain('to OpenAI so they can be read and explained');
    expect(policy).toContain('the cycle context attached to that report, and a short profile block');
    expect(policy).toContain('Your report itself may also be sent to OpenAI');
  });

  it('every company the card names is one the Privacy Policy names', async () => {
    const card = norm((await renderSettings()).privacyCard.textContent);
    const named = ['OpenAI', 'Supabase', 'Netlify', 'Stripe', 'Apple', 'Google', 'RevenueCat', 'Sentry'];
    for (const company of named) expect(card, company).toContain(company);
    const policy = await privacyPolicyText();
    for (const company of named) expect(policy, company).toContain(company);
  });

  it('keeps "we don\'t sell your data" only because the Privacy Policy says it', async () => {
    const card = norm((await renderSettings()).privacyCard.textContent);
    expect(card).toContain('We don’t sell your data, run ads, or use advertising or analytics trackers.');
    expect(await privacyPolicyText()).toContain(
      'We do not sell your data, run ads, or use advertising or analytics trackers.',
    );
  });

  it('access-control and encryption claims match the Privacy Policy', async () => {
    const card = norm((await renderSettings()).privacyCard.textContent);
    expect(card).toContain('Database access rules stop other Amani users from seeing them, and data is encrypted in transit.');
    const policy = await privacyPolicyText();
    expect(policy).toContain('one user’s query cannot reach another user’s data');
    expect(policy).toContain('Everything you send to and from Amani travels over an encrypted connection (TLS).');
  });

  it('links to the full Privacy Policy', async () => {
    const { privacyCard } = await renderSettings();
    const link = privacyCard.querySelector('a[href="/privacy"]');
    expect(norm(link?.textContent)).toBe('See exactly what each company receives in the Privacy Policy');
  });
});

describe('Settings does not claim reminders are delivered', () => {
  it('no delivery claim remains', async () => {
    const { page } = await renderSettings();
    expect(page).not.toMatch(/in-app notification/i);
    expect(page).not.toMatch(/currently appear/i);
    expect(page).not.toMatch(/push support coming soon/i);
    expect(page).not.toMatch(/push notifications are planned/i);
  });

  it('says plainly that reminders are not sent yet', async () => {
    const reminders = norm((await renderSettings()).reminders.textContent);
    expect(reminders).toContain('Reminders aren’t sent yet.');
    // The explanatory box sits further down the same card.
    expect(norm(app.textContent)).toContain(
      'Nothing is sent to you yet, in the app or on your phone. We’ll use these preferences when notifications launch.',
    );
  });

  it('keeps the reminder toggles, the time and the save button', async () => {
    const { page } = await renderSettings();
    for (const label of ['Period reminder', 'Fertile window', 'Ovulation day', 'Lab reminder', 'Intervention check-in']) {
      expect(page, label).toContain(label);
    }
    const toggles = Array.from(app.querySelectorAll('button')).filter(b => norm(b.textContent) === '');
    expect(toggles).toHaveLength(5);
    expect(app.querySelector('input[type="time"]')).not.toBeNull();
    expect(Array.from(app.querySelectorAll('button')).some(b => norm(b.textContent) === 'Save preferences')).toBe(true);
  });
});
