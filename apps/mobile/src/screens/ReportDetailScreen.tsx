import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AlertTriangle, Beaker, ChevronDown, ChevronLeft, ChevronRight, Info, RefreshCw, Sparkles } from 'lucide-react-native';
import { type AIInterpretation, type Biomarker, type LabReport, formatDate } from '@amani/shared';
import { BiomarkerTrendChart, Button, Card, Notice, Text } from '../components';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';

interface ReportTimelineRow {
  id: string;
  report_date: string;
}

interface TrendSeries {
  name: string;
  unit: string;
  points: Array<{
    label: string;
    value: number;
  }>;
}

function formatBiomarkerName(name: string) {
  return name.replace(/_/g, ' ');
}

function getFlagMeta(flagged: Biomarker['flagged']) {
  switch (flagged) {
    case 'out_of_range':
      return {
        label: 'Out of range',
        backgroundColor: `${theme.colors.danger}18`,
        color: theme.colors.danger,
      };
    case 'borderline':
      return {
        label: 'Borderline',
        backgroundColor: `${theme.colors.warning}18`,
        color: theme.colors.warning,
      };
    case 'in_range':
      return {
        label: 'In range',
        backgroundColor: `${theme.colors.success}18`,
        color: theme.colors.success,
      };
    default:
      return {
        label: 'Unknown',
        backgroundColor: theme.colors.surface2,
        color: theme.colors.mutedText3,
      };
  }
}

