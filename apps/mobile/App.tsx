import React from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import {
  Calendar,
  FileText,
  Home,
  User as UserIcon,
} from 'lucide-react-native';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { Text } from './src/components';
import { useNotificationSync } from './src/hooks/useNotificationSync';
import { navigationLinking } from './src/navigation/linking';
import { navigationRef } from './src/navigation/rootNavigation';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { ReportsListScreen } from './src/screens/ReportsListScreen';
import { ReportDetailScreen } from './src/screens/ReportDetailScreen';
import { TrackerScreen } from './src/screens/TrackerScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { UploadReportScreen } from './src/screens/UploadReportScreen';
import { BillingScreen } from './src/screens/BillingScreen';
import { LoginScreen } from './src/screens/auth/LoginScreen';
import { ResetPasswordScreen } from './src/screens/auth/ResetPasswordScreen';
import { SignupScreen } from './src/screens/auth/SignupScreen';
import { theme } from './src/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const MAIN_TABS_ROUTE = 'MainTabs';

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

function MainTabsNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="Dashboard"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.mutedText3,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ color, size }) => {
          switch (route.name) {
            case 'Dashboard':
              return <Home size={size} color={color} />;
            case 'Tracker':
              return <Calendar size={size} color={color} />;
            case 'Reports':
              return <FileText size={size} color={color} />;
            case 'Settings':
              return <UserIcon size={size} color={color} />;
            default:
              return null;
          }
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarLabel: 'Dashboard' }}
      />
      <Tab.Screen
        name="Tracker"
        component={TrackerScreen}
        options={{ tabBarLabel: 'Tracker' }}
      />
      <Tab.Screen
        name="Reports"
        component={ReportsListScreen}
        options={{ tabBarLabel: 'Reports' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarLabel: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

function AuthenticatedNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name={MAIN_TABS_ROUTE} component={MainTabsNavigator} />
      <Stack.Screen name="UploadReport" component={UploadReportScreen} />
      <Stack.Screen name="ReportDetail" component={ReportDetailScreen} />
      <Stack.Screen name="Billing" component={BillingScreen} />
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
    <NavigationContainer
      ref={navigationRef}
      linking={navigationLinking}
      theme={navigationTheme}
    >
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
        <AuthenticatedNavigator />
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
  tabBar: {
    height: 72,
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderTopWidth: theme.borders.thin,
    borderTopColor: theme.colors.border,
  },
  tabLabel: {
    fontSize: theme.typography.size.xs,
    fontWeight: theme.typography.weight.semibold,
  },
});
