import React, { useState } from 'react'
import { isNative } from '../../lib/native'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../Button'
import { Input } from '../Input'
import { Alert } from '../Alert'
import { SocialAuthButton } from './SocialAuthButton'

interface LoginFormProps {
  onSuccess?: () => void
}

const APPLE_OAUTH_ENABLED = import.meta.env.VITE_ENABLE_APPLE_OAUTH === 'true'

export function LoginForm({ onSuccess }: LoginFormProps) {
  const { signInWithGoogle, signInWithApple } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) {
        setError(error.message)
      } else {
        onSuccess?.()
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleOAuth = async (action: () => Promise<void>) => {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert type="error">
          {error}
        </Alert>
      )}

      {!isNative() && (
        <>
          <div className="space-y-2">
            <SocialAuthButton
              provider="google"
              label="Continue with Google"
              onClick={() => handleOAuth(signInWithGoogle)}
            />
            {APPLE_OAUTH_ENABLED && (
              <SocialAuthButton
                provider="apple"
                label="Continue with Apple"
                onClick={() => handleOAuth(signInWithApple)}
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-theme-border" />
            <span className="text-xs text-theme-muted-text">or continue with email</span>
            <div className="flex-1 h-px bg-theme-border" />
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />

        <Button
          type="submit"
          loading={loading}
          className="w-full"
        >
          Sign in
        </Button>
      </form>

      {/* The app has no Google or Apple sign-in, and an account created that way has no password. */}
      {isNative() && (
        <p className="text-xs text-theme-muted-text text-center leading-relaxed">
          Signed up with Google on the website? The app signs in with email and password. Tap
          "Forgot your password?" below to set one for the same email, then sign in here.
        </p>
      )}
    </div>
  )
}
