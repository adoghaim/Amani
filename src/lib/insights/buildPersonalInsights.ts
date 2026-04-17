import type {
  PersonalPattern,
  SymptomLog,
  DailySymptom,
} from '../../types';
import { PERSONALIZATION_THRESHOLDS } from '../../types';
import { computeBaseline } from '../personalization/baseline';
import { analyzeTrend } from '../personalization/trendAnalysis';
import { findSymptomCorrelations } from '../personalization/symptomCorrelation';
import { getDisplayName } from '../biomarkers/dictionary';
import type { BiomarkerName } from '../../types';

type BiomarkerFlagStatus = 'out_of_range' | 'borderline' | 'in_range' | 'unknown';

interface CurrentBiomarker {
  name: string;
  value: number;
  flagged: BiomarkerFlagStatus;
}

interface HistoricalEntry {
  reportDate: string;
  value: number;
}

function formatSymptomLabel(symptom: string): string {
  return symptom.replace(/_/g, ' ');
}

function getDisplayLabel(biomarkerName: string): string {
  try {
    return getDisplayName(biomarkerName as BiomarkerName) ?? biomarkerName.replace(/_/g, ' ');
  } catch {
    return biomarkerName.replace(/_/g, ' ');
  }
}

function buildBaselinePatterns(
  currentBiomarkers: CurrentBiomarker[],
  historicalData: Map<string, HistoricalEntry[]>
): PersonalPattern[] {
  const patterns: PersonalPattern[] = [];

  for (const biomarker of currentBiomarkers) {
    const history = historicalData.get(biomarker.name);
    if (!history || history.length < PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_BASELINE) continue;

    const historicalValues = history
      .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
      .map(h => h.value);

    const result = computeBaseline(historicalValues, biomarker.value);
    if (!result) continue;
    if (result.baselineStatus === 'near_baseline') continue;

    const displayName = getDisplayLabel(biomarker.name);
    const direction = result.baselineStatus === 'above_baseline' ? 'higher' : 'lower';
    const absDeviation = Math.abs(result.deviationPercent).toFixed(0);

    patterns.push({
      type: 'baseline',
      biomarker: biomarker.name,
      summary: `Your ${displayName} is ${direction} than your usual level (${absDeviation}% from your typical baseline).`,
      severity: 'info',
      supportingData: { baselineResult: result },
    });
  }

  return patterns;
}

const MARKERS_WHERE_HIGH_IS_BAD: ReadonlySet<string> = new Set([
  'tsh', 'tpo_antibodies', 'tg_antibodies', 'reverse_t3',
  'fasting_glucose', 'hemoglobin_a1c', 'fasting_insulin', 'c_peptide',
  'total_cholesterol', 'ldl_cholesterol', 'triglycerides', 'non_hdl_cholesterol', 'apob', 'lpa',
  'ast', 'alt', 'ggt', 'alkaline_phosphatase', 'bilirubin_total',
  'creatinine', 'bun',
  'hs_crp', 'esr',
  'prolactin', 'shbg',
]);

const MARKERS_WHERE_LOW_IS_BAD: ReadonlySet<string> = new Set([
  'ferritin', 'vitamin_d_25_oh', 'vitamin_b12', 'folate', 'magnesium',
  'hemoglobin', 'hematocrit', 'rbc', 'iron_saturation',
  'egfr', 'hdl_cholesterol', 'free_t3', 'free_t4',
  'estradiol', 'progesterone', 'dheas', 'amh',
  'albumin', 'total_protein', 'potassium',
]);

function getTrendInterpretation(
  biomarkerName: string,
  trendDirection: 'rising' | 'falling',
  flagged: 'out_of_range' | 'borderline' | 'in_range' | 'unknown',
): 'improving_still_abnormal' | 'worsening' | 'direction_only' {
  const isAbnormal = flagged === 'out_of_range' || flagged === 'borderline';
  if (!isAbnormal) return 'direction_only';

  const highIsBad = MARKERS_WHERE_HIGH_IS_BAD.has(biomarkerName);
  const lowIsBad = MARKERS_WHERE_LOW_IS_BAD.has(biomarkerName);

  if (highIsBad && trendDirection === 'falling') return 'improving_still_abnormal';
  if (highIsBad && trendDirection === 'rising') return 'worsening';
  if (lowIsBad && trendDirection === 'rising') return 'improving_still_abnormal';
  if (lowIsBad && trendDirection === 'falling') return 'worsening';

  return 'direction_only';
}

