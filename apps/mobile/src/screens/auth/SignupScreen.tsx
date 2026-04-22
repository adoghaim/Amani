import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Lock, Mail } from 'lucide-react-native';
import { Button, Input, Notice } from '../../components';
import { useAuth } from '../../contexts/AuthContext';
import { theme } from '../../theme';
import { AuthLayout } from './AuthLayout';

interface SignupScreenProps {
  onShowLogin: () => void;
}

export function SignupScreen({ onShowLogin }: SignupScreenProps) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');

    if (!email.trim() || !password.trim() || !confirmPassword.trim()) {
      setError('Complete all fields to create your account.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await signUp(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create your account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start your free trial and set up your cycle-aware lab tracking."
      footerLabel="Already have an account?"
      footerActionLabel="Sign in"
      onFooterActionPress={onShowLogin}
    >
      <View style={styles.form}>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@example.com"
          leftIcon={<Mail size={18} color={theme.colors.mutedText} />}
        />

        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          placeholder="At least 6 characters"
          leftIcon={<Lock size={18} color={theme.colors.mutedText} />}
        />

        <Input
          label="Confirm Password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          placeholder="Re-enter your password"
          leftIcon={<Lock size={18} color={theme.colors.mutedText} />}
        />

        <Button
          label="Create Account"
          onPress={handleSubmit}
          loading={loading}
          fullWidth
        />
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: theme.spacing.md,
  },
});
