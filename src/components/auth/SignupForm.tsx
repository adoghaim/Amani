import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../Button'
import { Input } from '../Input'
import { Alert } from '../Alert'
import { SocialAuthButton } from './SocialAuthButton'

interface SignupFormProps {
  onSuccess?: () => void
}

const APPLE_OAUTH_ENABLED = import.meta.env.VITE_ENABLE_APPLE_OAUTH === 'true'

export function SignupForm({ onSuccess }: SignupFormProps) {
  const { refreshUserProfile, signInWithGoogle, signInWithApple } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: undefined // Disable email confirmation
        }
      })

      if (error) {
        setError(error.message)
      } else {
        // Create user profile
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('users').insert({
            id: user.id,
            email: user.email!
          })
        }
        // Re-fetch the profile to close a race where AuthContext's SIGNED_IN
        // listener queried the users table before this insert completed,
        // leaving userProfile null and OnboardingGate stuck on Loading.
        await refreshUserProfile()
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
      setError(err instanceof Error ? err.message : 'Sign up failed')
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert type="error">
          {error}
        </Alert>
      )}

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
        <span className="text-xs text-theme-muted-text">or sign up with email</span>
        <div className="flex-1 h-px bg-theme-border" />
      </div>

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
          autoComplete="new-password"
          minLength={6}
        />

        <Input
          label="Confirm Password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          minLength={6}
        />

        <Button
          type="submit"
          loading={loading}
          className="w-full"
        >
          Create Account
        </Button>
      </form>

      {/*
        Onboarding asks for reproductive status, symptoms and known conditions
        within a minute of this button, so the policies covering that have to
        be reachable before the account exists — not buried in Settings after.
        Worded to cover the OAuth buttons above as well as the email form, so
        one line does for every route into an account.

        A statement rather than a blocking checkbox: the checkbox is the right
        pattern when a specific separate consent is being captured, and adding
        one here would gate the OAuth buttons too, which sit above it. If a
        lawyer decides an explicit affirmative consent is required for health
        data, this is the place it goes, and `users.has_consented` already
        exists in the schema to record it.
      */}
      <p className="text-xs text-theme-muted-text text-center leading-relaxed">
        By creating an account — including with Google or Apple — you agree to our{' '}
        <Link to="/terms" className="text-theme-primary-dark underline hover:text-theme-accent">
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link to="/privacy" className="text-theme-primary-dark underline hover:text-theme-accent">
          Privacy Policy
        </Link>
        . Amani stores the lab results and health details you choose to share, and sends lab
        values to OpenAI to generate explanations. It is educational only and is not medical
        advice.
      </p>
    </div>
  )
}
