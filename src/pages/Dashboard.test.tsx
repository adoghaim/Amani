// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  user: { id: 'user-1' },
  // Tables whose read cannot reach the server, as postgrest-js answers that:
  // it resolves { data: null, error } and does not throw.
  failing: new Set<string>(),
  reads: [] as string[],
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: fixture.user, userProfile: null }) }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ entitled: true, source: 'trial', loading: false }) }));
vi.mock('../components/SubscriptionStatus', () => ({ SubscriptionStatus: () => null }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query,
      order: async () => {
        fixture.reads.push(table);
        return fixture.failing.has(table)
          ? { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } }
          : { data: [], error: null };
      },
    };
    return query;
  },
} }));
import { Dashboard } from './Dashboard';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fixture.failing.clear();
  fixture.reads = [];
});

async function withDashboard(run: (app: HTMLDivElement) => Promise<void>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', '');
  const app = document.createElement('div');
  document.body.append(app);
  const root = createRoot(app);
  try {
    await act(async () => root.render(<MemoryRouter><Dashboard /></MemoryRouter>));
    await run(app);
  } finally {
    await act(async () => root.unmount());
    app.remove();
  }
}
const button = (app: HTMLElement, label: string) =>
  Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === label) ?? null;

it('shows real prices without comparisons in the legacy pricing upsell', async () => {
  await withDashboard(async app => {
    expect(app.textContent).toContain('$9.99 a month, or $99.99 a year');
    expect(app.innerHTML).not.toMatch(/line-through|\$19\.99|\$199\.99|Save \$20/);
  });
});

// Review F065: offline, every read resolved { data: null, error } and the page
// turned that into [] — "No lab reports yet" for someone whose reports are fine.
describe('a dashboard read that could not reach Amani', () => {
  it('is a load failure with Try again, never the first-run empty state', async () => {
    for (const table of ['lab_reports', 'period_logs', 'symptom_logs', 'interventions']) fixture.failing.add(table);
    await withDashboard(async app => {
      const notice = app.querySelector('[role="status"]');
      expect(notice?.textContent).toContain("We couldn't reach Amani");
      expect(notice?.textContent).toContain('Your reports are safe.');
      expect(button(app, 'Try again')).not.toBeNull();
      expect(app.textContent).not.toContain('No lab reports yet');
      expect(app.textContent).not.toContain('Upload your first lab report');
      // Nothing that reads as her data: no calendar, no today card, no rose error.
      expect(app.textContent).not.toContain('Recent lab reports');
      expect(app.textContent).not.toMatch(/Failed to fetch|Couldn't load your dashboard/);
    });
  });

  it('one failed read of the four is enough: the rest would show an account with nothing logged', async () => {
    fixture.failing.add('period_logs');
    await withDashboard(async app => {
      expect(app.textContent).toContain("We couldn't reach Amani");
      expect(app.textContent).not.toContain('Recent lab reports');
    });
  });

  it('Try again reads again; an account that really is empty then shows its first-run state', async () => {
    fixture.failing.add('lab_reports');
    await withDashboard(async app => {
      fixture.failing.clear();
      fixture.reads = [];
      await act(async () => button(app, 'Try again')!.click());
      expect(fixture.reads).toEqual(expect.arrayContaining(['lab_reports', 'period_logs', 'symptom_logs', 'interventions']));
      expect(app.textContent).not.toContain("We couldn't reach Amani");
      expect(app.textContent).toContain('No lab reports yet');
    });
  });

  it('an empty account that loaded is still the first-run state (control)', async () => {
    await withDashboard(async app => {
      expect(app.textContent).toContain('No lab reports yet');
      expect(app.textContent).not.toContain("We couldn't reach Amani");
    });
  });
});
