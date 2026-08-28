import { Link, useLocation } from 'react-router-dom';
import { Button } from '../components/Button';
import { AmaniLogo } from '../components/AmaniLogo';
import { useAuth } from '../contexts/AuthContext';

/**
 * Catch-all for unmatched routes.
 *
 * Without this, a typo under /app/* fell through every <Route> and rendered
 * nothing — the Suspense fallback with no lazy import to resolve, so the user
 * sat on a blank screen indefinitely with no way back.
 *
 * It is also the backstop for stale links. That was not hypothetical: every
 * "you need to pay" branch in src/utils/subscription.ts used to navigate to
 * /billing, a route that was never declared, so lapsed subscribers were sent
 * straight into the blank screen. That is fixed at the source now, but a
 * mistyped URL, an old email link, or a route renamed in a future refactor
 * should still land somewhere that explains itself.
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
        <AmaniLogo markOnly size="md" className="mb-6" />
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-theme-muted-text-3 mb-3">
          Error 404
        </p>
        <h1 className="text-3xl mb-3">This page doesn&rsquo;t exist</h1>
        <p className="text-theme-muted-text-2 mb-2">
          Nothing lives at{' '}
          <code className="font-mono text-sm text-theme-text break-all">{location.pathname}</code>.
        </p>
        {/* A 404 in a health app can read as "my results are gone". Say plainly that they are not. */}
        <p className="text-theme-muted-text-2 mb-8">
          It may have moved, or the link may have been mistyped. Nothing has happened to
          your data.
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

        <div className="flex flex-wrap gap-5 mt-8 text-sm text-theme-muted-text-2">
          {user ? (
            <Link to="/app/settings" className="hover:text-theme-text transition-colors">
              Settings
            </Link>
          ) : (
            <>
              <Link to="/login" className="hover:text-theme-text transition-colors">
                Log in
              </Link>
              <Link to="/pricing" className="hover:text-theme-text transition-colors">
                Pricing
              </Link>
            </>
          )}
          <Link to="/contact" className="hover:text-theme-text transition-colors">
            Contact us
          </Link>
        </div>
      </div>
    </div>
  );
}
