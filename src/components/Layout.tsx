import { useAuth } from '../contexts/AuthContext';
import { Button } from './Button';
import { Heart } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <Heart className="w-6 h-6 text-teal-600" />
              <a href="/app" className="text-xl font-semibold text-gray-900">
                Amani
              </a>
            </div>
            <div className="flex items-center gap-4">
              <a href="/app" className="text-gray-600 hover:text-gray-900">
                Dashboard
              </a>
              <a href="/app/billing" className="text-gray-600 hover:text-gray-900">
                Billing
              </a>
              <a href="/app/settings" className="text-gray-600 hover:text-gray-900">
                Settings
              </a>
              <Button variant="ghost" size="sm" onClick={signOut}>
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