function buildTrendPatterns(
  currentBiomarkers: CurrentBiomarker[],
  historicalData: Map<string, HistoricalEntry[]>
): PersonalPattern[] {
  const patterns: PersonalPattern[] = [];

  for (const biomarker of currentBiomarkers) {
    const history = historicalData.get(biomarker.name);
    if (!history || history.length < PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_TREND) continue;

    const ordered = history
      .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
      .map(h => h.value);

    const allValues = [...ordered, biomarker.value];
    const result = analyzeTrend(allValues);
    if (!result) continue;
    if (result.trendDirection === 'stable' || result.trendDirection === 'fluctuating' || result.trendDirection === 'insufficient_data') continue;
    if (result.trendStrength === 'weak') continue;

    const displayName = getDisplayLabel(biomarker.name);
    const trendDir = result.trendDirection as 'rising' | 'falling';
    const interpretation = getTrendInterpretation(biomarker.name, trendDir, biomarker.flagged);

    let summary: string;
    let severity: PersonalPattern['severity'];

    if (interpretation === 'improving_still_abnormal') {
      const dirLabel = trendDir === 'falling' ? 'coming down' : 'rising';
      summary = `Your ${displayName} is ${dirLabel} across your recent reports — a positive direction, though it remains outside the optimal range. Continue tracking.`;
      severity = 'info';
    } else if (interpretation === 'worsening') {
      const dirLabel = trendDir === 'rising' ? 'trending upward' : 'trending downward';
      summary = `Your ${displayName} has been ${dirLabel} across your recent reports while remaining outside the optimal range. Worth bringing to your provider's attention.`;
      severity = 'caution';
    } else {
      const dirLabel = trendDir === 'rising' ? 'trending upward' : 'trending downward';
      summary = `Your ${displayName} has been ${dirLabel} across your recent reports. This may be worth tracking over time.`;
      severity = result.trendStrength === 'strong' ? 'caution' : 'info';
    }

    patterns.push({
      type: 'trend',
      biomarker: biomarker.name,
      summary,
      severity,
      supportingData: { trendResult: result },
    });
  }

  return patterns;
}

function buildSymptomPatterns(
  currentBiomarkers: CurrentBiomarker[],
  symptomLogs: SymptomLog[],
  reportDate: string
): PersonalPattern[] {
  const correlations = findSymptomCorrelations(
    currentBiomarkers,
    symptomLogs.map(log => ({
      log_date: log.log_date,
      symptoms: log.symptoms as DailySymptom[],
    })),
    reportDate
  );

  return correlations.map(correlation => {
    const displayName = getDisplayLabel(correlation.biomarker);
    const symptomLabel = formatSymptomLabel(correlation.symptom);

    return {
      type: 'symptom' as const,
      biomarker: correlation.biomarker,
      summary: `You've been logging ${symptomLabel} and your ${displayName} is outside the optimal range — these may be worth reviewing together with your provider.`,
      severity: 'caution' as const,
      supportingData: { correlation },
    };
  });
}

export function buildPersonalInsights(
  currentBiomarkers: CurrentBiomarker[],
  historicalData: Map<string, HistoricalEntry[]>,
  symptomLogs: SymptomLog[],
  reportDate: string
): PersonalPattern[] {
  if (currentBiomarkers.length === 0) return [];

  const totalHistoricalReports = historicalData.size > 0
    ? Math.max(...Array.from(historicalData.values()).map(h => h.length), 0)
    : 0;

  const symptomPatterns = symptomLogs.length > 0
    ? buildSymptomPatterns(currentBiomarkers, symptomLogs, reportDate)
    : [];

  const trendPatterns = totalHistoricalReports >= PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_TREND
    ? buildTrendPatterns(currentBiomarkers, historicalData)
    : [];

  const baselinePatterns = totalHistoricalReports >= PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_BASELINE
    ? buildBaselinePatterns(currentBiomarkers, historicalData)
    : [];

  const dedupedTrends = trendPatterns.filter(
    t => !symptomPatterns.some(s => s.biomarker === t.biomarker)
  );

  const dedupedBaselines = baselinePatterns.filter(
    b => !symptomPatterns.some(s => s.biomarker === b.biomarker) &&
         !dedupedTrends.some(t => t.biomarker === b.biomarker)
  );

  const combined = [
    ...symptomPatterns,
    ...dedupedTrends,
    ...dedupedBaselines,
  ];

  return combined.slice(0, PERSONALIZATION_THRESHOLDS.MAX_PATTERNS_SHOWN);
}

export type { CurrentBiomarker, HistoricalEntry };
