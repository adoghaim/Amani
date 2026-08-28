import { LoginForm } from '../components/auth/LoginForm'
import { safeRedirectTarget } from '../lib/redirect'
import { AuthShell } from '../components/auth/AuthShell'
import { Link, useNavigate } from 'react-router-dom'

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
            Start a free trial
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
