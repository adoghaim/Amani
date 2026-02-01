import { useAuth } from '../contexts/AuthContext';
import { Button } from './Button';
import { Heart } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-theme-background">
      <nav className="bg-theme-surface border-b border-theme-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <Heart className="w-6 h-6 text-theme-primary fill-theme-primary" />
              <a href="/app" className="text-xl font-semibold text-theme-text">
                Amani
              </a>
            </div>
            <div className="flex items-center gap-6">
              <a href="/app" className="text-theme-muted-text hover:text-theme-primary transition-colors">
                Dashboard
              </a>
              <a href="/app/tracker" className="text-theme-muted-text hover:text-theme-primary transition-colors">
                Tracker
              </a>
              <a href="/app/billing" className="text-theme-muted-text hover:text-theme-primary transition-colors">
                Billing
              </a>
              <a href="/app/settings" className="text-theme-muted-text hover:text-theme-primary transition-colors">
                Settings
              </a>
              <Button variant="ghost" size="sm" onClick={signOut}>
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {children}
      </main>
    </div>
  );
}
