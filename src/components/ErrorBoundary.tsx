import { Component, ErrorInfo, ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { FullScreenGate, type GateSecondaryLink } from './FullScreenGate'
import { CalmNotice } from './CalmNotice'
import { isChunkLoadError, pageReload } from '../lib/lazyWithRetry'

export interface ErrorFallbackProps {
  error: Error
  /** Clears the error, so the children render again. */
  reset: () => void
}

interface Props {
  children: ReactNode
  /** Shown instead of the children. As a function it also gets the error and `reset`. */
  fallback?: ReactNode | ((props: ErrorFallbackProps) => ReactNode)
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Sentry is a no-op unless VITE_SENTRY_DSN is set (see
    // src/lib/observability/initSentry.ts), so the console line stays: it is
    // the only signal in dev and deploy previews. The componentStack below is
    // React component names, and it is scrubbed with the rest of the event.
    console.error('[ErrorBoundary]', error, info.componentStack)
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    })
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const { fallback } = this.props
    if (typeof fallback === 'function') return fallback({ error, reset: this.reset })
    if (fallback) return fallback

    // Outside any screen there may be no router: the link loads the dashboard afresh.
    return <ErrorScreen error={error} onRetry={this.reset} home={{ label: 'Go to dashboard', href: '/app' }} />
  }
}

/**
 * Where a screen that failed to render leaves her (F072; DESIGN.md
 * full-screen-gate and calm-notice): Try again, or the dashboard. When the
 * screen's code failed to load, React keeps that error, so Try again reloads.
 */
function ErrorScreen({ error, onRetry, home }: { error: Error; onRetry: () => void; home: GateSecondaryLink }) {
  return (
    <FullScreenGate
      heading="We couldn't show this screen"
      sentence="Try again, or go to your dashboard."
      notice={<CalmNotice title="Something went wrong while opening it." />}
      primary={{ label: 'Try again', onClick: () => (isChunkLoadError(error) ? pageReload.reload() : onRetry()) }}
      secondary={home}
    />
  )
}

/**
 * One boundary per screen (F072). Keyed by the path, so leaving the screen
 * (a link, or Android back) clears its error.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <ErrorBoundary
      key={pathname}
      fallback={({ error, reset }) => (
        <ErrorScreen
          error={error}
          onRetry={reset}
          // On the dashboard itself the path does not change, so reset as well.
          home={{ label: 'Go to dashboard', onClick: () => { navigate('/app'); reset() } }}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  )
}
