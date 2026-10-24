import { ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { Loading } from './components/Loading'
import { ErrorBoundary, RouteErrorBoundary } from './components/ErrorBoundary'
import { FullScreenGate } from './components/FullScreenGate'
import { UNREACHABLE_SAFE_LINE, UNREACHABLE_TITLE } from './components/CalmNotice'
import { OnboardingGate } from './components/OnboardingGate'
import { AndroidBackHandler } from './components/AndroidBackHandler'
import { UpdateGate } from './components/UpdateGate'
import { UploadGate } from './components/freemium/UploadGate'
import { ConsentGate } from './features/consent/ConsentGate'
import { AdultsOnlyExit } from './features/consent/AdultsOnlyExit'
import { ADULTS_ONLY_PATH } from './features/consent/ConsentSteps'
import { isNative, onAppLifecycle, onAppUrlOpen, onNetworkChange } from './lib/native'
import { deepLinkTarget } from './lib/deepLinks'
import { lazyWithRetry } from './lib/lazyWithRetry'
import { safeRedirectTarget } from './lib/redirect'
import { CampaignLinkRedirect, FirstPartyEventsLifecycle } from './components/FirstPartyEventsLifecycle'
import { DeviceLockGate } from './features/deviceLock/DeviceLockGate'
import { Ga4Analytics } from './components/analytics/Ga4Analytics'

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
// Dev-only pages exist only under import.meta.env.DEV: a lazy() declared
// unconditionally still ships its chunk, even with its route left unregistered.
const ParserDebugger = import.meta.env.DEV ? lazyWithRetry(() => import('./pages/ParserDebugger').then(m => ({ default: m.ParserDebugger }))) : null
const Onboarding    = lazyWithRetry(() => import('./pages/Onboarding'))
const Privacy        = lazyWithRetry(() => import('./pages/Privacy').then(m => ({ default: m.Privacy })))
const Terms          = lazyWithRetry(() => import('./pages/Terms').then(m => ({ default: m.Terms })))
const DeleteAccount  = lazyWithRetry(() => import('./pages/DeleteAccount').then(m => ({ default: m.DeleteAccount })))
const Contact        = lazyWithRetry(() => import('./pages/Contact').then(m => ({ default: m.Contact })))
const NotFound       = lazyWithRetry(() => import('./pages/NotFound').then(m => ({ default: m.NotFound })))
const DesignGallery = import.meta.env.DEV ? lazyWithRetry(() => import('./pages/DesignGallery').then(m => ({ default: m.DesignGallery }))) : null

/*
  Every signed-in route. Gate order at launch: the update block (PK-MINVER-01)
  wraps DeviceLockGate (PK-DEVICE-01) around AppRoutes in App; then consent
  (PK-CONSENT-01, behind features.consent_gate); then
  onboarding (OnboardingGate inside the route, or the /onboarding route).
  `consentExempt` is for Settings only (withdrawal and deletion stay reachable).
*/
function ProtectedRoute({ children, consentExempt = false }: { children: ReactNode; consentExempt?: boolean }) {
  const { user, userProfile, profileLoadFailed, loading } = useAuth()
  // The router's location, not window.location: E2E-REDIRECT-RACE (F117).
  const location = useLocation()

  if (loading) {
    return <Loading />
  }

  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  // Every gate below waits for her profile; when it could not be read, say so.
  if (!userProfile && profileLoadFailed) {
    return <ProfileUnreachable />
  }

  return <ConsentGate exempt={consentExempt}>{children}</ConsentGate>
}

/*
  F065: her profile could not be read (offline, or the request failed). It
  used to leave an endless spinner. Try again here, and again by itself when
  the connection comes back or she returns to the app.
*/
function ProfileUnreachable() {
  const { refreshUserProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  const latestRefresh = useRef(refreshUserProfile)
  useEffect(() => { latestRefresh.current = refreshUserProfile })
  const inFlight = useRef(false)

  const retry = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    void latestRefresh.current().catch(() => {}).finally(() => {
      inFlight.current = false
      setBusy(false)
    })
  }, [])

  useEffect(() => {
    const stopNetwork = onNetworkChange(status => { if (status.connected) retry() })
    const stopLifecycle = onAppLifecycle({ onPause: () => {}, onResume: retry })
    return () => {
      stopNetwork()
      stopLifecycle()
    }
  }, [retry])

  return (
    <FullScreenGate
      heading={UNREACHABLE_TITLE}
      sentence={UNREACHABLE_SAFE_LINE}
      primary={{ label: 'Try again', onClick: retry, busy }}
    />
  )
}

