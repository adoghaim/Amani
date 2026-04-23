import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, Card, Text } from '../components';
import { theme } from '../theme';
import { LabReport, formatDate } from '@amani/shared';
import { Search, FileText, ArrowRight, Clock, CheckCircle, XCircle, Plus } from 'lucide-react-native';

function sortReportsByDate(reports: LabReport[]) {
  return [...reports].sort((left, right) =>
    right.report_date.localeCompare(left.report_date)
  );
}

export function ReportsListScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reports, setReports] = useState<LabReport[]>([]);
  const [search, setSearch] = useState('');

  const fetchReports = async (
    userId: string,
    shouldApply: () => boolean = () => true
  ) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('lab_reports')
        .select('*')
        .eq('user_id', userId)
        .order('report_date', { ascending: false });

      if (shouldApply() && !error && data) {
        setReports(data as LabReport[]);
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      if (shouldApply()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    if (!user?.id) {
      setReports([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let isActive = true;

    const loadReports = async () => {
      await fetchReports(user.id, () => isActive);
    };

    const handleReportChange = (
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      const nextReport = payload.new as LabReport | undefined;
      const previousReport = payload.old as Partial<LabReport> | undefined;

      switch (payload.eventType) {
        case 'INSERT':
          if (!nextReport) {
            return;
          }

          setReports((current) =>
            sortReportsByDate([
              ...current.filter((report) => report.id !== nextReport.id),
              nextReport,
            ])
          );
          return;
        case 'UPDATE':
          if (!nextReport) {
            return;
          }

          setReports((current) =>
            sortReportsByDate([
              ...current.filter((report) => report.id !== nextReport.id),
              nextReport,
            ])
          );

          if (
            previousReport?.status === 'processing' &&
            nextReport.status === 'ready'
          ) {
            setRefreshing(false);
          }
          return;
        case 'DELETE':
          if (!previousReport?.id) {
            return;
          }

          setReports((current) =>
            current.filter((report) => report.id !== previousReport.id)
          );
          return;
        default:
          return;
      }
    };

    void loadReports();

    const channel = supabase
      .channel(`reports-list-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lab_reports',
          filter: `user_id=eq.${user.id}`,
        },
        handleReportChange
      )
      .subscribe();

    return () => {
      isActive = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const onRefresh = () => {
    setRefreshing(true);
    if (!user?.id) {
      setRefreshing(false);
      return;
    }

    void fetchReports(user.id);
  };

  const filteredReports = reports.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const dateStr = formatDate(r.report_date).toLowerCase();
    return dateStr.includes(q);
  });

  const StatusBadge = ({ status }: { status: string }) => {
    const config = {
      ready: { color: theme.colors.success, icon: CheckCircle, label: 'Ready' },
      processing: { color: theme.colors.warning, icon: Clock, label: 'Processing' },
      error: { color: theme.colors.danger, icon: XCircle, label: 'Error' },
    }[status as 'ready' | 'processing' | 'error'] || { color: theme.colors.mutedText3, icon: Clock, label: status };

    const Icon = config.icon;

    return (
      <View style={[styles.statusBadge, { borderColor: config.color + '20' }]}>
        <Icon size={12} color={config.color} />
        <Text variant="caption" style={{ color: config.color, marginLeft: 4 }} weight="semibold">
          {config.label.toUpperCase()}
        </Text>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text variant="title">Lab Reports</Text>
          <Text variant="bodySm" tone="muted">
            Your complete health timeline
          </Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.addButton}
          onPress={() => navigation.navigate('UploadReport')}
        >
          <Plus size={18} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <Search size={18} color={theme.colors.mutedText3} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by date..."
          value={search}
          onChangeText={setSearch}
          placeholderTextColor={theme.colors.mutedText3}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
        }
      >
        {filteredReports.length === 0 ? (
          <View style={styles.emptyContainer}>
            <FileText size={48} color={theme.colors.surface2} />
            <Text variant="titleSm" style={styles.emptyTitle}>
              {search ? 'No matches found' : 'No reports yet'}
            </Text>
            <Text variant="bodySm" tone="muted" style={styles.emptyText}>
              {search
                ? 'Try a different search term.'
                : 'Your uploaded lab reports will appear here.'}
            </Text>
            {!search ? (
              <Button
                label="Upload report"
                onPress={() => navigation.navigate('UploadReport')}
                style={styles.emptyButton}
              />
            ) : null}
          </View>
        ) : (
          filteredReports.map((report) => (
            <TouchableOpacity
              key={report.id}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('ReportDetail', { reportId: report.id })}
            >
              <Card style={styles.reportCard}>
                <View style={styles.reportInfo}>
                  <View style={styles.reportHeader}>
                    <Text variant="body" weight="bold">
                      {formatDate(report.report_date)}
                    </Text>
                    <StatusBadge status={report.status} />
                  </View>
                  <Text variant="caption" tone="muted" style={styles.reportMeta}>
                    Uploaded {formatDate(report.upload_date)}
                  </Text>
                  {report.estimated_cycle_phase && report.estimated_cycle_phase !== 'unknown' && (
                    <View style={styles.phaseBadge}>
                      <Text variant="caption" tone="primary" weight="bold">
                        {report.estimated_cycle_phase.toUpperCase()} PHASE
                      </Text>
                    </View>
                  )}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  headerCopy: {
    flex: 1,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface2,
    marginHorizontal: theme.spacing.lg,
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing.sm,
    marginBottom: theme.spacing.md,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
  },
  searchIcon: {
    marginRight: theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    height: 44,
    color: theme.colors.text,
    fontSize: 16,
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
  },
  reportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  reportInfo: {
    flex: 1,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  reportMeta: {
    marginBottom: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'white',
  },
  phaseBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.primary + '10',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  emptyButton: {
    marginTop: theme.spacing.md,
  },
});
