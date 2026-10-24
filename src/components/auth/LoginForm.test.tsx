import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { isNative } from '../../lib/native'
import { LoginForm } from './LoginForm'

vi.mock('../../lib/native', () => ({ isNative: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ signInWithGoogle: vi.fn(), signInWithApple: vi.fn() }),
}))

afterEach(() => vi.clearAllMocks())

const render = () => renderToStaticMarkup(<StaticRouter location="/login"><LoginForm /></StaticRouter>)

it('F133: in the app, accounts created with Google on the web are told how to set a password', () => {
  vi.mocked(isNative).mockReturnValue(true)
  const html = render()
  expect(html).toContain('Signed up with Google on the website?')
  expect(html).toContain('Forgot your password?')
})

it('F133: the web keeps the Google button and shows no app-only guidance', () => {
  vi.mocked(isNative).mockReturnValue(false)
  const html = render()
  expect(html).toContain('aria-label="Continue with Google"')
  expect(html).not.toContain('Signed up with Google on the website?')
})
