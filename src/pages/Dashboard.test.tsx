// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ user: { id: 'user-1' } }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: fixture.user, userProfile: null }) }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ entitled: true, source: 'trial', loading: false }) }));
vi.mock('../components/SubscriptionStatus', () => ({ SubscriptionStatus: () => null }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: () => {
    const query = { select: () => query, eq: () => query, order: async () => ({ data: [], error: null }) };
    return query;
  },
} }));
import { Dashboard } from './Dashboard';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('shows real prices without comparisons in the legacy pricing upsell', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', '');
  const app = document.createElement('div');
  document.body.append(app);
  const root = createRoot(app);
  try {
    await act(async () => root.render(<MemoryRouter><Dashboard /></MemoryRouter>));
    expect(app.textContent).toContain('$9.99 a month, or $99.99 a year');
    expect(app.innerHTML).not.toMatch(/line-through|\$19\.99|\$199\.99|Save \$20/);
  } finally {
    await act(async () => root.unmount());
    app.remove();
  }
});
