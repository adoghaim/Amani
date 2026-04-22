import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Lock, Mail } from 'lucide-react-native';
import { Button, Input, Notice, Text } from '../../components';
import { useAuth } from '../../contexts/AuthContext';
import { theme } from '../../theme';
import { AuthLayout } from './AuthLayout';

interface ResetPasswordScreenProps {
  mode?: 'request' | 'update';
  onShowLogin?: () => void;
}

export function ResetPasswordScreen({
  mode = 'request',
  onShowLogin,
}: ResetPasswordScreenProps) {
  const { resetPassword, updatePassword, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isUpdateMode = mode === 'update';

  const handleRequestReset = async () => {
    setError('');
    setSuccess('');

    if (!email.trim()) {
      setError('Enter the email address for your account.');
      return;
    }

    setLoading(true);
    try {
      await resetPassword(email.trim());
      setSuccess('Reset instructions were sent to your email.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send reset instructions.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    setError('');
    setSuccess('');

    if (!password.trim() || !confirmPassword.trim()) {
      setError('Enter and confirm your new password.');
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
      await updatePassword(password);
      setSuccess('Password updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update your password.');
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToLogin = async () => {
    if (isUpdateMode) {
      await signOut();
    }
    onShowLogin?.();
  };

  return (
    <AuthLayout
      title={isUpdateMode ? 'Set a new password' : 'Reset your password'}
      subtitle={
        isUpdateMode
          ? 'Choose a new password for your account.'
          : 'Enter your email and we will send you a reset link.'
      }
      footerLabel={isUpdateMode ? undefined : 'Remembered it?'}
      footerActionLabel={isUpdateMode ? undefined : 'Back to sign in'}
      onFooterActionPress={isUpdateMode ? undefined : onShowLogin}
    >
      <View style={styles.form}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {success ? <Notice tone="success">{success}</Notice> : null}

        {isUpdateMode ? (
          <>
            <Input
              label="New Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
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
              placeholder="Re-enter your password"
              leftIcon={<Lock size={18} color={theme.colors.mutedText} />}
            />

            {success ? (
              <Button
                label="Return to Sign In"
                onPress={handleReturnToLogin}
                fullWidth
              />
            ) : (
              <Button
                label="Update Password"
                onPress={handleUpdatePassword}
                loading={loading}
                fullWidth
              />
            )}
          </>
        ) : (
          <>
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

            <Button
              label="Send Reset Link"
              onPress={handleRequestReset}
              loading={loading}
              fullWidth
            />

            {success ? (
              <Text variant="bodySm" tone="muted">
                Open the link from your email on this device to continue in-app.
              </Text>
            ) : null}
          </>
        )}
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: theme.spacing.md,
  },
});
