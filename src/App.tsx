import React, { Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { Loading } from './components/Loading'

// Eagerly loaded — tiny pages used immediately on arrival
import { Landing } from './pages/Landing'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { ResetPassword } from './pages/ResetPassword'
import { SuccessPage } from './pages/SuccessPage'

// Lazy-loaded — heavy pages, only fetched when the user navigates to them
const Dashboard      = React.lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })))
const PricingPage    = React.lazy(() => import('./pages/PricingPage').then(m => ({ default: m.PricingPage })))
const NewReport      = React.lazy(() => import('./pages/NewReport').then(m => ({ default: m.NewReport })))
const Reports        = React.lazy(() => import('./pages/Reports').then(m => ({ default: m.Reports })))
const ReportView     = React.lazy(() => import('./pages/ReportView').then(m => ({ default: m.ReportView })))
const Tracker        = React.lazy(() => import('./pages/Tracker').then(m => ({ default: m.Tracker })))
const Billing        = React.lazy(() => import('./pages/Billing').then(m => ({ default: m.Billing })))
const Settings       = React.lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })))
const ParserDebugger = React.lazy(() => import('./pages/ParserDebugger').then(m => ({ default: m.ParserDebugger })))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
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

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/app" replace /> : <Landing />} />
        <Route path="/login" element={user ? <Navigate to={new URLSearchParams(window.location.search).get('redirect') || '/app'} replace /> : <LoginPage />} />
        <Route path="/signup" element={user ? <Navigate to={new URLSearchParams(window.location.search).get('redirect') || '/app'} replace /> : <SignupPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="/app" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/app/pricing" element={<ProtectedRoute><PricingPage /></ProtectedRoute>} />
        <Route path="/app/new" element={<ProtectedRoute><NewReport /></ProtectedRoute>} />
        <Route path="/app/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="/app/reports/:id" element={<ProtectedRoute><ReportView /></ProtectedRoute>} />
        <Route path="/app/tracker" element={<ProtectedRoute><Tracker /></ProtectedRoute>} />
        <Route path="/app/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
        <Route path="/app/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/dev/parser/:id" element={<ProtectedRoute><ParserDebugger /></ProtectedRoute>} />
      </Routes>
    </Suspense>
  )
}

function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  )
}

export default App
