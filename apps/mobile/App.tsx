import React from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { Text } from './src/components';
import { useNotificationSync } from './src/hooks/useNotificationSync';
import { navigationRef } from './src/navigation/rootNavigation';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { LoginScreen } from './src/screens/auth/LoginScreen';
import { ResetPasswordScreen } from './src/screens/auth/ResetPasswordScreen';
import { SignupScreen } from './src/screens/auth/SignupScreen';
import { theme } from './src/theme';

const Stack = createNativeStackNavigator();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: theme.colors.background,
    card: theme.colors.surface,
    text: theme.colors.text,
    border: theme.colors.border,
    primary: theme.colors.primary,
  },
};

function LoadingScreen() {
  return (
    <SafeAreaView style={styles.loadingScreen} edges={['top', 'bottom']}>
      <View style={styles.loadingContent}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text variant="bodySm" tone="muted" style={styles.loadingText}>
          Preparing your account...
        </Text>
      </View>
    </SafeAreaView>
  );
}

function RecoveryNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="UpdatePassword">
        {() => <ResetPasswordScreen mode="update" />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login">
        {({ navigation }: any) => (
          <LoginScreen
            onShowSignup={() => navigation.navigate('Signup')}
            onShowResetPassword={() => navigation.navigate('ResetPassword')}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="Signup">
        {({ navigation }: any) => (
          <SignupScreen onShowLogin={() => navigation.goBack()} />
        )}
      </Stack.Screen>

      <Stack.Screen name="ResetPassword">
        {({ navigation }: any) => (
          <ResetPasswordScreen
            mode="request"
            onShowLogin={() => navigation.navigate('Login')}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function AppNavigator() {
  const { user, userProfile, loading, isPasswordRecovery, signOut } = useAuth();
  useNotificationSync();

  const needsOnboarding = Boolean(
    user &&
    !isPasswordRecovery &&
    (!userProfile?.age_range ||
      !userProfile?.default_cycle_length ||
      !userProfile?.default_period_length)
  );

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      {isPasswordRecovery ? (
        <RecoveryNavigator />
      ) : !user ? (
        <AuthNavigator />
      ) : needsOnboarding ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Onboarding">
            {() => <OnboardingScreen onSignOut={signOut} />}
          </Stack.Screen>
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <AppNavigator />
        <StatusBar style="dark" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  loadingText: {
    marginTop: theme.spacing.sm,
  },
});
