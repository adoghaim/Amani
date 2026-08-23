import { Link, useLocation } from 'react-router-dom';
import { Button } from '../components/Button';
import { CycleMark } from '../components/CycleMark';
import { useAuth } from '../contexts/AuthContext';

/**
 * Catch-all for unmatched routes.
 *
 * Without this, a typo under /app/* fell through every <Route> and rendered
 * nothing — the Suspense fallback with no lazy import to resolve, so the user
 * sat on a blank screen indefinitely with no way back.
 *
 * Sends signed-in users to the dashboard and everyone else to the landing
 * page, because "go home" means different places depending on who is asking.
 */
export function NotFound() {
  const { user } = useAuth();
  const location = useLocation();
  const home = user ? '/app' : '/';

  return (
    <div className="min-h-dvh bg-theme-background flex items-center justify-center px-5 safe-top safe-bottom">
      <div className="max-w-md w-full">
        <CycleMark className="w-8 h-8 text-theme-primary mb-6" />
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-theme-muted-text-3 mb-3">
          Error 404
        </p>
        <h1 className="text-3xl mb-3">This page doesn&rsquo;t exist</h1>
        <p className="text-theme-muted-text-2 mb-2">
          Nothing lives at{' '}
          <code className="font-mono text-sm text-theme-text break-all">{location.pathname}</code>.
        </p>
        <p className="text-theme-muted-text-2 mb-8">
          It may have moved, or the link may have been mistyped.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to={home}>
            <Button>{user ? 'Back to dashboard' : 'Back to home'}</Button>
          </Link>
          {user && (
            <Link to="/app/reports">
              <Button variant="outline">View your panels</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
