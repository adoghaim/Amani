import { LoginForm } from '../components/auth/LoginForm'
import { safeRedirectTarget } from '../lib/redirect'
import { AuthShell } from '../components/auth/AuthShell'
import { Link, useNavigate } from 'react-router-dom'
import { clientFreemiumActive } from '../lib/tier'
import { FREEMIUM_COPY } from '../lib/freemium/copy'

export function LoginPage() {
  const navigate = useNavigate()
  const params = new URLSearchParams(window.location.search)
  const redirect = safeRedirectTarget(params.get('redirect'))

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        <>
          No account yet?{' '}
          <Link to="/signup" className="text-theme-primary hover:text-theme-primary-dark transition-colors font-medium">
            {clientFreemiumActive() ? FREEMIUM_COPY.auth.loginCreateAccount : 'Start a free trial'}
          </Link>
        </>
      }
      footer={
        <Link
          to="/reset-password"
          className="text-sm text-theme-muted-text hover:text-theme-text transition-colors"
        >
          Forgot your password?
        </Link>
      }
    >
      <LoginForm onSuccess={() => navigate(redirect)} />
    </AuthShell>
  )
}
