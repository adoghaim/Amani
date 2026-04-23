import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, Card, Text } from '../components';
import { theme } from '../theme';
import {
  LabReport,
  PeriodLog,
  canCreateReport,
  computeCyclePrediction,
  formatDate,
  formatMonthDay,
  phaseDescription,
  PersonalPattern,
} from '@amani/shared';
import { Plus, Upload, Droplets, ArrowRight, Settings } from 'lucide-react-native';
import { YourPatternsCard } from '../components/YourPatternsCard';

export function DashboardScreen() {
  const { user, userProfile } = useAuth();
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<LabReport[]>([]);
  const [periodLogs, setPeriodLogs] = useState<PeriodLog[]>([]);
  const [patterns, setPatterns] = useState<PersonalPattern[]>([]);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [reportsRes, periodRes, patternsRes] = await Promise.all([
        supabase.from('lab_reports').select('*').eq('user_id', user.id).order('report_date', { ascending: false }),
        supabase.from('period_logs').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
        supabase.from('personal_patterns').select('*').eq('user_id', user.id).limit(3),
      ]);

      if (!reportsRes.error && reportsRes.data) setReports(reportsRes.data as LabReport[]);
      if (!periodRes.error && periodRes.data) setPeriodLogs(periodRes.data as PeriodLog[]);
      if (!patternsRes.error && patternsRes.data) setPatterns(patternsRes.data as PersonalPattern[]);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const prediction = useMemo(
    () => (periodLogs.length > 0 ? computeCyclePrediction(periodLogs, userProfile) : null),
    [periodLogs, userProfile]
  );
  const greetingName = user?.email?.split('@')[0] ?? 'there';
  const canUploadReports = canCreateReport(userProfile);
  const needsFirstReport = reports.length === 0;
  const needsFirstPeriodLog = periodLogs.length === 0;
  const showGettingStarted = needsFirstReport || needsFirstPeriodLog;
  const cycleSummary = prediction
    ? prediction.currentPhase === 'menstrual'
      ? 'You are on your period'
      : `Expected period around ${formatMonthDay(prediction.nextPeriodStart)}`
    : 'Log your cycle to unlock cycle-aware insights';

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text variant="title">Hello, {greetingName}</Text>
            <Text variant="bodySm" tone="muted" style={styles.subGreeting}>
              Your health overview at a glance
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => navigation.navigate('Settings')}
            >
              <Settings size={20} color={theme.colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => navigation.navigate(canUploadReports ? 'UploadReport' : 'Billing')}
            >
              <Plus size={20} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {showGettingStarted ? (
          <Card style={styles.setupCard}>
            <Text variant="titleSm">Finish your setup</Text>
            <Text variant="bodySm" tone="muted" style={styles.setupCopy}>
              {needsFirstReport && needsFirstPeriodLog
                ? 'Upload your first report or log your first period to start personalizing the app.'
                : needsFirstReport
                  ? 'Upload your first lab report to unlock your biomarker timeline and analysis.'
                  : 'Log your first period so Amani can start generating cycle-aware predictions.'}
            </Text>

            <View style={styles.setupActions}>
              <Button
                label={needsFirstReport ? (canUploadReports ? 'Upload report' : 'Manage plan') : 'View reports'}
                onPress={() =>
                  navigation.navigate(
                    needsFirstReport
                      ? canUploadReports
                        ? 'UploadReport'
                        : 'Billing'
                      : 'Reports'
                  )
                }
                style={styles.flexButton}
              />
              <Button
                label={needsFirstPeriodLog ? 'Log period' : 'Open tracker'}
                variant="outline"
                onPress={() => navigation.navigate('Tracker')}
                style={styles.flexButton}
              />
            </View>
          </Card>
        ) : null}

        {prediction && (
          <Card style={styles.todayCard}>
            <View style={styles.todayHeader}>
              <View style={styles.phaseBadge}>
                <Droplets size={14} color={theme.colors.danger} />
                <Text variant="caption" tone="danger" weight="bold">
                  {prediction.currentPhase.toUpperCase()}
                </Text>
              </View>
              <Text variant="bodySm" tone="muted" weight="semibold">
                Day {prediction.currentCycleDay}
              </Text>
            </View>
            <Text variant="titleSm" style={styles.todayTitle}>
              {cycleSummary}
            </Text>
            <Text variant="bodySm" tone="muted" style={styles.todayDescription}>
              {phaseDescription(prediction.currentPhase)}
            </Text>
            <View style={styles.buttonRow}>
              <Button
                label="Log Period"
                variant="outline"
                onPress={() => navigation.navigate('Tracker')}
                style={styles.flexButton}
                icon={<Droplets />}
              />
              <Button
                label={canUploadReports ? 'Upload Labs' : 'Manage Plan'}
                onPress={() => navigation.navigate(canUploadReports ? 'UploadReport' : 'Billing')}
                style={styles.flexButton}
                icon={<Upload />}
              />
            </View>
          </Card>
        )}

        {patterns.length > 0 && (
          <YourPatternsCard patterns={patterns} reportCount={reports.length} />
        )}

        <View style={styles.sectionHeader}>
          <Text variant="titleSm">Recent Lab Reports</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Reports')}>
            <Text variant="bodySm" tone="primary" weight="semibold">
              View all
            </Text>
          </TouchableOpacity>
        </View>

        {reports.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text variant="titleSm" style={styles.emptyTitle}>
              No lab reports yet
            </Text>
            <Text variant="bodySm" tone="muted" style={styles.emptyText}>
              Upload your first report to start building your timeline and cycle-aware insights.
            </Text>
            <Button
              label={canUploadReports ? 'Upload your first report' : 'Manage subscription'}
              onPress={() => navigation.navigate(canUploadReports ? 'UploadReport' : 'Billing')}
              style={styles.uploadBtn}
              fullWidth
            />
          </Card>
        ) : (
          reports.slice(0, 3).map((report) => (
            <TouchableOpacity
              key={report.id}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('ReportDetail', { reportId: report.id })}
            >
              <Card style={styles.reportCard}>
                <View style={styles.reportInfo}>
                  <Text variant="body" weight="semibold">
                    {formatDate(report.report_date)}
                  </Text>
                  <View style={styles.statusPill}>
                    <Text variant="caption" tone="muted" weight="semibold">
                      {report.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <ArrowRight size={20} color={theme.colors.mutedText3} />
              </Card>
            </TouchableOpacity>
          ))
        )}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  subGreeting: {
    marginTop: theme.spacing.xxs,
  },
  headerActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCard: {
    marginBottom: theme.spacing.xl,
  },
  setupCard: {
    marginBottom: theme.spacing.xl,
  },
  setupCopy: {
    marginTop: theme.spacing.xs,
  },
  setupActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
  todayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  phaseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.radii.pill,
    gap: theme.spacing.xxs,
  },
  todayTitle: {
    marginBottom: theme.spacing.xs,
  },
  todayDescription: {
    marginBottom: theme.spacing.lg,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  flexButton: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xxxl,
  },
  emptyTitle: {
    marginBottom: theme.spacing.xs,
  },
  emptyText: {
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  uploadBtn: {
    width: '100%',
  },
  reportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  reportInfo: {
    flex: 1,
  },
  statusPill: {
    alignSelf: 'flex-start',
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.borderInner,
  },
});
