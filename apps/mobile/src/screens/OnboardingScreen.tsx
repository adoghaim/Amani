import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AGE_RANGE_OPTIONS,
  DEFAULT_CYCLE_LENGTH,
  DEFAULT_PERIOD_LENGTH,
  validateOnboardingProfile,
} from '@amani/shared';
import { Button, Card, Input, Notice, Text } from '../components';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

interface OnboardingScreenProps {
  onSignOut: () => Promise<void>;
}

export function OnboardingScreen({ onSignOut }: OnboardingScreenProps) {
  const { completeOnboarding, userProfile } = useAuth();
  const [ageRange, setAgeRange] = useState(userProfile?.age_range ?? '');
  const [cycleLength, setCycleLength] = useState(
    userProfile?.default_cycle_length
      ? String(userProfile.default_cycle_length)
      : String(DEFAULT_CYCLE_LENGTH)
  );
  const [periodLength, setPeriodLength] = useState(
    userProfile?.default_period_length
      ? String(userProfile.default_period_length)
      : String(DEFAULT_PERIOD_LENGTH)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedAge = useMemo(
    () => AGE_RANGE_OPTIONS.find((option) => option === ageRange) ?? null,
    [ageRange]
  );

  const handleSubmit = async () => {
    setError('');

    const cycleValue = Number(cycleLength);
    const periodValue = Number(periodLength);

    const validation = validateOnboardingProfile({
      ageRange: selectedAge,
      cycleLength: cycleValue,
      periodLength: periodValue,
    });

    if (!validation.valid) {
      setError(validation.error ?? 'Please review your profile details.');
      return;
    }

    setLoading(true);
    try {
      await completeOnboarding({
        ageRange,
        cycleLength: cycleValue,
        periodLength: periodValue,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save your profile.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text variant="title">Set up your profile</Text>
          <Text variant="bodySm" tone="muted" style={styles.subtitle}>
            We use these details to personalize cycle-aware insights and improve period prediction.
          </Text>
        </View>

        <Card>
          <View style={styles.section}>
            <Text variant="label">Age Range</Text>
            <View style={styles.chipGrid}>
              {AGE_RANGE_OPTIONS.map((option) => {
                const selected = option === selectedAge;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setAgeRange(option)}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                  >
                    <Text
                      variant="bodySm"
                      tone={selected ? 'inverse' : 'default'}
                      weight="semibold"
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Input
              label="Typical Cycle Length"
              value={cycleLength}
              onChangeText={setCycleLength}
              keyboardType="number-pad"
              placeholder="28"
              hint="Usually 21 to 40 days."
            />

            <Input
              label="Typical Period Length"
              value={periodLength}
              onChangeText={setPeriodLength}
              keyboardType="number-pad"
              placeholder="5"
              hint="Usually 2 to 10 days."
            />
          </View>

          {error ? <Notice tone="error" style={styles.notice}>{error}</Notice> : null}

          <View style={styles.actions}>
            <Button
              label="Save and Continue"
              onPress={handleSubmit}
              loading={loading}
              fullWidth
            />
            <Button
              label="Sign Out"
              onPress={() => {
                void onSignOut();
              }}
              variant="ghost"
              fullWidth
            />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
  },
  header: {
    marginBottom: theme.spacing.lg,
  },
  subtitle: {
    marginTop: theme.spacing.xs,
  },
  section: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    minWidth: 88,
    borderRadius: theme.radii.pill,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  notice: {
    marginBottom: theme.spacing.lg,
  },
  actions: {
    gap: theme.spacing.sm,
  },
});
