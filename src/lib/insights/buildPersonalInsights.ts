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
    const directionLabel = result.trendDirection === 'rising' ? 'trending upward' : 'trending downward';

    patterns.push({
      type: 'trend',
      biomarker: biomarker.name,
      summary: `Your ${displayName} has been ${directionLabel} across your recent reports. This may be worth tracking over time.`,
      severity: result.trendStrength === 'strong' ? 'caution' : 'info',
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
