import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './Button';
import { CycleMark } from './CycleMark';
import {
  LayoutDashboard,
  FileText,
  CalendarDays,
  CreditCard,
  Settings,
  LogOut,
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_LINKS = [
  { to: '/app',          label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/app/reports',  label: 'Reports',   icon: FileText },
  { to: '/app/tracker',  label: 'Tracker',   icon: CalendarDays },
  { to: '/app/billing',  label: 'Billing',   icon: CreditCard },
  { to: '/app/settings', label: 'Settings',  icon: Settings },
];

export function Layout({ children }: LayoutProps) {
  const { signOut } = useAuth();

  return (
    // dvh, not vh: inside the iOS webview 100vh includes browser chrome, so a
    // vh-based shell shifts as the bar hides.
    <div className="min-h-dvh bg-theme-background">
      {/* ── Desktop top nav ──────────────────────────────────────────── */}
      <nav className="hidden sm:block bg-theme-surface border-b border-theme-border-inner safe-top">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <NavLink to="/app" className="flex items-center gap-2.5">
              <CycleMark className="w-6 h-6 text-theme-primary" />
              <span className="font-display text-xl text-theme-text">Amani</span>
            </NavLink>
            <div className="flex items-center gap-1">
              {NAV_LINKS.map(({ to, label, exact }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={exact}
                  className={({ isActive }) =>
                    [
                      'relative px-3 py-2 text-sm rounded-lg transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary',
                      isActive
                        ? 'text-theme-accent font-medium'
                        : 'text-theme-muted-text hover:text-theme-text hover:bg-theme-surface-2',
                    ].join(' ')
                  }
                >
                  {({ isActive }) => (
                    <>
                      {label}
                      {/* The active page is marked by a rule as well as colour.
                          Colour alone fails for anyone who cannot separate the
                          rose from the neutral text. */}
                      {isActive && (
                        <span className="absolute inset-x-3 -bottom-[13px] h-0.5 bg-theme-primary rounded-full" />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
              <Button variant="ghost" size="sm" onClick={signOut} className="ml-2">
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Mobile top bar ───────────────────────────────────────────── */}
      <header className="sm:hidden bg-theme-surface border-b border-theme-border-inner safe-top">
        <div className="flex items-center justify-between px-4 h-14">
          <span className="flex items-center gap-2">
            <CycleMark className="w-5 h-5 text-theme-primary" />
            <span className="font-display text-lg text-theme-text">Amani</span>
          </span>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-lg text-theme-muted-text hover:text-theme-text hover:bg-theme-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 pb-28 sm:pb-12">
        {children}
      </main>

      {/* ── Mobile bottom nav ────────────────────────────────────────── */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-theme-surface border-t border-theme-border-inner safe-bottom z-50">
        <div className="flex items-stretch">
          {NAV_LINKS.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                [
                  // 56px row: comfortably above the 44px minimum once the icon
                  // and label are stacked.
                  'relative flex flex-col items-center justify-center flex-1 gap-1 h-14 text-[10px] transition-colors',
                  isActive ? 'text-theme-accent font-medium' : 'text-theme-muted-text',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute top-0 inset-x-5 h-0.5 bg-theme-primary rounded-full" />
                  )}
                  <Icon className={`w-[22px] h-[22px] ${isActive ? 'stroke-[2.25]' : 'stroke-[1.5]'}`} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
