import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Heart } from 'lucide-react-native';
import { Card, Text } from '../../components';
import { theme } from '../../theme';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footerLabel?: string;
  footerActionLabel?: string;
  onFooterActionPress?: () => void;
}

export function AuthLayout({
  title,
  subtitle,
  children,
  footerLabel,
  footerActionLabel,
  onFooterActionPress,
}: AuthLayoutProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <Heart size={24} color={theme.colors.primary} fill={theme.colors.primary} />
            <Text variant="titleSm">Amani</Text>
          </View>

          <Card style={styles.card}>
            <Text variant="title" style={styles.title}>
              {title}
            </Text>
            <Text variant="bodySm" tone="muted" style={styles.subtitle}>
              {subtitle}
            </Text>
            {children}
          </Card>

          {footerLabel && footerActionLabel && onFooterActionPress ? (
            <View style={styles.footer}>
              <Text variant="bodySm" tone="muted">
                {footerLabel}{' '}
              </Text>
              <Pressable onPress={onFooterActionPress}>
                <Text variant="bodySm" tone="primary" weight="semibold">
                  {footerActionLabel}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.lg,
  },
  card: {
    width: '100%',
  },
  title: {
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    marginBottom: theme.spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: theme.spacing.lg,
  },
});
