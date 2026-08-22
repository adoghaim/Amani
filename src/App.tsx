import { ReactNode, Suspense, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { Loading } from './components/Loading'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OnboardingGate } from './components/OnboardingGate'
import { SubscriptionGate } from './components/SubscriptionGate'
import { isNative, onAppUrlOpen } from './lib/native'
import { deepLinkTarget } from './lib/deepLinks'
import { lazyWithRetry } from './lib/lazyWithRetry'

// Eagerly loaded — tiny pages used immediately on arrival
import { Landing } from './pages/Landing'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'

// Lazy-loaded — heavy pages, only fetched when the user navigates to them.
// Wrapped with lazyWithRetry so a stale-bundle chunk-load failure after a
// deploy triggers exactly one reload instead of a permanent stuck Suspense.
const SuccessPage    = lazyWithRetry(() => import('./pages/SuccessPage').then(m => ({ default: m.SuccessPage })))
const ResetPassword  = lazyWithRetry(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPassword })))
const Dashboard      = lazyWithRetry(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })))
const PricingPage    = lazyWithRetry(() => import('./pages/PricingPage').then(m => ({ default: m.PricingPage })))
const NewReport      = lazyWithRetry(() => import('./pages/NewReport').then(m => ({ default: m.NewReport })))
const Reports        = lazyWithRetry(() => import('./pages/Reports').then(m => ({ default: m.Reports })))
const ReportView     = lazyWithRetry(() => import('./pages/ReportView').then(m => ({ default: m.ReportView })))
const Tracker        = lazyWithRetry(() => import('./pages/Tracker').then(m => ({ default: m.Tracker })))
const Billing        = lazyWithRetry(() => import('./pages/Billing').then(m => ({ default: m.Billing })))
const Settings       = lazyWithRetry(() => import('./pages/Settings').then(m => ({ default: m.Settings })))
const ParserDebugger = lazyWithRetry(() => import('./pages/ParserDebugger').then(m => ({ default: m.ParserDebugger })))
const Onboarding    = lazyWithRetry(() => import('./pages/Onboarding'))
const enableParserDebugger = import.meta.env.DEV

function safeRedirectTarget(raw: string | null): string {
  if (!raw) return '/app'
  // Reject anything that isn't an internal path: must start with a single "/",
  // not "//" (protocol-relative), and not contain ":" or "@" (absolute URL or userinfo).
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/app'
  if (raw.includes(':') || raw.includes('@')) return '/app'
  return raw
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <Loading />
  }

  if (!user) {
    const redirect = encodeURIComponent(window.location.pathname + window.location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  const { loading, user } = useAuth()

  if (loading) {
    return <Loading />
  }

  const redirectTarget = safeRedirectTarget(new URLSearchParams(window.location.search).get('redirect'))

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={user ? <Navigate to={redirectTarget} replace /> : <LoginPage />} />
        <Route path="/signup" element={user ? <Navigate to={redirectTarget} replace /> : <SignupPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

        <Route path="/app" element={<ProtectedRoute><OnboardingGate><Dashboard /></OnboardingGate></ProtectedRoute>} />
        <Route path="/app/pricing" element={<ProtectedRoute><OnboardingGate><PricingPage /></OnboardingGate></ProtectedRoute>} />
        <Route path="/app/new" element={<ProtectedRoute><OnboardingGate><SubscriptionGate><NewReport /></SubscriptionGate></OnboardingGate></ProtectedRoute>} />
        <Route path="/app/reports" element={<ProtectedRoute><OnboardingGate><Reports /></OnboardingGate></ProtectedRoute>} />
        <Route path="/app/reports/:id" element={<ProtectedRoute><OnboardingGate><ReportView /></OnboardingGate></ProtectedRoute>} />
        <Route path="/app/tracker" element={<ProtectedRoute><OnboardingGate><Tracker /></OnboardingGate></ProtectedRoute>} />
        <Route path="/app/billing" element={<ProtectedRoute><OnboardingGate><Billing /></OnboardingGate></ProtectedRoute>} />
        <Route path="/app/settings" element={<ProtectedRoute><OnboardingGate><Settings /></OnboardingGate></ProtectedRoute>} />
        {enableParserDebugger && (
          <Route path="/dev/parser/:id" element={<ProtectedRoute><OnboardingGate><ParserDebugger /></OnboardingGate></ProtectedRoute>} />
        )}
      </Routes>
    </Suspense>
  )
}

/**
 * Routes inbound universal/app links into the SPA.
 *
 * Without this the OS opens the app but leaves it on whatever screen it was
 * last on, so a password-reset or Stripe-return link appears to do nothing.
 * Unclaimed URLs are ignored rather than navigated to — see deepLinkTarget.
 */
function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative()) return;

    return onAppUrlOpen((url) => {
      const target = deepLinkTarget(url);
      if (target) navigate(target, { replace: true });
    });
  }, [navigate]);

  return null;
}

function AndroidBackHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isNative()) return;

    let handle: { remove: () => void } | null = null;

    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('backButton', ({ canGoBack }) => {
        // At root routes — exit the app rather than navigating back to a blank state
        const rootRoutes = ['/app', '/login', '/signup', '/', '/pricing', '/success', '/reset-password'];
        if (rootRoutes.includes(location.pathname) || !canGoBack) {
          CapApp.exitApp();
        } else {
          navigate(-1);
        }
      }).then(h => { handle = h; });
    });

    return () => { handle?.remove(); };
  }, [location.pathname, navigate]);

  return null;
}

function App() {
  return (
    <Router>
      <AndroidBackHandler />
      <DeepLinkHandler />
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    </Router>
  )
}

export default App
