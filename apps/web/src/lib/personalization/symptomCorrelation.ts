import type { SymptomCorrelation, DailySymptom } from '../../types';
import { PERSONALIZATION_THRESHOLDS } from '../../types';

interface SymptomBiomarkerMapping {
  biomarker: string;
  system: string;
  relevanceLevel: 'high' | 'medium';
}

const SYMPTOM_BIOMARKER_MAP: Record<string, SymptomBiomarkerMapping[]> = {
  fatigue: [
    { biomarker: 'ferritin',        system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'hemoglobin',      system: 'Blood',      relevanceLevel: 'high' },
    { biomarker: 'tsh',             system: 'Thyroid',    relevanceLevel: 'high' },
    { biomarker: 'vitamin_d_25_oh', system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'vitamin_b12',     system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'fasting_glucose', system: 'Metabolic',  relevanceLevel: 'medium' },
    { biomarker: 'free_t3',         system: 'Thyroid',    relevanceLevel: 'medium' },
    { biomarker: 'magnesium',       system: 'Nutrients',  relevanceLevel: 'medium' },
    { biomarker: 'iron_saturation', system: 'Nutrients',  relevanceLevel: 'medium' },
  ],
  sleep_issues: [
    { biomarker: 'magnesium',       system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'cortisol',        system: 'Hormones',   relevanceLevel: 'high' },
    { biomarker: 'tsh',             system: 'Thyroid',    relevanceLevel: 'medium' },
    { biomarker: 'progesterone',    system: 'Hormones',   relevanceLevel: 'medium' },
    { biomarker: 'vitamin_d_25_oh', system: 'Nutrients',  relevanceLevel: 'medium' },
  ],
  mood_changes: [
    { biomarker: 'vitamin_d_25_oh', system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'vitamin_b12',     system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'tsh',             system: 'Thyroid',    relevanceLevel: 'high' },
    { biomarker: 'progesterone',    system: 'Hormones',   relevanceLevel: 'medium' },
    { biomarker: 'estradiol',       system: 'Hormones',   relevanceLevel: 'medium' },
    { biomarker: 'fasting_glucose', system: 'Metabolic',  relevanceLevel: 'medium' },
  ],
  acne: [
    { biomarker: 'total_testosterone', system: 'Hormones', relevanceLevel: 'high' },
    { biomarker: 'dheas',              system: 'Hormones', relevanceLevel: 'high' },
    { biomarker: 'fasting_insulin',    system: 'Metabolic',relevanceLevel: 'high' },
    { biomarker: 'fasting_glucose',    system: 'Metabolic',relevanceLevel: 'medium' },
    { biomarker: 'lh',                 system: 'Hormones', relevanceLevel: 'medium' },
  ],
  cramps: [
    { biomarker: 'magnesium',       system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'ferritin',        system: 'Nutrients',  relevanceLevel: 'medium' },
    { biomarker: 'calcium',         system: 'Metabolic',  relevanceLevel: 'medium' },
    { biomarker: 'progesterone',    system: 'Hormones',   relevanceLevel: 'medium' },
  ],
  low_energy: [
    { biomarker: 'ferritin',        system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'tsh',             system: 'Thyroid',    relevanceLevel: 'high' },
    { biomarker: 'vitamin_d_25_oh', system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'hemoglobin_a1c',  system: 'Metabolic',  relevanceLevel: 'medium' },
    { biomarker: 'fasting_glucose', system: 'Metabolic',  relevanceLevel: 'medium' },
  ],
  headache: [
    { biomarker: 'magnesium',       system: 'Nutrients',  relevanceLevel: 'high' },
    { biomarker: 'fasting_glucose', system: 'Metabolic',  relevanceLevel: 'medium' },
    { biomarker: 'vitamin_d_25_oh', system: 'Nutrients',  relevanceLevel: 'medium' },
  ],
  bloating: [
    { biomarker: 'tsh',             system: 'Thyroid',    relevanceLevel: 'medium' },
    { biomarker: 'progesterone',    system: 'Hormones',   relevanceLevel: 'medium' },
    { biomarker: 'fasting_insulin', system: 'Metabolic',  relevanceLevel: 'medium' },
  ],
};

type BiomarkerFlagStatus = 'out_of_range' | 'borderline' | 'in_range' | 'unknown';

interface CurrentBiomarkerStatus {
  name: string;
  flagged: BiomarkerFlagStatus;
}

interface SymptomLogEntry {
  log_date: string;
  symptoms: DailySymptom[];
}

function isSuboptimalEnough(flagged: BiomarkerFlagStatus): boolean {
  return flagged === 'out_of_range' || flagged === 'borderline';
}

function isWithinWindow(logDate: string, reportDate: string): boolean {
  const logMs = new Date(logDate).getTime();
  const reportMs = new Date(reportDate).getTime();
  const windowMs = PERSONALIZATION_THRESHOLDS.SYMPTOM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Math.abs(logMs - reportMs) <= windowMs;
}

export function findSymptomCorrelations(
  currentBiomarkers: CurrentBiomarkerStatus[],
  symptomLogs: SymptomLogEntry[],
  reportDate: string
): SymptomCorrelation[] {
  if (!symptomLogs.length) return [];

  const relevantLogs = symptomLogs.filter(log => isWithinWindow(log.log_date, reportDate));
  if (!relevantLogs.length) return [];

  const activeSymptoms = new Set<string>();
  for (const log of relevantLogs) {
    for (const symptom of log.symptoms) {
      activeSymptoms.add(symptom);
    }
  }

  const biomarkerStatusMap = new Map<string, BiomarkerFlagStatus>();
  for (const b of currentBiomarkers) {
    biomarkerStatusMap.set(b.name, b.flagged);
  }

  const correlations: SymptomCorrelation[] = [];
  const seenPairs = new Set<string>();

  for (const symptom of activeSymptoms) {
    const mappings = SYMPTOM_BIOMARKER_MAP[symptom];
    if (!mappings) continue;

    for (const mapping of mappings) {
      const flagged = biomarkerStatusMap.get(mapping.biomarker);
      if (!flagged) continue;
      if (!isSuboptimalEnough(flagged)) continue;

      const pairKey = `${symptom}:${mapping.biomarker}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      correlations.push({
        symptom,
        biomarker: mapping.biomarker,
        system: mapping.system,
        relevanceLevel: mapping.relevanceLevel,
      });
    }
  }

  return correlations.filter(c => c.relevanceLevel === 'high');
}