export function ReportDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user, userProfile } = useAuth();
  const { reportId } = route.params;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [report, setReport] = useState<LabReport | null>(null);
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>([]);
  const [interpretation, setInterpretation] = useState<AIInterpretation | null>(null);
  const [trendSeries, setTrendSeries] = useState<TrendSeries[]>([]);
  const [panelExpanded, setPanelExpanded] = useState(false);

  useEffect(() => {
    if (user?.id && reportId) {
      void fetchData();
    }
  }, [user?.id, reportId]);

  const fetchData = async () => {
    if (!user?.id) {
      return;
    }

    try {
      setLoading(true);

      const [reportRes, biomarkersRes, interpretationRes] = await Promise.all([
        supabase.from('lab_reports').select('*').eq('id', reportId).maybeSingle(),
        supabase.from('biomarkers').select('*').eq('lab_report_id', reportId),
        supabase.from('interpretations').select('*').eq('lab_report_id', reportId).maybeSingle(),
      ]);

      if (reportRes.data) {
        setReport(reportRes.data as LabReport);
      }

      const biomarkerRows = (biomarkersRes.data ?? []) as Biomarker[];
      setBiomarkers(biomarkerRows);

      if (interpretationRes.data?.json_output) {
        setInterpretation(interpretationRes.data.json_output as AIInterpretation);
      } else {
        setInterpretation(null);
      }

      if (biomarkerRows.length > 0) {
        const { data: reportTimelineData } = await supabase
          .from('lab_reports')
          .select('id, report_date')
          .eq('user_id', user.id)
          .order('report_date', { ascending: true });

        const timeline = (reportTimelineData ?? []) as ReportTimelineRow[];
        const timelineById = new Map(timeline.map((row) => [row.id, row.report_date]));
        const reportIds = timeline.map((row) => row.id);

        const { data: historyData } = reportIds.length
          ? await supabase
              .from('biomarkers')
              .select('lab_report_id, name, value, unit')
              .in('lab_report_id', reportIds)
              .in(
                'name',
                [...new Set(biomarkerRows.map((marker) => marker.name))]
              )
          : { data: [] as Array<{ lab_report_id: string; name: string; value: number; unit: string }> };

        const currentPriority = [
          ...biomarkerRows
            .filter((marker) => marker.flagged !== 'in_range')
            .map((marker) => marker.name),
          ...biomarkerRows
            .filter((marker) => marker.flagged === 'in_range')
            .map((marker) => marker.name),
        ];
        const seen = new Set<string>();
        const orderedNames = currentPriority.filter((name) => {
          if (seen.has(name)) {
            return false;
          }
          seen.add(name);
          return true;
        });

        const grouped = new Map<string, Array<{ date: string; value: number; unit: string }>>();
        for (const row of (historyData ?? []) as Array<{
          lab_report_id: string;
          name: string;
          value: number;
          unit: string;
        }>) {
          const reportDate = timelineById.get(row.lab_report_id);
          if (!reportDate) {
            continue;
          }
          const list = grouped.get(row.name) ?? [];
          list.push({
            date: reportDate,
            value: row.value,
            unit: row.unit,
          });
          grouped.set(row.name, list);
        }

        const nextTrendSeries = orderedNames
          .map((name) => {
            const rows = (grouped.get(name) ?? [])
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            if (rows.length < 2) {
              return null;
            }

            const units = [...new Set(rows.map((row) => row.unit))];
            if (units.length !== 1) {
              return null;
            }

            return {
              name: formatBiomarkerName(name),
              unit: units[0],
              points: rows.map((row) => ({
                label: new Date(row.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                }),
                value: row.value,
              })),
            } satisfies TrendSeries;
          })
          .filter((series): series is TrendSeries => Boolean(series))
          .slice(0, 3);

        setTrendSeries(nextTrendSeries);
      } else {
        setTrendSeries([]);
      }
    } catch (fetchError) {
      console.error('Error fetching report details:', fetchError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    void fetchData();
  };

  const isTrialActive = () => {
    if (!userProfile) {
      return false;
    }
    if (userProfile.subscription_status === 'active') {
      return true;
    }
    if (userProfile.subscription_status === 'trial') {
      const trialStart = new Date(userProfile.trial_start_date);
      const daysSinceStart = Math.floor((Date.now() - trialStart.getTime()) / 86400000);
      return daysSinceStart < 7;
    }
    return false;
  };

  const handleRegenerate = async () => {
    if (!report || report.regeneration_count >= 3) {
      return;
    }
    if (userProfile?.subscription_status !== 'active' && !isTrialActive()) {
      setActionError('Regeneration is available for active or trial subscriptions.');
      return;
    }

    setRegenerating(true);
    setActionError('');
    try {
      await supabase.from('interpretations').delete().eq('lab_report_id', reportId);
      await supabase
        .from('lab_reports')
        .update({
          status: 'processing',
          regeneration_count: report.regeneration_count + 1,
        })
        .eq('id', reportId);

      const { data: fnData, error: interpretationError } = await supabase.functions.invoke(
        'generate-interpretation',
        { body: { reportId } }
      );

      if (interpretationError || !fnData?.success) {
        await supabase.from('lab_reports').update({ status: 'error' }).eq('id', reportId);
        setActionError('Regeneration failed. You can try again if attempts remain.');
      }
      await fetchData();
    } catch (regenerateError) {
      console.error('Error regenerating report interpretation:', regenerateError);
      await supabase.from('lab_reports').update({ status: 'error' }).eq('id', reportId);
      setActionError('Regeneration failed. Please try again.');
      await fetchData();
    } finally {
      setRegenerating(false);
    }
  };

  const flaggedMarkers = useMemo(() => {
    return [...biomarkers]
      .filter((marker) => marker.flagged !== 'in_range')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [biomarkers]);

  const allMarkers = useMemo(() => {
    return [...biomarkers].sort((a, b) => {
      if (a.flagged === b.flagged) {
        return a.name.localeCompare(b.name);
      }
      if (a.flagged === 'out_of_range') return -1;
      if (b.flagged === 'out_of_range') return 1;
      if (a.flagged === 'borderline') return -1;
      if (b.flagged === 'borderline') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [biomarkers]);

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <Text variant="body">Report not found.</Text>
        <Button label="Go back" onPress={() => navigation.goBack()} style={styles.notFoundButton} />
      </SafeAreaView>
    );
  }

  const canRegenerate =
    report.regeneration_count < 3 &&
    (userProfile?.subscription_status === 'active' || isTrialActive());
  const remainingRegenerations = 3 - report.regeneration_count;
  const exhaustedRegenerations = report.regeneration_count >= 3;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text variant="titleSm">{formatDate(report.report_date)}</Text>
          <Text variant="caption" tone="muted">
            Lab report analysis
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('UploadReport')}
          style={styles.uploadShortcut}
        >
          <Beaker size={18} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
        }
      >
        {report.status === 'processing' ? (
          <Notice style={styles.notice}>
            Your report is still being interpreted. Biomarkers are saved and the AI summary will appear once processing finishes.
          </Notice>
        ) : null}

        {report.status === 'error' ? (
          <Notice tone="error" style={styles.notice}>
            This report hit a processing error. Try uploading the file again or use a clearer PDF export from your lab portal.
          </Notice>
        ) : null}

        {actionError ? (
          <Notice tone="error" style={styles.notice}>
            {actionError}
          </Notice>
        ) : null}

        {(canRegenerate || exhaustedRegenerations) ? (
          <Card style={styles.regenerationCard}>
            <View style={styles.regenerationHeader}>
              <Text variant="body" weight="bold">
                Regenerate analysis
              </Text>
              <Text variant="caption" tone="muted">
                {exhaustedRegenerations ? 'No retries left' : `${remainingRegenerations} left`}
              </Text>
            </View>
            <Text variant="bodySm" tone="muted">
              Request a new AI interpretation if this summary missed context or encountered an error.
            </Text>
            {canRegenerate ? (
              <Button
                variant="secondary"
                size="sm"
                onPress={() => void handleRegenerate()}
                loading={regenerating}
                disabled={regenerating}
                icon={<RefreshCw />}
                label={regenerating ? 'Regenerating...' : `Regenerate (${remainingRegenerations} left)`}
              />
            ) : (
              <Text variant="caption" tone="muted">
                You have used all 3 regeneration attempts for this report.
              </Text>
            )}
          </Card>
        ) : null}

        {interpretation ? (
          <Card style={styles.summaryCard}>
            <View style={styles.cardHeader}>
              <Sparkles size={18} color={theme.colors.primary} />
              <Text variant="body" weight="bold" style={styles.cardTitle}>
                Amani analysis
              </Text>
            </View>

            <Text variant="titleSm" style={styles.headline}>
              {interpretation.headline}
            </Text>

            {interpretation.primary_concern ? (
              <View style={styles.priorityBox}>
                <View style={styles.priorityHeader}>
                  <AlertTriangle size={16} color={theme.colors.danger} />
                  <Text variant="caption" tone="danger" weight="bold" style={styles.priorityLabel}>
                    Top priority
                  </Text>
                </View>
                <Text variant="body" weight="bold" style={styles.priorityTitle}>
                  {interpretation.primary_concern.title}
                </Text>
                <Text variant="bodySm" tone="muted">
                  {interpretation.primary_concern.summary}
                </Text>
              </View>
            ) : null}

            {interpretation.summary_bullets?.length ? (
              <View style={styles.bullets}>
                {interpretation.summary_bullets.map((bullet) => (
                  <View key={bullet} style={styles.bulletRow}>
                    <View style={styles.bulletDot} />
                    <Text variant="bodySm" style={styles.bulletText}>
                      {bullet}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ) : (
          <Card>
            <Text variant="body" weight="bold">
              Analysis summary
            </Text>
            <Text variant="bodySm" tone="muted" style={styles.pendingText}>
              Amani is still preparing the interpretation for this report. Pull to refresh if you just returned from the upload flow.
            </Text>
          </Card>
        )}

        <View style={styles.section}>
          <Text variant="titleSm" style={styles.sectionTitle}>
            Areas of focus
          </Text>

          {flaggedMarkers.length > 0 ? (
            flaggedMarkers.map((marker) => {
              const flagMeta = getFlagMeta(marker.flagged);
              return (
                <Card key={marker.id} style={styles.markerCard}>
                  <View style={styles.markerHeader}>
                    <Text variant="body" weight="bold">
                      {formatBiomarkerName(marker.name)}
                    </Text>
                    <View style={[styles.flagBadge, { backgroundColor: flagMeta.backgroundColor }]}>
                      <Text variant="caption" weight="bold" style={{ color: flagMeta.color }}>
                        {flagMeta.label.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.markerValues}>
                    <Text variant="titleSm" weight="bold">
                      {marker.value} {marker.unit}
                    </Text>
                    <Text variant="caption" tone="muted">
                      Ref: {marker.reference_min ?? '—'} to {marker.reference_max ?? '—'}
                    </Text>
                  </View>
                </Card>
              );
            })
          ) : (
            <Card>
              <Text variant="bodySm" tone="muted">
                No core biomarkers are currently flagged outside the available reference ranges.
              </Text>
            </Card>
          )}
        </View>

        {trendSeries.length > 0 ? (
          <View style={styles.section}>
            <Text variant="titleSm" style={styles.sectionTitle}>
              Biomarker trends
            </Text>
            {trendSeries.map((series) => (
              <BiomarkerTrendChart
                key={series.name}
                title={series.name}
                unit={series.unit}
                points={series.points}
              />
            ))}
          </View>
        ) : null}

        {interpretation?.what_you_can_do_now?.length ? (
          <View style={styles.section}>
            <Text variant="titleSm" style={styles.sectionTitle}>
              Next steps
            </Text>
            <Card style={styles.recommendationCard}>
              {interpretation.what_you_can_do_now.map((step, index) => (
                <View key={`${step}-${index}`} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text variant="caption" weight="bold" tone="inverse">
                      {index + 1}
                    </Text>
                  </View>
                  <Text variant="bodySm" style={styles.stepText}>
                    {step}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.fullPanelButton}
            onPress={() => setPanelExpanded((value) => !value)}
            activeOpacity={0.85}
          >
            <View style={styles.fullPanelLabel}>
              <Beaker size={18} color={theme.colors.mutedText3} />
              <Text variant="body" weight="semibold" style={styles.fullPanelTitle}>
                Full lab panel
              </Text>
            </View>
            <View style={styles.fullPanelMeta}>
              <Text variant="caption" tone="muted">
                {allMarkers.length} biomarkers
              </Text>
              {panelExpanded ? (
                <ChevronDown size={18} color={theme.colors.mutedText3} />
              ) : (
                <ChevronRight size={18} color={theme.colors.mutedText3} />
              )}
            </View>
          </TouchableOpacity>

          {panelExpanded ? (
            <Card style={styles.panelCard}>
              {allMarkers.map((marker, index) => {
                const flagMeta = getFlagMeta(marker.flagged);
                return (
                  <View
                    key={marker.id}
                    style={[
                      styles.panelRow,
                      index !== allMarkers.length - 1 ? styles.panelRowBorder : null,
                    ]}
                  >
                    <View style={styles.panelCopy}>
                      <Text variant="bodySm" weight="semibold">
                        {formatBiomarkerName(marker.name)}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {marker.reference_min ?? '—'} to {marker.reference_max ?? '—'} {marker.unit}
                      </Text>
                    </View>
                    <View style={styles.panelValue}>
                      <Text variant="bodySm" weight="bold">
                        {marker.value} {marker.unit}
                      </Text>
                      <Text variant="caption" style={{ color: flagMeta.color }}>
                        {flagMeta.label}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          ) : null}
        </View>

        <View style={styles.disclaimer}>
          <Info size={14} color={theme.colors.mutedText3} />
          <Text variant="caption" tone="muted" style={styles.disclaimerText}>
            This analysis is educational only and is not a substitute for diagnosis or treatment from a licensed clinician.
          </Text>
        </View>
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
  notFoundButton: {
    marginTop: theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    height: 56,
    borderBottomWidth: theme.borders.thin,
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  uploadShortcut: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
    gap: theme.spacing.lg,
  },
  notice: {
    marginBottom: -theme.spacing.xs,
  },
  summaryCard: {
    gap: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    marginLeft: theme.spacing.xs,
    color: theme.colors.primary,
  },
  headline: {
    marginBottom: theme.spacing.xs,
  },
  priorityBox: {
    backgroundColor: theme.colors.backgroundTint,
    padding: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
  },
  priorityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  priorityLabel: {
    marginLeft: theme.spacing.xs,
  },
  priorityTitle: {
    marginBottom: theme.spacing.xxs,
  },
  bullets: {
    gap: theme.spacing.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.xs,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
  },
  pendingText: {
    marginTop: theme.spacing.xs,
  },
  section: {
    gap: theme.spacing.md,
  },
  sectionTitle: {
    marginBottom: -theme.spacing.xxs,
  },
  markerCard: {
    gap: theme.spacing.md,
  },
  markerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  flagBadge: {
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.radii.pill,
  },
  markerValues: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: theme.spacing.sm,
  },
  recommendationCard: {
    gap: theme.spacing.sm,
  },
  regenerationCard: {
    gap: theme.spacing.sm,
  },
  regenerationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepText: {
    flex: 1,
  },
  fullPanelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radii.lg,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
  },
  fullPanelLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  fullPanelTitle: {
    marginLeft: theme.spacing.sm,
  },
  fullPanelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  panelCard: {
    paddingVertical: 0,
  },
  panelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  panelRowBorder: {
    borderBottomWidth: theme.borders.thin,
    borderBottomColor: theme.colors.borderSubtle,
  },
  panelCopy: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  panelValue: {
    alignItems: 'flex-end',
    gap: theme.spacing.xxs,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
  },
  disclaimerText: {
    flex: 1,
    fontStyle: 'italic',
  },
});
