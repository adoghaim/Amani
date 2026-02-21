import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Heart } from 'lucide-react';

export function ResetPassword() {
  const { isPasswordRecovery, user, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [waitingForSession, setWaitingForSession] = useState(false);

  const hasCodeInUrl = (() => {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    return params.has('code') || hash.includes('access_token') || hash.includes('type=recovery');
  })();

  useEffect(() => {
    if (hasCodeInUrl && !loading && !user && !isPasswordRecovery) {
      setWaitingForSession(true);
      const timer = setTimeout(() => {
        setWaitingForSession(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
    if (user || isPasswordRecovery) {
      setWaitingForSession(false);
    }
  }, [hasCodeInUrl, loading, user, isPasswordRecovery]);

  const handleSubmit = async (e: React.FormEvent) => {
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
      setTimeout(() => {
        window.location.href = '/login';
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || waitingForSession) {
    return (
      <div className="min-h-screen bg-theme-background flex items-center justify-center px-4">
        <div className="text-theme-muted-text">Loading...</div>
      </div>
    );
  }

  const hasValidSession = isPasswordRecovery || user != null;

  if (!hasValidSession) {
    return (
      <div className="min-h-screen bg-theme-background flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <Card>
            <div className="text-center space-y-4">
              <div className="text-red-600 font-medium">Invalid or expired reset link</div>
              <p className="text-sm text-theme-muted-text">
                This password reset link is invalid or has expired. Please request a new one.
              </p>
              <Button onClick={() => window.location.href = '/login'} className="w-full">
                Back to login
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-theme-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Heart className="w-8 h-8 text-theme-primary fill-theme-primary" />
            <span className="text-2xl font-semibold text-theme-text">Amani</span>
          </div>
          <h1 className="text-3xl font-bold text-theme-text">
            Reset your password
          </h1>
        </div>

        <Card>
          {success ? (
            <div className="text-center space-y-4">
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
                Password updated successfully! Redirecting to login...
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
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
