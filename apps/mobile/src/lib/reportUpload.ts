import type { User as AuthUser } from '@supabase/supabase-js';
import {
  canCreateReport,
  classifyLabValue,
  type LabReportContext,
  type ReportStatus,
  type User,
} from '@amani/shared';
import { supabase } from './supabase';

export type UploadReportStage =
  | 'uploading'
  | 'extracting'
  | 'saving'
  | 'interpreting';

export interface UploadableReportFile {
  uri: string;
  name: string;
  mimeType?: string | null;
}

interface ExtractedAnalyte {
  raw_name: string;
  raw_value_text: string | null;
  value_numeric: number;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_min: number | null;
  normalized_max: number | null;
  normalized_operator: string | null;
  normalized_operator_value: number | null;
  source_snippet: string | null;
  confidence_score: 'high' | 'medium' | 'low';
  canonical_analyte_id: string | null;
  canonical_slug: string | null;
  parse_status: 'mapped' | 'partial' | 'unmapped';
  needs_review: boolean;
  is_core: boolean;
  category: string | null;
  display_name?: string | null;
  system_category?: string | null;
  normalization_status?: string | null;
  source_format?: string | null;
  parser_version?: string | null;
  unit_original?: string | null;
  unit_normalized?: string | null;
  review_status?: string | null;
  reviewed_by_user?: boolean | null;
}

interface UploadReportInput {
  user: AuthUser;
  userProfile: User | null;
  file: UploadableReportFile;
  reportDate: string;
  lastPeriodDate?: string | null;
  cycleLength: number;
  labSource?: 'quest' | 'labcorp' | 'unknown';
  importMethod?: 'guided_portal_pdf' | 'direct_upload' | 'manual';
  onStageChange?: (stage: UploadReportStage | null) => void;
}

function assertIsoDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD format.`);
  }
}

function calculateCycleInfo(reportDate: string, lastPeriodDate?: string | null) {
  if (!lastPeriodDate) {
    return {
      cycleDay: null,
      cyclePhase: 'unknown' as const,
    };
  }

  const reportDateObj = new Date(reportDate);
  const lastPeriodDateObj = new Date(lastPeriodDate);
  const daysDiff = Math.floor(
    (reportDateObj.getTime() - lastPeriodDateObj.getTime()) / (1000 * 60 * 60 * 24)
  );
  const cycleDay = daysDiff + 1;

  if (cycleDay >= 1 && cycleDay <= 5) {
    return { cycleDay, cyclePhase: 'menstrual' as const };
  }
  if (cycleDay >= 6 && cycleDay <= 12) {
    return { cycleDay, cyclePhase: 'follicular' as const };
  }
  if (cycleDay >= 13 && cycleDay <= 16) {
    return { cycleDay, cyclePhase: 'ovulatory' as const };
  }
  if (cycleDay >= 17 && cycleDay <= 35) {
    return { cycleDay, cyclePhase: 'luteal' as const };
  }

  return { cycleDay, cyclePhase: 'unknown' as const };
}

function deriveFlaggedStatus(analyte: ExtractedAnalyte): 'in_range' | 'borderline' | 'out_of_range' | 'unknown' {
  return classifyLabValue(
    analyte.value_numeric,
    analyte.normalized_min,
    analyte.normalized_max,
    analyte.normalized_operator,
    analyte.normalized_operator_value
  );
}

function normalizeAnalyte(item: Record<string, unknown>, sourceFormat?: string | null, parserVersion?: string | null): ExtractedAnalyte {
  return {
    raw_name: String(item.raw_name ?? item.name ?? 'Unknown analyte'),
    raw_value_text: item.raw_value_text != null ? String(item.raw_value_text) : item.value_text != null ? String(item.value_text) : null,
    value_numeric: Number(item.value_numeric),
    unit: item.unit != null ? String(item.unit) : null,
    raw_reference_range: item.raw_reference_range != null ? String(item.raw_reference_range) : null,
    normalized_min: item.normalized_min != null ? Number(item.normalized_min) : item.normalized_reference_min != null ? Number(item.normalized_reference_min) : null,
    normalized_max: item.normalized_max != null ? Number(item.normalized_max) : item.normalized_reference_max != null ? Number(item.normalized_reference_max) : null,
    normalized_operator: item.normalized_operator != null ? String(item.normalized_operator) : item.reference_operator != null ? String(item.reference_operator) : null,
    normalized_operator_value: item.normalized_operator_value != null ? Number(item.normalized_operator_value) : item.reference_operator_value != null ? Number(item.reference_operator_value) : null,
    source_snippet: item.source_snippet != null ? String(item.source_snippet) : null,
    confidence_score: (item.confidence_score as 'high' | 'medium' | 'low' | undefined) ?? 'low',
    canonical_analyte_id: item.canonical_analyte_id != null ? String(item.canonical_analyte_id) : null,
    canonical_slug: item.canonical_slug != null ? String(item.canonical_slug) : null,
    parse_status: (item.parse_status as 'mapped' | 'partial' | 'unmapped' | undefined) ?? ((item.canonical_slug ? 'partial' : 'unmapped')),
    needs_review: Boolean(item.needs_review),
    is_core: Boolean(item.is_core ?? item.is_core_biomarker),
    category: item.category != null ? String(item.category) : null,
    display_name: item.display_name != null ? String(item.display_name) : null,
    system_category: item.system_category != null ? String(item.system_category) : item.category != null ? String(item.category) : null,
    normalization_status: item.normalization_status != null ? String(item.normalization_status) : null,
    source_format: item.source_format != null ? String(item.source_format) : sourceFormat ?? null,
    parser_version: item.parser_version != null ? String(item.parser_version) : parserVersion ?? null,
    unit_original: item.unit_original != null ? String(item.unit_original) : item.unit != null ? String(item.unit) : null,
    unit_normalized: item.unit_normalized != null ? String(item.unit_normalized) : item.unit != null ? String(item.unit) : null,
    review_status: item.review_status != null ? String(item.review_status) : 'pending',
    reviewed_by_user: item.reviewed_by_user != null ? Boolean(item.reviewed_by_user) : false,
  };
}

function normalizeExtractionResponse(data: Record<string, unknown>) {
  const analytes =
    Array.isArray(data.analytes)
      ? data.analytes
      : Array.isArray(data.items)
        ? data.items
        : [];

  return analytes
    .map((item) => normalizeAnalyte(item as Record<string, unknown>, data._source_format as string | undefined, data._parser_version as string | undefined))
    .filter((item) => Number.isFinite(item.value_numeric));
}

async function triggerInterpretation(reportId: string) {
  const { error } = await supabase.functions.invoke('generate-interpretation', {
    body: { reportId },
  });

  if (error) {
    await supabase.from('lab_reports').update({ status: 'ready' satisfies ReportStatus }).eq('id', reportId);
  }
}

export async function uploadAndProcessReport({
  user,
  userProfile,
  file,
  reportDate,
  lastPeriodDate = null,
  cycleLength,
  labSource = 'unknown',
  importMethod = 'direct_upload',
  onStageChange,
}: UploadReportInput) {
  if (!canCreateReport(userProfile)) {
    throw new Error('An active subscription or trial is required to upload new lab reports.');
  }

  assertIsoDate(reportDate, 'Report date');
  if (lastPeriodDate) {
    assertIsoDate(lastPeriodDate, 'Last period date');
  }

  let createdReportId: string | null = null;

  try {
    onStageChange?.('uploading');

    const uploadResponse = await fetch(file.uri);
    const fileData = await uploadResponse.arrayBuffer();
    const fileExtension = file.name.split('.').pop()?.toLowerCase() ?? (file.mimeType?.includes('pdf') ? 'pdf' : 'jpg');
    const sanitizedBaseName = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-');
    const storagePath = `${user.id}/${Date.now()}-${sanitizedBaseName}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage.from('lab-files').upload(storagePath, fileData, {
      contentType: file.mimeType ?? undefined,
    });

    if (uploadError) {
      throw new Error(`File upload failed: ${uploadError.message}`);
    }

    const { cycleDay, cyclePhase } = calculateCycleInfo(reportDate, lastPeriodDate);
    const context: LabReportContext = {
      birth_control: 'unsure',
      pregnant: 'unsure',
      postpartum: 'unsure',
      top_symptoms: [],
      submission_mode: 'standard',
    };

    const { data: reportRow, error: reportError } = await supabase
      .from('lab_reports')
      .insert({
        user_id: user.id,
        report_date: reportDate,
        file_url: storagePath,
        last_period_start_date: lastPeriodDate,
        average_cycle_length: cycleLength,
        estimated_cycle_day: cycleDay,
        estimated_cycle_phase: cyclePhase,
        context,
        status: 'processing' satisfies ReportStatus,
        lab_source: labSource,
        import_method: importMethod,
      })
      .select('id')
      .single();

    if (reportError || !reportRow) {
      throw new Error(`Failed to create report: ${reportError?.message ?? 'Unknown error'}`);
    }

    createdReportId = reportRow.id as string;

    onStageChange?.('extracting');
    const { data: extractionData, error: extractionError } = await supabase.functions.invoke('extract-lab-report', {
      body: {
        storagePath,
        mimeType: file.mimeType ?? null,
        fileName: file.name,
      },
    });

    if (extractionError) {
      throw new Error(`Extraction failed: ${extractionError.message}`);
    }

    const extractedAnalytes = normalizeExtractionResponse((extractionData ?? {}) as Record<string, unknown>);

    if (extractedAnalytes.length === 0) {
      throw new Error('No biomarkers were detected in this file.');
    }

    onStageChange?.('saving');

    const analyteRows = extractedAnalytes.map((analyte) => ({
      lab_report_id: createdReportId!,
      raw_name: analyte.raw_name,
      raw_value_text: analyte.raw_value_text,
      value_numeric: analyte.value_numeric,
      unit: analyte.unit,
      raw_reference_range: analyte.raw_reference_range,
      normalized_min: analyte.normalized_min,
      normalized_max: analyte.normalized_max,
      normalized_operator: analyte.normalized_operator,
      normalized_operator_value: analyte.normalized_operator_value,
      source_snippet: analyte.source_snippet,
      confidence_score: analyte.confidence_score,
      canonical_analyte_id: analyte.canonical_analyte_id,
      canonical_slug: analyte.canonical_slug,
      parse_status: analyte.parse_status,
      needs_review: analyte.needs_review,
      is_core: analyte.is_core,
      display_name: analyte.display_name,
      system_category: analyte.system_category,
      normalization_status: analyte.normalization_status ?? analyte.parse_status,
      source_format: analyte.source_format ?? 'unknown',
      parser_version: analyte.parser_version,
      unit_original: analyte.unit_original ?? analyte.unit,
      unit_normalized: analyte.unit_normalized ?? analyte.unit,
      review_status: analyte.review_status ?? 'pending',
      reviewed_by_user: analyte.reviewed_by_user ?? false,
    }));

    const { error: analyteError } = await supabase.from('report_analytes').insert(analyteRows);

    if (analyteError) {
      throw new Error(`Failed to save analytes: ${analyteError.message}`);
    }

    const biomarkerRows = extractedAnalytes
      .filter((analyte) => analyte.is_core && analyte.canonical_slug)
      .map((analyte) => ({
        lab_report_id: createdReportId!,
        name: analyte.canonical_slug!,
        value: analyte.value_numeric,
        raw_value_text: analyte.raw_value_text,
        unit: analyte.unit_normalized ?? analyte.unit ?? '',
        reference_min: analyte.normalized_min,
        reference_max: analyte.normalized_max,
        flagged: deriveFlaggedStatus(analyte),
      }));

    if (biomarkerRows.length > 0) {
      const { error: biomarkerError } = await supabase.from('biomarkers').insert(biomarkerRows);
      if (biomarkerError) {
        throw new Error(`Failed to save biomarkers: ${biomarkerError.message}`);
      }
    }

    onStageChange?.('interpreting');
    void triggerInterpretation(createdReportId);

    return {
      reportId: createdReportId,
      extractedCount: extractedAnalytes.length,
    };
  } catch (error) {
    if (createdReportId) {
      await supabase.from('lab_reports').update({ status: 'error' satisfies ReportStatus }).eq('id', createdReportId);
    }
    throw error;
  } finally {
    onStageChange?.(null);
  }
}
