import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Mail, Lock } from 'lucide-react-native';
import { Button, Input, Notice, Text } from '../../components';
import { useAuth } from '../../contexts/AuthContext';
import { theme } from '../../theme';
import { AuthLayout } from './AuthLayout';

interface LoginScreenProps {
  onShowSignup: () => void;
  onShowResetPassword: () => void;
}

export function LoginScreen({
  onShowSignup,
  onShowResetPassword,
}: LoginScreenProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password to continue.');
      return;
    }

    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to review your labs, cycle insights, and saved reports."
      footerLabel="New here?"
      footerActionLabel="Create an account"
      onFooterActionPress={onShowSignup}
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
          autoComplete="password"
          placeholder="Enter your password"
          leftIcon={<Lock size={18} color={theme.colors.mutedText} />}
        />

        <Pressable onPress={onShowResetPassword}>
          <Text variant="bodySm" tone="primary" weight="semibold" style={styles.link}>
            Forgot your password?
          </Text>
        </Pressable>

        <Button
          label="Sign In"
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
  link: {
    textAlign: 'right',
  },
});
