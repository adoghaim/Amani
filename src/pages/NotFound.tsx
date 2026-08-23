/*
  Catch-all for unmatched routes.
  Until this existed, `src/App.tsx` had no `<Route path="*">`, so any path the
  route table did not match rendered nothing at all — a white screen with no
  explanation and no way back. That was not a hypothetical: every "you need to
  pay" branch in `src/utils/subscription.ts` navigated to `/billing`, which was
  never a declared route, so lapsed subscribers were sent straight into it.

  That bug is fixed at the source, but a catch-all is the backstop: a mistyped
  URL, a stale link in an old email, or a route renamed in a future refactor
  should land somewhere that tells the user what happened.
*/

import { Heart, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';

export function NotFound() {
  const { user } = useAuth();

  // Signed-in users belong back in the app; everyone else at the front door.
  const homePath = user ? '/app' : '/';
  const homeLabel = user ? 'Back to your dashboard' : 'Back to home';

  return (
    <div className="min-h-screen bg-gradient-to-b from-theme-background to-theme-surface-2 flex flex-col">
      <nav className="bg-theme-surface border-b border-theme-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            <Link to={homePath} className="flex items-center gap-2">
              <Heart className="w-6 h-6 text-theme-primary fill-theme-primary" />
              <span className="text-xl font-semibold text-theme-text">Amani</span>
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-theme-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Compass className="w-8 h-8 text-theme-primary" />
          </div>

          <p className="text-sm font-semibold text-theme-muted-text uppercase tracking-wider mb-3">
            Page not found
          </p>
          <h1 className="text-3xl font-bold text-theme-text mb-3">
            This page doesn&rsquo;t exist
          </h1>
          <p className="text-theme-muted-text mb-8">
            The link may be out of date, or the address may have a typo in it. Nothing has
            happened to your data.
          </p>

          <Link to={homePath}>
            <Button size="lg" className="w-full sm:w-auto">
              {homeLabel}
            </Button>
          </Link>

          <div className="flex flex-wrap justify-center gap-5 mt-8 text-sm text-theme-muted-text">
            {user ? (
              <>
                <Link to="/app/reports" className="hover:text-theme-text transition-colors">
                  Your reports
                </Link>
                <Link to="/app/settings" className="hover:text-theme-text transition-colors">
                  Settings
                </Link>
              </>
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
      </main>
    </div>
  );
}
