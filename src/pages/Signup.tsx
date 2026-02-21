import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Heart } from 'lucide-react';

export function Signup() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signUp(email, password);
      window.location.href = '/app';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
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
          <h1 className="text-3xl font-bold text-theme-text mb-2">
            Start your free trial
          </h1>
          <p className="text-theme-muted-text">
            7 days free, then $9.99/month
          </p>
        </div>

        <Card>
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
              placeholder="At least 6 characters"
              minLength={6}
            />

            <div className="text-sm text-theme-muted-text">
              By signing up, you agree that Amani provides educational information only and does not provide medical advice or diagnoses.
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Creating account...' : 'Start free trial'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-theme-muted-text">
            Already have an account?{' '}
            <a href="/login" className="text-theme-primary hover:text-theme-primary-dark font-medium transition-colors">
              Log in
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
