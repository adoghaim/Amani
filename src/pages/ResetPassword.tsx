import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Heart } from 'lucide-react';

type PageState = 'loading' | 'ready' | 'request';

export function ResetPassword() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [pageState, setPageState] = useState<PageState>('loading');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [requestEmail, setRequestEmail] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [requestLoading, setRequestLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const hash = window.location.hash;
    const isHashRecovery = hash.includes('type=recovery') || hash.includes('access_token');

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          setPageState('request');
        } else {
          setPageState('ready');
        }
      });
      return;
    }

    if (isHashRecovery) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setPageState(session ? 'ready' : 'request');
      });
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setPageState(session ? 'ready' : 'request');
    });
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      await supabase.auth.signOut();
      setTimeout(() => { navigate('/login', { replace: true }); }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError('');
    setRequestLoading(true);
    try {
      await resetPassword(requestEmail);
      setRequestSent(true);
    } catch {
      setRequestError('Failed to send reset email. Please check your email address.');
    } finally {
      setRequestLoading(false);
    }
  };

  const logo = (
    <div className="text-center mb-8">
      <div className="flex items-center justify-center gap-2 mb-4">
        <Heart className="w-8 h-8 text-theme-primary fill-theme-primary" />
        <span className="text-2xl font-semibold text-theme-text">Amani</span>
      </div>
    </div>
  );

  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-theme-background flex items-center justify-center px-4">
        <div className="text-theme-muted-text">Verifying reset link...</div>
      </div>
    );
  }

  if (pageState === 'request') {
    return (
      <div className="min-h-screen bg-theme-background flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          {logo}
          <Card>
            {requestSent ? (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                  Password reset email sent! Check your inbox and click the link to set a new password.
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="w-full text-sm text-theme-muted-text hover:text-theme-text transition-colors"
                >
                  Back to login
                </button>
              </div>
            ) : (
              <form onSubmit={handleRequestReset} className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-theme-text mb-1">Reset your password</h2>
                  <p className="text-sm text-theme-muted-text">
                    Enter your email and we'll send you a reset link.
                  </p>
                </div>

                {requestError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {requestError}
                  </div>
                )}

                <Input
                  label="Email"
                  type="email"
                  value={requestEmail}
                  onChange={(e) => setRequestEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                />

                <Button type="submit" disabled={requestLoading} className="w-full">
                  {requestLoading ? 'Sending...' : 'Send reset link'}
                </Button>

                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="w-full text-sm text-theme-muted-text hover:text-theme-text transition-colors"
                >
                  Back to login
                </button>
              </form>
            )}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-theme-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {logo}
        <Card>
          {success ? (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
              Password updated successfully! Redirecting to login...
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-theme-text mb-1">Set new password</h2>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <Input
                label="New Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Enter new password"
              />

              <Input
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Confirm new password"
              />

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Updating...' : 'Update password'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
