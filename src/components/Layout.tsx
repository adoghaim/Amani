import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './Button';
import { AmaniLogo } from './AmaniLogo';
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
    <div className="min-h-screen bg-theme-background">
      {/* ── Desktop top nav ──────────────────────────────────────────────── */}
      <nav className="hidden sm:block bg-theme-surface border-b border-theme-border shadow-sm safe-top">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <NavLink to="/app" aria-label="Amani dashboard">
              <AmaniLogo size="md" />
            </NavLink>
            <div className="flex items-center gap-6">
              {NAV_LINKS.map(({ to, label, exact }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={exact}
                  className={({ isActive }) =>
                    isActive
                      ? 'text-theme-primary font-medium transition-colors'
                      : 'text-theme-muted-text hover:text-theme-primary transition-colors'
                  }
                >
                  {label}
                </NavLink>
              ))}
              <Button variant="ghost" size="sm" onClick={signOut}>
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Mobile top bar ───────────────────────────────────────────────── */}
      <header className="sm:hidden bg-theme-surface border-b border-theme-border shadow-sm safe-top">
        <div className="flex items-center justify-between px-4 h-14">
          <NavLink to="/app" aria-label="Amani dashboard">
            <AmaniLogo size="sm" />
          </NavLink>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="p-2 rounded-lg text-theme-muted-text hover:text-theme-text hover:bg-theme-background transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      {/* Extra bottom padding on mobile so content clears the bottom nav */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 pb-24 sm:pb-10">
        {children}
      </main>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-theme-surface border-t border-theme-border safe-bottom z-50">
        <div className="flex items-stretch h-16">
          {NAV_LINKS.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center flex-1 gap-0.5 text-[10px] font-medium transition-colors ${
                  isActive
                    ? 'text-theme-primary'
                    : 'text-theme-muted-text'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.5]'}`} />
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
