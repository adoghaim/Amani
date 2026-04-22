import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { canCreateReport } from '@amani/shared';
import {
  ChevronLeft,
  ExternalLink,
  FileText,
  FlaskConical,
  Upload,
} from 'lucide-react-native';
import { Button, Card, DateField, Input, Notice, Text } from '../components';
import { useAuth } from '../contexts/AuthContext';
import { uploadAndProcessReport, type UploadReportStage } from '../lib/reportUpload';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';

const QUEST_URL = 'https://myquest.questdiagnostics.com/';
const LABCORP_URL = 'https://patient.labcorp.com/';

function parseDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date();
  }

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function UploadReportScreen() {
  const navigation = useNavigation<any>();
  const { user, userProfile } = useAuth();
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [lastPeriodDate, setLastPeriodDate] = useState('');
  const [cycleLength, setCycleLength] = useState(
    userProfile?.default_cycle_length ? String(userProfile.default_cycle_length) : '28'
  );
  const [labSource, setLabSource] = useState<'quest' | 'labcorp' | 'unknown'>('unknown');
  const [stage, setStage] = useState<UploadReportStage | null>(null);
  const [loadingDefaults, setLoadingDefaults] = useState(true);
  const [error, setError] = useState('');
  const [portalHint, setPortalHint] = useState('');

  const canUpload = useMemo(() => canCreateReport(userProfile), [userProfile]);
  const stageLabels: Record<UploadReportStage, string> = {
    uploading: 'Uploading your file…',
    extracting: 'Extracting biomarkers…',
    saving: 'Saving your report…',
    interpreting: 'Generating your analysis…',
  };

  useEffect(() => {
    let cancelled = false;

    const fetchDefaults = async () => {
      if (!user) {
        setLoadingDefaults(false);
        return;
      }

      try {
        const { data } = await supabase
          .from('period_logs')
          .select('start_date')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!cancelled && data?.start_date) {
          setLastPeriodDate(data.start_date);
        }
      } catch (fetchError) {
        if (!cancelled) {
          console.error('Failed to load upload defaults:', fetchError);
        }
      } finally {
        if (!cancelled) {
          setLoadingDefaults(false);
        }
      }
    };

    void fetchDefaults();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handlePickFile = async () => {
    setError('');
    setPortalHint('');

    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    setSelectedFile(asset);

    if (asset.name.toLowerCase().includes('quest')) {
      setLabSource('quest');
    } else if (asset.name.toLowerCase().includes('labcorp')) {
      setLabSource('labcorp');
    }
  };

  const openPortalBrowser = async (
    source: 'quest' | 'labcorp',
    url: string
  ) => {
    setLabSource(source);
    setError('');
    setPortalHint('Download the PDF in the portal, then return here and choose the file from your device.');

    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (browserError) {
      setError(
        browserError instanceof Error
          ? browserError.message
          : 'Unable to open the lab portal.'
      );
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      setError('Please sign in again before uploading.');
      return;
    }

    if (!selectedFile) {
      setError('Choose a PDF or image to continue.');
      return;
    }

    const cycleLengthValue = Number(cycleLength);
    if (!Number.isInteger(cycleLengthValue) || cycleLengthValue < 21 || cycleLengthValue > 45) {
      setError('Enter a cycle length between 21 and 45 days.');
      return;
    }

    if (lastPeriodDate && lastPeriodDate > reportDate) {
      setError('Last period start cannot be after the report date.');
      return;
    }

    setError('');

    try {
      const result = await uploadAndProcessReport({
        user,
        userProfile,
        file: {
          uri: selectedFile.uri,
          name: selectedFile.name,
          mimeType: selectedFile.mimeType,
        },
        reportDate,
        lastPeriodDate: lastPeriodDate || null,
        cycleLength: cycleLengthValue,
        labSource,
        importMethod: labSource === 'unknown' ? 'direct_upload' : 'guided_portal_pdf',
        onStageChange: setStage,
      });

      navigation.replace('ReportDetail', { reportId: result.reportId });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to upload this report.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text variant="titleSm">Upload Lab Report</Text>
            <Text variant="caption" tone="muted">
              PDF and image uploads with mobile-native picking.
            </Text>
          </View>
        </View>

        {!canUpload ? (
          <View style={styles.blockedState}>
            <Notice tone="error" style={styles.notice}>
              Your free trial has ended. Open billing to start a subscription before uploading another report.
            </Notice>
            <Button
              label="Open Billing"
              variant="outline"
              onPress={() => navigation.navigate('Billing')}
            />
          </View>
        ) : null}

        {stage ? (
          <Notice tone="info" style={styles.notice}>
            {stageLabels[stage]}
          </Notice>
        ) : null}

        {!stage && portalHint ? (
          <Notice tone="info" style={styles.notice}>
            {portalHint}
          </Notice>
        ) : null}

        {error ? (
          <Notice tone="error" style={styles.notice}>
            {error}
          </Notice>
        ) : null}

        <Card style={styles.portalCard}>
          <Text variant="body" weight="bold">
            Import from an official portal
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.sectionBody}>
            Quest and Labcorp PDFs usually produce the best extraction quality.
          </Text>

          <View style={styles.portalGrid}>
            <Pressable
              onPress={() => {
                void openPortalBrowser('quest', QUEST_URL);
              }}
              style={[
                styles.portalButton,
                labSource === 'quest' ? styles.portalButtonActive : null,
              ]}
            >
              <View style={styles.portalIcon}>
                <FlaskConical size={18} color={theme.colors.success} />
              </View>
              <View style={styles.portalCopy}>
                <Text variant="bodySm" weight="semibold">
                  Quest Diagnostics
                </Text>
                <Text variant="caption" tone="muted">
                  Open MyQuest
                </Text>
              </View>
              <ExternalLink size={16} color={theme.colors.mutedText3} />
            </Pressable>

            <Pressable
              onPress={() => {
                void openPortalBrowser('labcorp', LABCORP_URL);
              }}
              style={[
                styles.portalButton,
                labSource === 'labcorp' ? styles.portalButtonActive : null,
              ]}
            >
              <View style={styles.portalIcon}>
                <FlaskConical size={18} color={theme.colors.primary} />
              </View>
              <View style={styles.portalCopy}>
                <Text variant="bodySm" weight="semibold">
                  Labcorp
                </Text>
                <Text variant="caption" tone="muted">
                  Open patient portal
                </Text>
              </View>
              <ExternalLink size={16} color={theme.colors.mutedText3} />
            </Pressable>
          </View>
        </Card>

        <Card style={styles.uploadCard}>
          <Text variant="body" weight="bold">
            Choose file
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.sectionBody}>
            Supported formats: PDF, JPG, and PNG.
          </Text>

          <Pressable onPress={handlePickFile} style={styles.filePicker}>
            <View style={styles.filePickerIcon}>
              <Upload size={24} color={theme.colors.primary} />
            </View>
            <View style={styles.filePickerCopy}>
              <Text variant="body" weight="semibold">
                {selectedFile ? selectedFile.name : 'Select report from device'}
              </Text>
              <Text variant="caption" tone="muted">
                {selectedFile
                  ? `${selectedFile.mimeType ?? 'Document'}${selectedFile.size ? ` • ${(selectedFile.size / 1024 / 1024).toFixed(1)} MB` : ''}`
                  : 'Tap to open the native file picker.'}
              </Text>
            </View>
            <FileText size={18} color={theme.colors.mutedText3} />
          </Pressable>
        </Card>

        <Card>
          <Text variant="body" weight="bold">
            Report details
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.sectionBody}>
            We use these dates to keep cycle-aware interpretation aligned to the draw date.
          </Text>

          <View style={styles.formGroup}>
            <DateField
              label="Report date"
              value={reportDate}
              onChange={setReportDate}
              maximumDate={new Date()}
            />

            <DateField
              label="Last period start"
              value={lastPeriodDate}
              onChange={setLastPeriodDate}
              hint={loadingDefaults ? 'Loading your latest period log…' : 'Optional but recommended for cycle-aware analysis.'}
              allowClear
              maximumDate={reportDate ? parseDateValue(reportDate) : new Date()}
            />

            <Input
              label="Typical cycle length"
              value={cycleLength}
              onChangeText={setCycleLength}
              keyboardType="number-pad"
              placeholder="28"
              hint="Used when the report date is outside your most recent logged cycle."
            />
          </View>
        </Card>

        <Button
          label={stage ? stageLabels[stage] : 'Upload and Analyze'}
          onPress={handleSubmit}
          disabled={!canUpload || !selectedFile || loadingDefaults}
          loading={Boolean(stage)}
          fullWidth
          style={styles.submitButton}
        />

        {!selectedFile && !loadingDefaults ? (
          <View style={styles.footerHint}>
            <ActivityIndicator size="small" color={theme.colors.background} style={styles.hiddenSpinner} />
            <Text variant="caption" tone="muted" style={styles.footerText}>
              Pick a file first, then start the upload.
            </Text>
          </View>
        ) : null}
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
    gap: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  notice: {
    marginTop: -theme.spacing.xs,
  },
  blockedState: {
    gap: theme.spacing.sm,
  },
  portalCard: {
    gap: theme.spacing.sm,
  },
  sectionBody: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  portalGrid: {
    gap: theme.spacing.sm,
  },
  portalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    backgroundColor: theme.colors.surface2,
    padding: theme.spacing.md,
  },
  portalButtonActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.backgroundTint,
  },
  portalIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portalCopy: {
    flex: 1,
  },
  uploadCard: {
    gap: theme.spacing.sm,
  },
  filePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    borderRadius: theme.radii.md,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.backgroundTint,
  },
  filePickerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filePickerCopy: {
    flex: 1,
  },
  formGroup: {
    gap: theme.spacing.md,
  },
  submitButton: {
    marginTop: theme.spacing.xs,
  },
  footerHint: {
    alignItems: 'center',
  },
  footerText: {
    textAlign: 'center',
  },
  hiddenSpinner: {
    opacity: 0,
    height: 0,
    width: 0,
  },
});
