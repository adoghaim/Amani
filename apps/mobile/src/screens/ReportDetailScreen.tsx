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
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { AlertTriangle, Beaker, ChevronDown, ChevronLeft, ChevronRight, Download, Info, RefreshCw, Sparkles } from 'lucide-react-native';
import {
  type AIInterpretation,
  type Biomarker,
  computeDerivedMetrics,
  evaluateInsightRules,
  type LabReport,
  type ReportAnalyte,
  classifyLabValue,
  formatDate,
} from '@amani/shared';

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
    timestamp: number;
    value: number;
  }>;
}

function formatBiomarkerName(name: string) {
  return name.replace(/_/g, ' ');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPdfList(items: string[], ordered = false) {
  if (items.length === 0) {
    return '';
  }

  const tag = ordered ? 'ol' : 'ul';

  return `<${tag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
}

function renderPdfSection(title: string, body: string) {
  if (!body.trim()) {
    return '';
  }

  return `
    <section class="section">
      <h2>${escapeHtml(title)}</h2>
      ${body}
    </section>
  `;
}

function renderPdfBadge(status: string) {
  const normalized = escapeHtml(status.toLowerCase().replace(/\s+/g, '-'));
  return `<span class="badge badge-${normalized}">${escapeHtml(status)}</span>`;
}

function buildReportPdfHtml({
  reportDate,
  interpretation,
  flaggedMarkers,
  allMarkers,
  insightFlags,
  derivedMetrics,
}: {
  reportDate: string;
  interpretation: AIInterpretation;
  flaggedMarkers: Biomarker[];
  allMarkers: Biomarker[];
  insightFlags: Array<{ title: string; description: string }>;
  derivedMetrics: Array<{ displayName: string; value: string | number; unit: string; interpretation: string }>;
}) {
  const generatedAt = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const keyFindings = interpretation.key_findings?.length
    ? interpretation.key_findings.map((finding) => ({
        title: finding.title,
        explanation: finding.explanation,
        status: finding.status,
      }))
    : interpretation.top_findings.map((finding) => ({
        title: finding.title,
        explanation: finding.explanation,
        status: finding.status,
      }));
  const biomarkerRows = (flaggedMarkers.length > 0 ? flaggedMarkers : allMarkers.slice(0, 8))
    .map((marker) => {
      const flagMeta = getFlagMeta(marker.flagged);
      return `
        <tr>
          <td>${escapeHtml(formatBiomarkerName(marker.name))}</td>
          <td>${escapeHtml(String(marker.value))} ${escapeHtml(marker.unit ?? '')}</td>
          <td>${escapeHtml(`${marker.reference_min ?? '—'} to ${marker.reference_max ?? '—'} ${marker.unit ?? ''}`)}</td>
          <td>${renderPdfBadge(flagMeta.label)}</td>
        </tr>
      `;
    })
    .join('');
  const cyclePhase = interpretation.cycle_context?.estimated_cycle_phase
    ? escapeHtml(String(interpretation.cycle_context.estimated_cycle_phase).replace(/_/g, ' '))
    : 'Unknown';
  const cycleDay = interpretation.cycle_context?.estimated_cycle_day ?? 'Unknown';

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <style>
          @page {
            margin: 28px;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #172033;
            background: #f5f1e7;
            line-height: 1.55;
          }

          .page {
            background: #fffdf8;
            border: 1px solid #e4dccd;
            border-radius: 22px;
            overflow: hidden;
          }

          .header {
            padding: 28px 32px 20px;
            background: linear-gradient(135deg, #0f6d6c 0%, #2a8f7f 100%);
            color: #ffffff;
          }

          .eyebrow {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            opacity: 0.8;
            margin: 0 0 8px;
          }

          h1 {
            margin: 0;
            font-size: 28px;
            line-height: 1.2;
          }

          .header-meta {
            margin-top: 14px;
            display: flex;
            gap: 16px;
            font-size: 12px;
            flex-wrap: wrap;
          }

          .content {
            padding: 28px 32px 32px;
          }

          .summary {
            margin: 0 0 20px;
            padding: 18px 20px;
            border-radius: 18px;
            background: #f3faf7;
            border: 1px solid #d5ebe1;
          }

          .summary p {
            margin: 0;
            font-size: 16px;
          }

          .section {
            margin-top: 24px;
          }

          h2 {
            margin: 0 0 12px;
            font-size: 18px;
            color: #1d3557;
          }

          h3 {
            margin: 0 0 6px;
            font-size: 15px;
            color: #20324d;
          }

          p {
            margin: 0 0 10px;
          }

          ul, ol {
            margin: 0;
            padding-left: 20px;
          }

          li {
            margin: 0 0 8px;
          }

          .panel {
            padding: 16px 18px;
            border-radius: 16px;
            border: 1px solid #e8e1d7;
            background: #ffffff;
            margin-bottom: 12px;
          }

          .two-column {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
          }

          .two-column .panel {
            flex: 1 1 220px;
          }

          .badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            background: #eef1f6;
            color: #42526b;
          }

          .badge-out-of-range,
          .badge-attention {
            background: #fde7e8;
            color: #9f2930;
          }

          .badge-borderline,
          .badge-monitor,
          .badge-discuss {
            background: #fff0d8;
            color: #9a6700;
          }

          .badge-in-range,
          .badge-reassuring {
            background: #e1f4ea;
            color: #1a6e43;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }

          th,
          td {
            padding: 10px 12px;
            border-bottom: 1px solid #ece6db;
            text-align: left;
            vertical-align: top;
          }

          th {
            background: #f8f5ee;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #68768a;
          }

          .footnote {
            margin-top: 28px;
            font-size: 12px;
            color: #667085;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <header class="header">
            <p class="eyebrow">Amani Lab Summary</p>
            <h1>${escapeHtml(formatDate(reportDate))}</h1>
            <div class="header-meta">
              <span>Generated ${escapeHtml(generatedAt)}</span>
              <span>Cycle phase: ${cyclePhase}</span>
              <span>Estimated cycle day: ${escapeHtml(String(cycleDay))}</span>
            </div>
          </header>

          <main class="content">
            <div class="summary">
              <p>${escapeHtml(interpretation.headline)}</p>
            </div>

            ${renderPdfSection('Summary', renderPdfList(interpretation.summary_bullets))}

            ${interpretation.primary_concern ? renderPdfSection(
              'Top Priority',
              `
                <div class="panel">
                  <h3>${escapeHtml(interpretation.primary_concern.title)}</h3>
                  <p>${escapeHtml(interpretation.primary_concern.summary)}</p>
                  <p><strong>Why it matters:</strong> ${escapeHtml(interpretation.primary_concern.why_it_matters)}</p>
                </div>
              `
            ) : ''}

            ${renderPdfSection(
              'Key Findings',
              keyFindings
                .map(
                  (finding) => `
                    <div class="panel">
                      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                        <h3>${escapeHtml(finding.title)}</h3>
                        ${renderPdfBadge(finding.status)}
                      </div>
                      <p>${escapeHtml(finding.explanation)}</p>
                    </div>
                  `
                )
                .join('')
            )}

            ${renderPdfSection(
              'Current Biomarker Snapshot',
              `
                <table>
                  <thead>
                    <tr>
                      <th>Marker</th>
                      <th>Current Value</th>
                      <th>Reference Range</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>${biomarkerRows}</tbody>
                </table>
              `
            )}

            ${renderPdfSection(
              'Advanced Insights',
              `
                ${insightFlags.length > 0 ? `
                  <div class="panel">
                    <h3>Insight flags</h3>
                    ${renderPdfList(insightFlags.map((flag) => `${flag.title}: ${flag.description}`))}
                  </div>
                ` : ''}
                ${interpretation.pattern_signals.length > 0 ? `
                  <div class="panel">
                    <h3>Pattern signals</h3>
                    ${renderPdfList(
                      interpretation.pattern_signals.map(
                        (signal) => `${signal.title} (${signal.confidence} confidence): ${signal.explanation}`
                      )
                    )}
                  </div>
                ` : ''}
                ${derivedMetrics.length > 0 ? `
                  <div class="panel">
                    <h3>Derived metrics</h3>
                    ${renderPdfList(
                      derivedMetrics.map(
                        (metric) => `${metric.displayName}: ${metric.value} ${metric.unit} - ${metric.interpretation}`
                      )
                    )}
                  </div>
                ` : ''}
              `
            )}

            ${renderPdfSection('Next Steps', renderPdfList(interpretation.what_you_can_do_now ?? [], true))}

            ${renderPdfSection('Questions for Your Doctor', renderPdfList(interpretation.questions_for_doctor, true))}

            ${renderPdfSection(
              'Supportive Considerations',
              `
                <div class="two-column">
                  ${(interpretation.supportive_considerations?.nutrition?.length ?? 0) > 0 ? `
                    <div class="panel">
                      <h3>Nutrition</h3>
                      ${renderPdfList(interpretation.supportive_considerations?.nutrition ?? [])}
                    </div>
                  ` : ''}
                  ${(interpretation.supportive_considerations?.sleep_stress?.length ?? 0) > 0 ? `
                    <div class="panel">
                      <h3>Sleep &amp; Stress</h3>
                      ${renderPdfList(interpretation.supportive_considerations?.sleep_stress ?? [])}
                    </div>
                  ` : ''}
                  ${(interpretation.supportive_considerations?.lifestyle?.length ?? 0) > 0 ? `
                    <div class="panel">
                      <h3>Lifestyle</h3>
                      ${renderPdfList(interpretation.supportive_considerations?.lifestyle ?? [])}
                    </div>
                  ` : ''}
                </div>
              `
            )}

            <p class="footnote">${escapeHtml(interpretation.disclaimer)}</p>
          </main>
        </div>
      </body>
    </html>
  `;
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

function getAnalyteFlagMeta(analyte: ReportAnalyte) {
  const flagged = classifyLabValue(
    analyte.value_numeric,
    analyte.normalized_min,
    analyte.normalized_max,
    analyte.normalized_operator,
    analyte.normalized_operator_value
  );

  return {
    flagged,
    ...getFlagMeta(flagged),
  };
}

export function ReportDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user, userProfile } = useAuth();
  const { reportId } = route.params;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [actionError, setActionError] = useState('');
  const [report, setReport] = useState<LabReport | null>(null);
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>([]);
  const [reportAnalytes, setReportAnalytes] = useState<ReportAnalyte[]>([]);
  const [interpretation, setInterpretation] = useState<AIInterpretation | null>(null);
  const [trendSeries, setTrendSeries] = useState<TrendSeries[]>([]);
  const [selectedTrendName, setSelectedTrendName] = useState('');
  const [panelExpanded, setPanelExpanded] = useState(false);

  useEffect(() => {
    if (user?.id && reportId) {
      void fetchData();
    }
  }, [user?.id, reportId]);

  useEffect(() => {
    if (trendSeries.length === 0) {
      setSelectedTrendName('');
      return;
    }

    if (!trendSeries.some((series) => series.name === selectedTrendName)) {
      setSelectedTrendName(trendSeries[0].name);
    }
  }, [selectedTrendName, trendSeries]);

  const fetchData = async () => {
    if (!user?.id) {
      return;
    }

    try {
      setLoading(true);

      const [reportRes, biomarkersRes, analytesRes, interpretationRes] = await Promise.all([
        supabase.from('lab_reports').select('*').eq('id', reportId).maybeSingle(),
        supabase.from('biomarkers').select('*').eq('lab_report_id', reportId),
        supabase.from('report_analytes').select('*').eq('lab_report_id', reportId).order('raw_name'),
        supabase.from('interpretations').select('*').eq('lab_report_id', reportId).maybeSingle(),
      ]);

      if (reportRes.data) {
        setReport(reportRes.data as LabReport);
      }

      const biomarkerRows = (biomarkersRes.data ?? []) as Biomarker[];
      setBiomarkers(biomarkerRows);
      setReportAnalytes((analytesRes.data ?? []) as ReportAnalyte[]);

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
                timestamp: new Date(row.date).getTime(),
                value: row.value,
              })),
            } satisfies TrendSeries;
          })
          .filter((series): series is TrendSeries => Boolean(series));

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

  const handleExportPdf = async () => {
    if (!report || !interpretation) {
      return;
    }

    setExportingPdf(true);
    setActionError('');

    try {
      const sharingAvailable = await Sharing.isAvailableAsync();

      if (!sharingAvailable) {
        setActionError('PDF sharing is not available on this device.');
        return;
      }

      const html = buildReportPdfHtml({
        reportDate: report.report_date,
        interpretation,
        flaggedMarkers,
        allMarkers,
        insightFlags: insightFlags.map((flag) => ({
          title: flag.title,
          description: flag.description,
        })),
        derivedMetrics: derivedMetrics.map((metric) => ({
          displayName: metric.displayName,
          value: metric.value,
          unit: metric.unit,
          interpretation: metric.interpretation,
        })),
      });
      const { uri } = await Print.printToFileAsync({ html });

      await Sharing.shareAsync(uri, {
        dialogTitle: `Share ${formatDate(report.report_date)} report`,
        mimeType: 'application/pdf',
        UTI: '.pdf',
      });
    } catch (exportError) {
      console.error('Error exporting report PDF:', exportError);
      setActionError('Could not generate the PDF. Please try again.');
    } finally {
      setExportingPdf(false);
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

  const fullPanelAnalytes = useMemo(() => {
    return [...reportAnalytes].sort((a, b) => {
      const aStatus = getAnalyteFlagMeta(a).flagged;
      const bStatus = getAnalyteFlagMeta(b).flagged;

      if (aStatus === bStatus) {
        return (a.display_name ?? a.raw_name).localeCompare(b.display_name ?? b.raw_name);
      }
      if (aStatus === 'out_of_range') return -1;
      if (bStatus === 'out_of_range') return 1;
      if (aStatus === 'borderline') return -1;
      if (bStatus === 'borderline') return 1;
      if (aStatus === 'in_range') return -1;
      if (bStatus === 'in_range') return 1;
      return (a.display_name ?? a.raw_name).localeCompare(b.display_name ?? b.raw_name);
    });
  }, [reportAnalytes]);

  const derivedMetrics = useMemo(() => computeDerivedMetrics(biomarkers), [biomarkers]);
  const insightFlags = useMemo(
    () => evaluateInsightRules(biomarkers, interpretation?.cycle_context?.estimated_cycle_phase ?? null),
    [biomarkers, interpretation?.cycle_context?.estimated_cycle_phase]
  );
  const selectedTrendSeries = useMemo(
    () => trendSeries.find((series) => series.name === selectedTrendName) ?? trendSeries[0] ?? null,
    [selectedTrendName, trendSeries]
  );

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
  const canExportPdf = Boolean(interpretation);
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

            <View style={styles.exportRow}>
              <Text variant="caption" tone="muted" style={styles.exportCopy}>
                Generate a doctor-friendly PDF with the interpretation, biomarker summary, and follow-up questions.
              </Text>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => void handleExportPdf()}
                loading={exportingPdf}
                disabled={!canExportPdf}
                icon={<Download />}
                label={exportingPdf ? 'Preparing PDF...' : 'Export to PDF'}
              />
            </View>
          </Card>
        ) : (
          <Card>
            <Text variant="body" weight="bold">
              Analysis summary
            </Text>
            <Text variant="bodySm" tone="muted" style={styles.pendingText}>
              Amani is still preparing the interpretation for this report. Pull to refresh if you just returned from the upload flow.
            </Text>
            <View style={styles.exportRow}>
              <Text variant="caption" tone="muted" style={styles.exportCopy}>
                PDF export becomes available once the AI interpretation is ready.
              </Text>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => void handleExportPdf()}
                disabled
                icon={<Download />}
                label="Export to PDF"
              />
            </View>
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
            {trendSeries.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.trendPills}
              >
                {trendSeries.map((series) => {
                  const selected = selectedTrendSeries?.name === series.name;

                  return (
                    <TouchableOpacity
                      key={series.name}
                      activeOpacity={0.85}
                      onPress={() => setSelectedTrendName(series.name)}
                      style={[
                        styles.trendPill,
                        selected ? styles.trendPillSelected : null,
                      ]}
                    >
                      <Text
                        variant="caption"
                        tone={selected ? 'inverse' : 'muted'}
                        weight="semibold"
                      >
                        {series.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}
            {selectedTrendSeries ? (
              <BiomarkerTrendChart
                key={selectedTrendSeries.name}
                title={selectedTrendSeries.name}
                unit={selectedTrendSeries.unit}
                points={selectedTrendSeries.points}
              />
            ) : null}
          </View>
        ) : null}

        {(insightFlags.length > 0 || interpretation?.pattern_signals?.length || derivedMetrics.length > 0) ? (
          <View style={styles.section}>
            <Text variant="titleSm" style={styles.sectionTitle}>
              Advanced insights
            </Text>

            {insightFlags.length > 0 ? (
              <Card style={styles.recommendationCard}>
                <Text variant="body" weight="bold">
                  Insight flags
                </Text>
                {insightFlags.map((flag) => (
                  <View key={flag.rule_id} style={styles.contextRow}>
                    <Text variant="bodySm" weight="semibold">
                      {flag.title}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {flag.description}
                    </Text>
                  </View>
                ))}
              </Card>
            ) : null}

            {interpretation?.pattern_signals?.length ? (
              <Card style={styles.recommendationCard}>
                <Text variant="body" weight="bold">
                  Pattern signals
                </Text>
                {interpretation.pattern_signals.map((signal) => (
                  <View key={`${signal.title}-${signal.confidence}`} style={styles.contextRow}>
                    <Text variant="bodySm" weight="semibold">
                      {signal.title}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {signal.explanation}
                    </Text>
                  </View>
                ))}
              </Card>
            ) : null}

            {derivedMetrics.length > 0 ? (
              <Card style={styles.recommendationCard}>
                <Text variant="body" weight="bold">
                  Derived metrics
                </Text>
                {derivedMetrics.map((metric) => (
                  <View key={metric.name} style={styles.contextRow}>
                    <View style={styles.derivedMetricHeader}>
                      <Text variant="bodySm" weight="semibold">
                        {metric.displayName}
                      </Text>
                      <Text variant="bodySm" weight="bold">
                        {metric.value} {metric.unit}
                      </Text>
                    </View>
                    <Text variant="caption" tone="muted">
                      {metric.formulaNote}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {metric.interpretation}
                    </Text>
                  </View>
                ))}
              </Card>
            ) : null}
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

        {interpretation?.questions_for_doctor?.length ? (
          <View style={styles.section}>
            <Text variant="titleSm" style={styles.sectionTitle}>
              Doctor questions
            </Text>
            <Card style={styles.recommendationCard}>
              {interpretation.questions_for_doctor.map((question, index) => (
                <View key={`${question}-${index}`} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text variant="caption" weight="bold" tone="inverse">
                      {index + 1}
                    </Text>
                  </View>
                  <Text variant="bodySm" style={styles.stepText}>
                    {question}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {(interpretation?.supportive_considerations?.nutrition?.length ||
          interpretation?.supportive_considerations?.sleep_stress?.length ||
          interpretation?.supportive_considerations?.lifestyle?.length) ? (
          <View style={styles.section}>
            <Text variant="titleSm" style={styles.sectionTitle}>
              Supportive considerations
            </Text>
            <Card style={styles.recommendationCard}>
              {interpretation?.supportive_considerations?.nutrition?.length ? (
                <View style={styles.contextRow}>
                  <Text variant="bodySm" weight="semibold">
                    Nutrition
                  </Text>
                  {interpretation.supportive_considerations.nutrition.map((item, index) => (
                    <Text key={`nutrition-${index}`} variant="caption" tone="muted">
                      • {item}
                    </Text>
                  ))}
                </View>
              ) : null}
              {interpretation?.supportive_considerations?.sleep_stress?.length ? (
                <View style={styles.contextRow}>
                  <Text variant="bodySm" weight="semibold">
                    Sleep & stress
                  </Text>
                  {interpretation.supportive_considerations.sleep_stress.map((item, index) => (
                    <Text key={`sleep-stress-${index}`} variant="caption" tone="muted">
                      • {item}
                    </Text>
                  ))}
                </View>
              ) : null}
              {interpretation?.supportive_considerations?.lifestyle?.length ? (
                <View style={styles.contextRow}>
                  <Text variant="bodySm" weight="semibold">
                    Lifestyle
                  </Text>
                  {interpretation.supportive_considerations.lifestyle.map((item, index) => (
                    <Text key={`lifestyle-${index}`} variant="caption" tone="muted">
                      • {item}
                    </Text>
                  ))}
                </View>
              ) : null}
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
                {fullPanelAnalytes.length > 0 ? `${fullPanelAnalytes.length} analytes` : `${allMarkers.length} biomarkers`}
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
              {(fullPanelAnalytes.length > 0 ? fullPanelAnalytes : allMarkers).map((item, index) => {
                const isAnalyte = 'raw_name' in item;
                const flagMeta = isAnalyte ? getAnalyteFlagMeta(item) : getFlagMeta(item.flagged);
                const label = isAnalyte ? (item.display_name ?? item.raw_name) : formatBiomarkerName(item.name);
                const valueText = isAnalyte
                  ? (item.raw_value_text ?? item.value_numeric ?? '—')
                  : item.value;
                const unitText = item.unit ?? '';
                const referenceText = isAnalyte
                  ? (item.raw_reference_range ?? 'No range provided')
                  : `${item.reference_min ?? '—'} to ${item.reference_max ?? '—'} ${item.unit}`;

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.panelRow,
                      index !== (fullPanelAnalytes.length > 0 ? fullPanelAnalytes.length : allMarkers.length) - 1
                        ? styles.panelRowBorder
                        : null,
                    ]}
                  >
                    <View style={styles.panelCopy}>
                      <Text variant="bodySm" weight="semibold">
                        {label}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {referenceText}
                      </Text>
                      {isAnalyte && item.parse_status === 'unmapped' ? (
                        <Text variant="caption" style={styles.unmappedLabel}>
                          Unmapped
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.panelValue}>
                      <Text variant="bodySm" weight="bold">
                        {valueText} {unitText}
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
  exportRow: {
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
  },
  exportCopy: {
    maxWidth: 480,
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
  trendPills: {
    gap: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
  },
  trendPill: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.pill,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  trendPillSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.accent,
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
  contextRow: {
    gap: theme.spacing.xxs,
  },
  derivedMetricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
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
  unmappedLabel: {
    color: theme.colors.mutedText3,
    textTransform: 'uppercase',
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
