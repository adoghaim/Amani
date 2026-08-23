import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CycleMark } from '../CycleMark';

interface AuthShellProps {
  title: string;
  /** Line under the title — usually the link to the opposite flow. */
  subtitle: React.ReactNode;
  children: React.ReactNode;
  /** Optional right-hand panel. Signup gets one because a new visitor is still
   *  deciding; login does not, because someone returning has already decided
   *  and selling to them is noise. */
  aside?: React.ReactNode;
  footer?: React.ReactNode;
}

export function AuthShell({ title, subtitle, children, aside, footer }: AuthShellProps) {
  return (
    <div className="min-h-dvh bg-theme-background flex flex-col">
      <nav className="border-b border-theme-border-inner safe-top">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-theme-muted-text hover:text-theme-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary rounded"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <Link to="/" className="flex items-center gap-2.5">
            <CycleMark className="w-5 h-5 text-theme-primary" />
            <span className="font-display text-lg text-theme-text">Amani</span>
          </Link>
          {/* Balances the back link so the mark sits optically centred. */}
          <span className="w-[52px]" aria-hidden="true" />
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center px-5 sm:px-8 py-12">
        <div className={
          aside
            // Fixed form column so the two halves sit next to each other rather
            // than drifting apart across a void, and top-aligned so the list
            // starts level with the form instead of floating mid-page.
            ? 'w-full max-w-3xl grid lg:grid-cols-[22rem_1fr] gap-12 lg:gap-14 items-start'
            : 'w-full max-w-sm'
        }>
          <div className="w-full max-w-sm">
            <h1 className="text-3xl mb-2">{title}</h1>
            <p className="text-sm text-theme-muted-text-2 mb-8">{subtitle}</p>
            {children}
            {footer && <div className="mt-6">{footer}</div>}
          </div>
          {aside && <div className="hidden lg:block pt-2">{aside}</div>}
        </div>
      </div>
    </div>
  );
}
