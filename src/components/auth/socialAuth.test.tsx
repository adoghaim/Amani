import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { isNative } from '../../lib/native'

vi.mock('../../lib/native', () => ({ isNative: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    refreshUserProfile: vi.fn(),
  }),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe.each(['LoginForm', 'SignupForm'] as const)('%s social login', (formName) => {
  it.each([
    { native: false, apple: 'true', googleVisible: true, appleVisible: true },
    { native: false, apple: 'false', googleVisible: true, appleVisible: false },
    { native: false, apple: undefined, googleVisible: true, appleVisible: false },
    { native: true, apple: 'true', googleVisible: false, appleVisible: false },
    { native: true, apple: 'false', googleVisible: false, appleVisible: false },
    { native: true, apple: undefined, googleVisible: false, appleVisible: false },
  ])('native=$native, Apple flag=$apple', async ({ native, apple, googleVisible, appleVisible }) => {
    vi.resetModules()
    vi.stubEnv('VITE_ENABLE_APPLE_OAUTH', apple)
    vi.mocked(isNative).mockReturnValue(native)
    // Re-import because the Apple flag is intentionally read at module load.
    const Form = formName === 'LoginForm'
      ? (await import('./LoginForm')).LoginForm
      : (await import('./SignupForm')).SignupForm
    const html = renderToStaticMarkup(<StaticRouter location="/login"><Form /></StaticRouter>)

    expect(html.includes('aria-label="Continue with Google"')).toBe(googleVisible)
    expect(html.includes('aria-label="Continue with Apple"')).toBe(appleVisible)
    expect(html.includes(formName === 'LoginForm' ? 'or continue with email' : 'or sign up with email')).toBe(!native)
    expect(html).toContain('type="email"')
    expect(html).toContain('type="password"')
    expect(html).toContain('type="submit"')
    if (formName === 'SignupForm') {
      expect(html).toContain('href="/terms"')
      expect(html).toContain('href="/privacy"')
    }
  })
})
