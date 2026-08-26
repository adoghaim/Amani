// Removed react
import { SignupForm } from '../components/auth/SignupForm'
import { safeRedirectTarget } from '../lib/redirect'
import { Link, useNavigate } from 'react-router-dom'
import { Heart, ArrowLeft } from 'lucide-react'

export function SignupPage() {
  const navigate = useNavigate()
  const params = new URLSearchParams(window.location.search)
  const redirect = safeRedirectTarget(params.get('redirect'))

  const handleSuccess = () => {
    navigate(redirect)
  }

  return (
    <div className="min-h-screen bg-theme-background flex flex-col">
      <nav className="bg-theme-surface border-b border-theme-border px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-theme-muted-text hover:text-theme-text transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
        <Link to="/" className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-theme-primary fill-theme-primary" />
          <span className="text-base font-semibold text-theme-text">Amani</span>
        </Link>
        <div className="w-28" />
      </nav>

      <div className="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="bg-theme-surface rounded-2xl border border-theme-border shadow-sm p-8">
            <div className="mb-8 text-center">
              <h1 className="text-2xl font-bold text-theme-text mb-1">
                Start your free trial
              </h1>
              <p className="text-sm text-theme-muted-text">
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-theme-primary hover:text-theme-primary-dark transition-colors">
                  Sign in
                </Link>
              </p>
            </div>

            <SignupForm onSuccess={handleSuccess} />
          </div>
        </div>
      </div>
    </div>
  )
}