export function AppRoutes() {
  const { loading, user } = useAuth()
  // E2E-REDIRECT-RACE (F117): the router commits a navigation in a transition,
  // so while the next screen loads window.location is already ahead of the
  // screen on show. Read the redirect from the router's location instead.
  const { search } = useLocation()

  if (loading) {
    return <Loading />
  }

  const redirectTarget = safeRedirectTarget(new URLSearchParams(search).get('redirect'))

  return (
    <Suspense fallback={<Loading />}>
      {/* F072: one error boundary per screen, keyed by its path. Inside Suspense,
          so a navigation keeps the current screen while the next one loads. */}
      <RouteErrorBoundary>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={user ? <Navigate to={redirectTarget} replace /> : <LoginPage />} />
          <Route path="/signup" element={user ? <Navigate to={redirectTarget} replace /> : <SignupPage />} />
          {/* PK-EXP5 campaign link (D17, D29): captures the key when first-party events are on, then signup. */}
          <Route path="/go/:key" element={<CampaignLinkRedirect />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/success" element={<SuccessPage />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Public and unauthenticated on purpose: App Store Review 3.1.2(a)
              requires the Privacy and Terms links in the binary to resolve, and
              they have to work for someone deciding whether to sign up at all. */}
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/contact" element={<Contact />} />
          {/* Google Play requires the account-deletion URL to be readable without
              signing in — a reviewer, or someone locked out of their account, has
              to be able to reach it. Linking to /app/settings instead would
              bounce a signed-out visitor to the login screen. */}
          <Route path="/delete-account" element={<DeleteAccount />} />
          {/* D13: the under-18 exit, shown after the account is erased and signed out. Local state only. */}
          <Route path={ADULTS_ONLY_PATH} element={<AdultsOnlyExit />} />

          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

          <Route path="/app" element={<ProtectedRoute><OnboardingGate><Dashboard /></OnboardingGate></ProtectedRoute>} />
          <Route path="/app/pricing" element={<ProtectedRoute><OnboardingGate><PricingPage /></OnboardingGate></ProtectedRoute>} />
          {/* Flag on, uploading is part of Free: auth + onboarding only. See lib/freemium/gates.ts. */}
          <Route path="/app/new" element={<ProtectedRoute><OnboardingGate><UploadGate><NewReport /></UploadGate></OnboardingGate></ProtectedRoute>} />
          <Route path="/app/reports" element={<ProtectedRoute><OnboardingGate><Reports /></OnboardingGate></ProtectedRoute>} />
          <Route path="/app/reports/:id" element={<ProtectedRoute><OnboardingGate><ReportView /></OnboardingGate></ProtectedRoute>} />
          <Route path="/app/tracker" element={<ProtectedRoute><OnboardingGate><Tracker /></OnboardingGate></ProtectedRoute>} />
          <Route path="/app/billing" element={<ProtectedRoute><OnboardingGate><Billing /></OnboardingGate></ProtectedRoute>} />
          <Route path="/app/settings" element={<ProtectedRoute consentExempt><OnboardingGate><Settings /></OnboardingGate></ProtectedRoute>} />
          {DesignGallery && (
            <Route path="/dev/design" element={<DesignGallery />} />
          )}
          {ParserDebugger && (
            <Route path="/dev/parser/:id" element={<ProtectedRoute><OnboardingGate><ParserDebugger /></OnboardingGate></ProtectedRoute>} />
          )}

          {/* Last, so it only catches what no other route matched. Without it an
              unmatched path rendered null — a typo under /app/* sat on an empty
              Suspense boundary forever, with no way back. Keep this last. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </RouteErrorBoundary>
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

function App() {
  return (
    <Router>
      <AndroidBackHandler />
      <DeepLinkHandler />
      <FirstPartyEventsLifecycle />
      {/* GA4: off unless VITE_GA4_ID is set; public marketing pages only, after analytics consent. */}
      <Ga4Analytics />
      <ErrorBoundary>
        {/* PK-MINVER-01 (D8): native only, and first in the launch gate order:
            the update block, then the biometric lock, then consent and the
            rest of onboarding. The lock mounts inside UpdateGate; both pass through on web. */}
        <UpdateGate>
          <DeviceLockGate>
            <AppRoutes />
          </DeviceLockGate>
        </UpdateGate>
      </ErrorBoundary>
    </Router>
  )
}

export default App
