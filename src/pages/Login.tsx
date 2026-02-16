import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Heart } from 'lucide-react';

export function Login() {
  const { signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [showResetForm, setShowResetForm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn(email, password);
      window.location.href = '/app';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await resetPassword(email);
      setResetEmailSent(true);
    } catch (err) {
      setError('Failed to send reset email. Please check your email address.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-theme-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Heart className="w-8 h-8 text-theme-primary fill-theme-primary" />
            <span className="text-2xl font-semibold text-theme-text">Amani</span>
          </div>
          <h1 className="text-3xl font-bold text-theme-text">
            Welcome back
          </h1>
        </div>

        <Card>
          {!showResetForm ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />

              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Your password"
              />

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Signing in...' : 'Log in'}
              </Button>

              <button
                type="button"
                onClick={() => setShowResetForm(true)}
                className="w-full text-sm text-theme-muted-text hover:text-theme-text transition-colors"
              >
                Forgot your password?
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4">
              {resetEmailSent ? (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
                  Password reset email sent! Check your inbox.
                </div>
              ) : (
                <>
                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {error}
                    </div>
                  )}

                  <p className="text-sm text-theme-muted-text">
                    Enter your email address and we'll send you a link to reset your password.
                  </p>

                  <Input
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />

                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? 'Sending...' : 'Send reset link'}
                  </Button>
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowResetForm(false);
                  setResetEmailSent(false);
                  setError('');
                }}
                className="w-full text-sm text-theme-muted-text hover:text-theme-text transition-colors"
              >
                Back to login
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-sm text-theme-muted-text">
            Don't have an account?{' '}
            <a href="/signup" className="text-theme-primary hover:text-theme-primary-dark font-medium transition-colors">
              Start free trial
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
