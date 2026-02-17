import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { Dashboard } from './pages/Dashboard'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { PricingPage } from './pages/PricingPage'
import { SuccessPage } from './pages/SuccessPage'
import { NewReport } from './pages/NewReport'
import { ReportView } from './pages/ReportView'
import { Tracker } from './pages/Tracker'
import { Billing } from './pages/Billing'
import { Settings } from './pages/Settings'
import { Loading } from './components/Loading'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function App() {
  const { loading, user } = useAuth()

  if (loading) {
    return <Loading />
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/app" replace /> : <Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/success" element={<SuccessPage />} />

        <Route path="/app" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/app/new" element={<ProtectedRoute><NewReport /></ProtectedRoute>} />
        <Route path="/app/reports/:id" element={<ProtectedRoute><ReportView /></ProtectedRoute>} />
        <Route path="/app/tracker" element={<ProtectedRoute><Tracker /></ProtectedRoute>} />
        <Route path="/app/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
        <Route path="/app/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      </Routes>
    </Router>
  )
}

export default App