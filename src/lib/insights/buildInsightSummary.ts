import type { BiomarkerName, CyclePhase } from '../../types';
import { getDisplayName } from '../biomarkers/dictionary';
import { scoreBiomarker, type ScoredBiomarker } from '../scoring/scoreBiomarker';
import { groupBySystem, type SystemGroup } from '../scoring/groupBySystem';
import { compareReports, getBiggestChanges, type BiomarkerDelta } from '../scoring/compareReports';

export interface TopFinding {
  key: BiomarkerName;
  displayName: string;
  value: number;
  unit: string;
  status: 'optimal' | 'borderline' | 'out_of_range';
  severity: number;
  fact: string;
}

export interface BiggestChange {
  key: BiomarkerName;
  displayName: string;
  previousValue: number;
  currentValue: number;
  unit: string;
  percentDelta: number | null;
  trendDirection: 'up' | 'down' | 'stable';
  significance: 'minor' | 'moderate' | 'significant';
  boundaryCrossing: { from: string; to: string; direction: string } | null;
  fact: string;
}

export interface DoctorQuestion {
  text: string;
  relatedBiomarker: BiomarkerName;
}

export interface InsightSummary {
  topFindings: TopFinding[];
  biggestChanges: BiggestChange[];
  systemSummaries: SystemGroup[];
  questionsForDoctor: DoctorQuestion[];
}

interface BiomarkerInput {
  key: BiomarkerName;
  value: number;
  unit: string;
  labRefMin: number | null;
  labRefMax: number | null;
}

function buildTopFindings(scored: ScoredBiomarker[]): TopFinding[] {
  return scored
    .filter(s => s.concern > 0)
    .sort((a, b) => b.weightedConcern - a.weightedConcern)
    .slice(0, 6)
    .map(s => {
      const displayName = getDisplayName(s.key);
      const statusLabel = s.concern === 2 ? 'out_of_range' : 'borderline';
      const direction = s.amaniStatus.includes('high') ? 'high' : s.amaniStatus.includes('low') ? 'low' : '';
      const dirLabel = direction === 'high' ? 'above' : direction === 'low' ? 'below' : 'outside';

      return {
        key: s.key,
        displayName,
        value: s.value,
        unit: s.unit,
        status: statusLabel as TopFinding['status'],
        severity: s.weightedConcern,
        fact: `${displayName} is ${dirLabel} the optimal range at ${s.value} ${s.unit}`,
      };
    });
}

function buildBiggestChanges(deltas: BiomarkerDelta[]): BiggestChange[] {
  const biggest = getBiggestChanges(deltas, 5);

  return biggest.map(d => {
    let fact = `${d.displayName} changed from ${d.previousValue} to ${d.currentValue} ${d.unit}`;
    if (d.percentDelta !== null) {
      fact += ` (${d.percentDelta > 0 ? '+' : ''}${d.percentDelta}%)`;
    }
    if (d.boundaryCrossing) {
      const bcDir = d.boundaryCrossing.direction === 'improved' ? 'improved' : 'moved';
      fact += ` — ${bcDir} from ${d.boundaryCrossing.from.replace(/_/g, ' ')} to ${d.boundaryCrossing.to.replace(/_/g, ' ')}`;
    }

    return {
      key: d.key,
      displayName: d.displayName,
      previousValue: d.previousValue,
      currentValue: d.currentValue,
      unit: d.unit,
      percentDelta: d.percentDelta,
      trendDirection: d.trendDirection,
      significance: d.significance,
      boundaryCrossing: d.boundaryCrossing,
      fact,
    };
  });
}

function buildDoctorQuestions(
  scored: ScoredBiomarker[],
  deltas: BiomarkerDelta[],
): DoctorQuestion[] {
  const questions: DoctorQuestion[] = [];
  const used = new Set<BiomarkerName>();

  const flaggedDeltas = deltas.filter(
    d => d.significance !== 'minor' || d.boundaryCrossing !== null,
  );
  for (const d of flaggedDeltas.slice(0, 3)) {
    if (used.has(d.key)) continue;
    used.add(d.key);
    const name = d.displayName;

    if (d.boundaryCrossing) {
      if (d.boundaryCrossing.direction === 'worsened') {
        questions.push({
          text: `Could you help me understand this ${name} trend? It moved from ${d.boundaryCrossing.from.replace(/_/g, ' ')} to ${d.boundaryCrossing.to.replace(/_/g, ' ')}.`,
          relatedBiomarker: d.key,
        });
      } else {
        questions.push({
          text: `My ${name} improved from ${d.boundaryCrossing.from.replace(/_/g, ' ')} to ${d.boundaryCrossing.to.replace(/_/g, ' ')}. Is this change clinically meaningful?`,
          relatedBiomarker: d.key,
        });
      }
    } else {
      questions.push({
        text: `Is the ${name} change from ${d.previousValue} to ${d.currentValue} ${d.unit} something I should keep monitoring?`,
        relatedBiomarker: d.key,
      });
    }
  }

  const outOfRange = scored
    .filter(s => s.concern === 2)
    .sort((a, b) => b.weightedConcern - a.weightedConcern);

  for (const s of outOfRange.slice(0, 3)) {
    if (used.has(s.key)) continue;
    used.add(s.key);
    const name = getDisplayName(s.key);
    const direction = s.amaniStatus.includes('high') ? 'high' : s.amaniStatus.includes('low') ? 'low' : 'outside the range';
    questions.push({
      text: `My ${name} is reading ${direction} at ${s.value} ${s.unit}. What does this mean in the context of my overall labs?`,
      relatedBiomarker: s.key,
    });
  }

  return questions.slice(0, 5);
}

export function buildInsightSummary(
  current: BiomarkerInput[],
  previous: BiomarkerInput[] | null,
  cyclePhase?: CyclePhase | null,
): InsightSummary {
  const scored = current.map(b =>
    scoreBiomarker(b.key, b.value, b.unit, b.labRefMin, b.labRefMax, cyclePhase),
  );

  const topFindings = buildTopFindings(scored);
  const systemSummaries = groupBySystem(scored);

  let biggestChanges: BiggestChange[] = [];
  let deltas: BiomarkerDelta[] = [];

  if (previous && previous.length > 0) {
    deltas = compareReports(
      previous.map(b => ({ key: b.key, value: b.value, unit: b.unit })),
      current.map(b => ({ key: b.key, value: b.value, unit: b.unit })),
      cyclePhase,
    );
    biggestChanges = buildBiggestChanges(deltas);
  }

  const questionsForDoctor = buildDoctorQuestions(scored, deltas);

  return {
    topFindings,
    biggestChanges,
    systemSummaries,
    questionsForDoctor,
  };
}
