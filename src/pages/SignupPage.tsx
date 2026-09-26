import { SignupForm } from '../components/auth/SignupForm'
import { safeRedirectTarget } from '../lib/redirect'
import { AuthShell } from '../components/auth/AuthShell'
import { CycleMark } from '../components/CycleMark'
import { Link, useNavigate } from 'react-router-dom'
import { clientFreemiumActive } from '../lib/tier'
import { FREEMIUM_COPY } from '../lib/freemium/copy'

const INCLUDED = [
  'Seven days free, no card to start',
  'Every result read against your cycle',
  'Trends across all your past panels',
  'Questions to take to your appointment',
];

export function SignupPage() {
  const navigate = useNavigate()
  const params = new URLSearchParams(window.location.search)
  const redirect = safeRedirectTarget(params.get('redirect'))
  const freemium = clientFreemiumActive()
  const included = freemium ? FREEMIUM_COPY.auth.signupIncluded : INCLUDED

  return (
    <AuthShell
      title={freemium ? FREEMIUM_COPY.auth.signupTitle : 'Start your trial'}
      subtitle={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-theme-primary hover:text-theme-primary-dark transition-colors font-medium">
            Log in
          </Link>
        </>
      }
      aside={
        <ul className="space-y-3.5">
          {included.map(item => (
            <li key={item} className="flex items-baseline gap-3 text-theme-text-body border-b border-theme-border-inner pb-3.5">
              <CycleMark className="w-3.5 h-3.5 text-theme-primary shrink-0 translate-y-0.5" />
              {item}
            </li>
          ))}
        </ul>
      }
    >
      <SignupForm onSuccess={() => navigate(redirect)} />
    </AuthShell>
  )
}
