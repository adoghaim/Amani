import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Heart } from 'lucide-react';

export function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validSession, setValidSession] = useState<boolean | null>(null);

  useEffect(() => {
    let resolved = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        resolved = true;
        setValidSession(true);
      }
    });

    const hashParams = new URLSearchParams(window.location.hash.replace('#', '?').slice(1));
    const type = hashParams.get('type');
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    if (type === 'recovery' && accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
        if (!error) {
          resolved = true;
          setValidSession(true);
        } else {
          if (!resolved) setValidSession(false);
        }
      });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          resolved = true;
          setValidSession(true);
        } else {
          setTimeout(() => {
            if (!resolved) setValidSession(false);
          }, 2000);
        }
      });
    }

    return () => subscription.unsubscribe();
  }, []);

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

    setLoading(true);

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
      setLoading(false);
    }
  };

  if (validSession === null) {
    return (
      <div className="min-h-screen bg-theme-background flex items-center justify-center px-4">
        <div className="text-theme-muted-text">Loading...</div>
      </div>
    );
  }

  if (!validSession) {
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

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Updating...' : 'Update password'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
