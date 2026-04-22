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
  Plus,
  Sparkles,
  Upload,
  X,
} from 'lucide-react-native';
import { Button, Card, DateField, Input, Notice, Text } from '../components';
import { useAuth } from '../contexts/AuthContext';
import {
  uploadAndProcessReport,
  uploadManualReport,
  type UploadReportStage,
} from '../lib/reportUpload';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';

const QUEST_URL = 'https://myquest.questdiagnostics.com/';
const LABCORP_URL = 'https://patient.labcorp.com/';

type EntryMode = 'upload' | 'manual';

interface ManualEntryDraft {
  id: string;
  name: string;
  value: string;
  unit: string;
  referenceMin: string;
  referenceMax: string;
}

interface CatalogBiomarker {
  slug: string;
  name: string;
  unit: string | null;
}

function parseDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date();
  }

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function normalizeBiomarkerLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function emptyManualEntry(): ManualEntryDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    value: '',
    unit: '',
    referenceMin: '',
    referenceMax: '',
  };
}

export function UploadReportScreen() {
  const navigation = useNavigation<any>();
  const { user, userProfile } = useAuth();
  const [mode, setMode] = useState<EntryMode>('upload');
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
  const [manualAssistMessage, setManualAssistMessage] = useState('');
  const [portalHint, setPortalHint] = useState('');
  const [manualEntries, setManualEntries] = useState<ManualEntryDraft[]>([emptyManualEntry()]);
  const [manualReviewStep, setManualReviewStep] = useState(false);
  const [catalog, setCatalog] = useState<CatalogBiomarker[]>([]);

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
        const [periodResult, catalogResult] = await Promise.all([
          supabase
            .from('period_logs')
            .select('start_date')
            .eq('user_id', user.id)
            .order('start_date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('biomarker_catalog').select('slug, name, unit').order('name'),
        ]);

        if (!cancelled && periodResult.data?.start_date) {
          setLastPeriodDate(periodResult.data.start_date);
        }

        if (!cancelled && catalogResult.data) {
          setCatalog(catalogResult.data as CatalogBiomarker[]);
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
    setManualAssistMessage('');

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

  const updateManualEntry = (id: string, field: keyof ManualEntryDraft, value: string) => {
    setManualEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry))
    );
  };

  const manualPreview = useMemo(() => {
    return manualEntries
      .map((entry) => {
        const numericValue = Number(entry.value);
        if (!entry.name.trim() || !Number.isFinite(numericValue)) {
          return null;
        }

        const normalizedName = normalizeBiomarkerLabel(entry.name);
        const match =
          catalog.find((item) => normalizeBiomarkerLabel(item.slug) === normalizedName)
          ?? catalog.find((item) => normalizeBiomarkerLabel(item.name) === normalizedName);

        return {
          ...entry,
          valueNumber: numericValue,
          normalizedMin: entry.referenceMin.trim() ? Number(entry.referenceMin) : null,
          normalizedMax: entry.referenceMax.trim() ? Number(entry.referenceMax) : null,
          canonicalSlug: match?.slug ?? null,
          canonicalName: match?.name ?? null,
          defaultUnit: match?.unit ?? null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [catalog, manualEntries]);

  const validateSharedFields = () => {
    const cycleLengthValue = Number(cycleLength);
    if (!Number.isInteger(cycleLengthValue) || cycleLengthValue < 21 || cycleLengthValue > 45) {
      setError('Enter a cycle length between 21 and 45 days.');
      return null;
    }

    if (lastPeriodDate && lastPeriodDate > reportDate) {
      setError('Last period start cannot be after the report date.');
      return null;
    }

    return cycleLengthValue;
  };

  const handleSubmit = async () => {
    if (!user) {
      setError('Please sign in again before uploading.');
      return;
    }

    const cycleLengthValue = validateSharedFields();
    if (!cycleLengthValue) {
      return;
    }

    setError('');

    try {
      if (mode === 'manual') {
        if (!manualReviewStep) {
          if (manualPreview.length === 0) {
            setError('Add at least one biomarker name and numeric value to continue.');
            return;
          }
          setManualReviewStep(true);
          return;
        }

        const result = await uploadManualReport({
          user,
          userProfile,
          reportDate,
          lastPeriodDate: lastPeriodDate || null,
          cycleLength: cycleLengthValue,
          labSource,
          entries: manualPreview.map((entry) => ({
            name: entry.name.trim(),
            value: entry.valueNumber,
            unit: entry.unit.trim() || entry.defaultUnit || null,
            normalizedMin: Number.isFinite(entry.normalizedMin) ? entry.normalizedMin : null,
            normalizedMax: Number.isFinite(entry.normalizedMax) ? entry.normalizedMax : null,
            rawReferenceRange:
              entry.referenceMin.trim() || entry.referenceMax.trim()
                ? `${entry.referenceMin || '-'} - ${entry.referenceMax || '-'}`
                : null,
            canonicalSlug: entry.canonicalSlug,
          })),
          onStageChange: setStage,
        });

        navigation.replace('ReportDetail', { reportId: result.reportId });
        return;
      }

      if (!selectedFile) {
        setError('Choose a PDF or image to continue.');
        return;
      }

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
      const message = submitError instanceof Error ? submitError.message : 'Unable to upload this report.';
      setError(message);
      if (message.toLowerCase().includes('no biomarkers were detected')) {
        setMode('manual');
        setManualReviewStep(false);
        setManualAssistMessage(
          selectedFile
            ? `We couldn't extract biomarkers from ${selectedFile.name}. Enter them manually below to continue.`
            : "We couldn't extract biomarkers from your file. Enter them manually below to continue."
        );
      }
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
              Upload a file or enter biomarkers manually.
            </Text>
          </View>
        </View>

        <Card style={styles.modeCard}>
          <Text variant="body" weight="bold">Choose entry method</Text>
          <View style={styles.modeRow}>
            <Pressable
              onPress={() => {
                setMode('upload');
                setManualReviewStep(false);
                setError('');
                setManualAssistMessage('');
              }}
              style={[styles.modeButton, mode === 'upload' ? styles.modeButtonActive : null]}
            >
              <Upload size={18} color={theme.colors.primary} />
              <Text variant="bodySm" weight="semibold">Upload + OCR</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMode('manual');
                setManualReviewStep(false);
                setError('');
                setManualAssistMessage('');
              }}
              style={[styles.modeButton, mode === 'manual' ? styles.modeButtonActive : null]}
            >
              <Sparkles size={18} color={theme.colors.primary} />
              <Text variant="bodySm" weight="semibold">Manual entry</Text>
            </Pressable>
          </View>
        </Card>

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

        {!stage && portalHint && mode === 'upload' ? (
          <Notice tone="info" style={styles.notice}>
            {portalHint}
          </Notice>
        ) : null}

        {error ? (
          <Notice tone="error" style={styles.notice}>
            {error}
          </Notice>
        ) : null}

        {!stage && manualAssistMessage ? (
          <Notice tone="info" style={styles.notice}>
            {manualAssistMessage}
          </Notice>
        ) : null}

        {mode === 'upload' ? (
          <>
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

              <Button
                label="Can't read this file? Enter manually"
                variant="outline"
                onPress={() => {
                  setMode('manual');
                  setManualReviewStep(false);
                  setError('');
                  setManualAssistMessage(
                    selectedFile
                      ? `Switched to manual entry for ${selectedFile.name}. You can still submit this report without OCR.`
                      : 'Switched to manual entry. Add biomarkers directly to continue.'
                  );
                }}
              />
            </Card>
          </>
        ) : (
          <Card>
            {!manualReviewStep ? (
              <>
                <Text variant="body" weight="bold">Manual biomarkers</Text>
                <Text variant="bodySm" tone="muted" style={styles.sectionBody}>
                  Enter results if extraction fails or if you prefer to review values before upload.
                </Text>

                <View style={styles.formGroup}>
                  {manualEntries.map((entry, index) => (
                    <View key={entry.id} style={styles.manualEntryCard}>
                      <View style={styles.manualEntryHeader}>
                        <Text variant="bodySm" weight="semibold">Biomarker {index + 1}</Text>
                        {manualEntries.length > 1 ? (
                          <Pressable
                            onPress={() => setManualEntries((current) => current.filter((item) => item.id !== entry.id))}
                          >
                            <X size={18} color={theme.colors.mutedText} />
                          </Pressable>
                        ) : null}
                      </View>

                      <Input
                        label="Name"
                        value={entry.name}
                        onChangeText={(value) => updateManualEntry(entry.id, 'name', value)}
                        placeholder="e.g. Ferritin"
                      />
                      <Input
                        label="Value"
                        value={entry.value}
                        onChangeText={(value) => updateManualEntry(entry.id, 'value', value)}
                        keyboardType="decimal-pad"
                        placeholder="e.g. 48"
                      />
                      <Input
                        label="Unit (optional)"
                        value={entry.unit}
                        onChangeText={(value) => updateManualEntry(entry.id, 'unit', value)}
                        placeholder="e.g. ng/mL"
                      />

                      <View style={styles.inlineInputs}>
                        <Input
                          label="Ref min"
                          value={entry.referenceMin}
                          onChangeText={(value) => updateManualEntry(entry.id, 'referenceMin', value)}
                          keyboardType="decimal-pad"
                          placeholder="optional"
                          containerStyle={styles.inlineInput}
                        />
                        <Input
                          label="Ref max"
                          value={entry.referenceMax}
                          onChangeText={(value) => updateManualEntry(entry.id, 'referenceMax', value)}
                          keyboardType="decimal-pad"
                          placeholder="optional"
                          containerStyle={styles.inlineInput}
                        />
                      </View>
                    </View>
                  ))}

                  <Button
                    label="Add biomarker"
                    variant="outline"
                    icon={<Plus size={16} color={theme.colors.primary} />}
                    onPress={() => setManualEntries((current) => [...current, emptyManualEntry()])}
                  />
                </View>
              </>
            ) : (
              <>
                <Text variant="body" weight="bold">Review manual entries</Text>
                <Text variant="bodySm" tone="muted" style={styles.sectionBody}>
                  We matched entries to core biomarkers when possible.
                </Text>

                <View style={styles.formGroup}>
                  {manualPreview.map((entry) => (
                    <View key={entry.id} style={styles.reviewRow}>
                      <View style={styles.reviewRowCopy}>
                        <Text variant="bodySm" weight="semibold">{entry.name}</Text>
                        <Text variant="caption" tone="muted">
                          {entry.valueNumber} {entry.unit || entry.defaultUnit || ''}
                        </Text>
                      </View>
                      <Text variant="caption" tone={entry.canonicalSlug ? 'default' : 'muted'}>
                        {entry.canonicalSlug ? `Mapped to ${entry.canonicalName}` : 'Saved as extended marker'}
                      </Text>
                    </View>
                  ))}
                </View>

                <Button
                  label="Back to edit"
                  variant="outline"
                  onPress={() => setManualReviewStep(false)}
                />
              </>
            )}
          </Card>
        )}

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
          label={
            stage
              ? stageLabels[stage]
              : mode === 'manual' && !manualReviewStep
                ? 'Review Manual Entries'
                : mode === 'manual'
                  ? 'Save Manual Report'
                  : 'Upload and Analyze'
          }
          onPress={handleSubmit}
          disabled={!canUpload || loadingDefaults || (mode === 'upload' && !selectedFile)}
          loading={Boolean(stage)}
          fullWidth
          style={styles.submitButton}
        />

        {mode === 'upload' && !selectedFile && !loadingDefaults ? (
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
  modeCard: {
    gap: theme.spacing.sm,
  },
  modeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface2,
  },
  modeButtonActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.backgroundTint,
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
  manualEntryCard: {
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface2,
  },
  manualEntryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  inlineInput: {
    flex: 1,
  },
  reviewRow: {
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface2,
    gap: theme.spacing.xs,
  },
  reviewRowCopy: {
    gap: 2,
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
