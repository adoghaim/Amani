import type { BiomarkerName, CyclePhase } from '../../types';
import { getDisplayName, getCategory, getImportance } from '../biomarkers/dictionary';
import { scoreBiomarker, type ScoredBiomarker } from '../scoring/scoreBiomarker';
import { groupBySystem, type SystemGroup } from '../scoring/groupBySystem';
import { compareReports, getBiggestChanges, type BiomarkerDelta, type TrajectoryStatus } from '../scoring/compareReports';
import { assessAmaniContext, contextFromReport } from '../scoring/amaniContext';
import {
  authorizedLanguage, describeMeasuredMovement, DOCTOR_QUESTIONS, primaryFindingSentence, WATCH_SIGNALS,
  type AuthorizedLanguage,
} from '../scoring/insightCopy';

export interface TopFinding {
  key: BiomarkerName;
  displayName: string;
  value: number;
  unit: string;
  status: 'optimal' | 'borderline' | 'out_of_range';
  severity: number;
  deviationMultiplier: number;
  direction: 'high' | 'low' | 'unknown';
  rangeLabel: string | null;
  fact: string;
  trend?: {
    direction: 'up' | 'down' | 'stable';
    interpretation: 'improved' | 'worsened' | 'stable';
  } | null;
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
  trajectoryStatus: TrajectoryStatus;
  distanceToNormalImprovement: number | null;
  fact: string;
  isFirstRecorded?: boolean;
  priorReportDate: string | null;
  priorIsOlderThanImmediatePrior: boolean;
}

export interface DoctorQuestion {
  text: string;
  relatedBiomarker: BiomarkerName;
}

export type WatchSignalType = 'system' | 'boundary' | 'trend' | 'pattern';

export interface WatchSignal {
  type: WatchSignalType;
  title: string;
  description: string;
  relatedBiomarkers: BiomarkerName[];
}

export interface ReportConfidence {
  score: number;
  label: 'low' | 'medium' | 'high';
  reasons: string[];
  coverageCount: number;
  totalCount: number;
  normalizationRate: number;
  parserQuality: 'high' | 'medium' | 'low' | 'unknown';
  sourceFormat: 'text' | 'ocr' | 'manual' | 'unknown' | null;
}

export interface InsightSummary {
  primaryFinding: TopFinding | null;
  topFindings: TopFinding[];
  biggestChanges: BiggestChange[];
  deltaMap: Map<BiomarkerName, BiomarkerDelta>;
  /**
   * Language each scored marker's current band authorizes, for this report's
   * context, with or without a prior report. Optional only so hand-built
   * summaries still type; buildInsightSummary always sets it.
   */
  bandLanguage?: Map<BiomarkerName, AuthorizedLanguage>;
  systemSummaries: SystemGroup[];
  questionsForDoctor: DoctorQuestion[];
  watchSignals: WatchSignal[];
  confidence: ReportConfidence;
}

interface BiomarkerInput {
  key: BiomarkerName;
  value: number;
  unit: string;
  labRefMin: number | null;
  labRefMax: number | null;
  parserConfidence?: 'high' | 'medium' | 'low' | null;
  normalizationStatus?: 'mapped' | 'partial' | 'unmapped' | null;
  sourceFormat?: 'text' | 'ocr' | 'manual' | 'unknown' | null;
  reportDate?: string;
}

function toTopFinding(
  s: ScoredBiomarker,
  rangeLabel: string | null = null,
  delta?: BiomarkerDelta | null,
): TopFinding {
  const displayName = getDisplayName(s.key);
  const statusLabel = s.concern === 2 ? 'out_of_range' : 'borderline';
  const direction: 'high' | 'low' | 'unknown' = s.amaniStatus.includes('high') ? 'high' : s.amaniStatus.includes('low') ? 'low' : 'unknown';

  // V2-03b: no surface renders `fact` today. It said "the optimal range",
  // "has improved" and "has worsened"; it now carries the policy's placement
  // and, where there is a prior value, the measured movement.
  const fact = [
    primaryFindingSentence({ displayName, direction, value: s.value, unit: s.unit }),
    delta && delta.significance !== 'minor' ? describeMeasuredMovement({ ...delta, displayName }).text : '',
  ].filter(Boolean).join(' ');

  let trend: TopFinding['trend'] = null;
  if (delta) {
    trend = {
      direction: delta.trendDirection,
      interpretation: delta.boundaryCrossing?.direction === 'improved' ? 'improved' : 
                     delta.boundaryCrossing?.direction === 'worsened' ? 'worsened' : 'stable'
    };
  }

  return {
    key: s.key,
    displayName,
    value: s.value,
    unit: s.unit,
    status: statusLabel as TopFinding['status'],
    severity: s.weightedConcern,
    deviationMultiplier: s.deviationMultiplier,
    direction,
    rangeLabel,
    fact,
    trend,
  };
}

function buildTopFindings(scored: ScoredBiomarker[], deltaMap?: Map<BiomarkerName, BiomarkerDelta>): TopFinding[] {
  const abnormal = scored.filter(s => s.concern > 0);
  const ranked = [...abnormal].sort((a, b) => b.weightedConcern - a.weightedConcern);

  const top3 = ranked.slice(0, 6);

  const EXTREME_RATIO_THRESHOLD = 3;
  const mustInclude = abnormal.filter(s => {
    if (s.concern < 2) return false;
    if (getImportance(s.key) !== 'critical') return false;
    if (s.deviationMultiplier < EXTREME_RATIO_THRESHOLD) return false;
    return !top3.some(t => t.key === s.key);
  });

  if (mustInclude.length === 0) {
    return top3.map(s => toTopFinding(s, null, deltaMap?.get(s.key)));
  }

  const criticalInTop3 = top3.filter(s => s.concern === 2 && getImportance(s.key) === 'critical');
  if (criticalInTop3.length >= 6) {
    return top3.map(s => toTopFinding(s, null, deltaMap?.get(s.key)));
  }

  const result: ScoredBiomarker[] = [...top3];
  for (const m of mustInclude) {
    if (result.length >= 6) {
      const weakestIdx = result.reduce((minIdx, s, idx, arr) => {
        const minS = arr[minIdx];
        if (!minS) return idx;
        const isMinCritical = minS.concern === 2 && getImportance(minS.key) === 'critical';
        const isCurrCritical = s.concern === 2 && getImportance(s.key) === 'critical';
        if (isMinCritical && !isCurrCritical) return idx;
        if (!isMinCritical && isCurrCritical) return minIdx;
        return s.weightedConcern < minS.weightedConcern ? idx : minIdx;
      }, 0);

      const weakest = result[weakestIdx];
      if (!weakest) {
        result.push(m);
        continue;
      }
      const weakestIsCritical = weakest.concern === 2 && getImportance(weakest.key) === 'critical';
      if (!weakestIsCritical || m.weightedConcern > weakest.weightedConcern) {
        result[weakestIdx] = m;
      }
    } else {
      result.push(m);
    }
  }

  return result
    .sort((a, b) => b.weightedConcern - a.weightedConcern)
    .map(s => toTopFinding(s, null, deltaMap?.get(s.key)));
}

export function formatPriorReportDate(date: string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'your prior report';
  return `your ${d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })} report`;
}

function deltaToChange(d: BiomarkerDelta, immediatePriorReportDate: string | null): BiggestChange {
  const pct = d.percentDelta !== null
    ? ` (${d.percentDelta > 0 ? '+' : ''}${d.percentDelta}%)`
    : '';

  const priorIsOlder =
    d.priorReportDate !== null &&
    immediatePriorReportDate !== null &&
    d.priorReportDate !== immediatePriorReportDate;

  const sinceClause = priorIsOlder && d.priorReportDate
    ? ` since ${formatPriorReportDate(d.priorReportDate)}`
    : '';

  // V2-03b: one factual form for every trajectory (no surface renders `fact`
  // today). "Meaningful improvement" and "moving further above the optimal
  // range" judged movement against an unreviewed band.
  const fact = `${d.displayName} changed from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct}${sinceClause}.`;

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
    trajectoryStatus: d.trajectoryStatus,
    distanceToNormalImprovement: d.distanceToNormalImprovement,
    fact,
    isFirstRecorded: false,
    priorReportDate: d.priorReportDate,
    priorIsOlderThanImmediatePrior: priorIsOlder,
  };
}

function buildBiggestChanges(deltas: BiomarkerDelta[], immediatePriorReportDate: string | null): BiggestChange[] {
  return getBiggestChanges(deltas, 5).map(d => deltaToChange(d, immediatePriorReportDate));
}

/*
  V2-03b Stage 2. Selection and order are unchanged. The wording is the
  policy's (insightCopy.DOCTOR_QUESTIONS): measured values and placement with
  review state, never "improved", "better", "elevated", "stable" or a prompt to
  keep monitoring. Crossings are stated by value, not by bucket name.
*/
function buildDoctorQuestions(
  scored: ScoredBiomarker[],
  deltas: BiomarkerDelta[],
  primaryFinding: TopFinding | null,
  bandLanguage: ReadonlyMap<BiomarkerName, AuthorizedLanguage>,
): DoctorQuestion[] {
  const questions: DoctorQuestion[] = [];
  const used = new Set<BiomarkerName>();

  // 1. Boundary crossings (highest priority)
  const boundaryCrossings = deltas.filter(d => d.boundaryCrossing !== null);
  for (const d of boundaryCrossings.slice(0, 2)) {
    if (used.has(d.key)) continue;
    used.add(d.key);
    const name = d.displayName;

    const systemPeers = scored
      .filter(s => s.key !== d.key && getCategory(s.key) === getCategory(d.key) && s.concern > 0)
      .slice(0, 2)
      .map(s => getDisplayName(s.key));

    questions.push({
      text: systemPeers.length > 0
        ? DOCTOR_QUESTIONS.changeAlongside(name, d.previousValue, d.currentValue, d.unit, systemPeers)
        : DOCTOR_QUESTIONS.change(name, d.previousValue, d.currentValue, d.unit),
      relatedBiomarker: d.key,
    });
  }

  // 2. System clusters: 2+ flagged markers in the same system
  const categoryMap = new Map<string, ScoredBiomarker[]>();
  for (const s of scored.filter(s => s.concern > 0)) {
    const cat = getCategory(s.key);
    if (!cat) continue;
    let bucket = categoryMap.get(cat);
    if (!bucket) {
      bucket = [];
      categoryMap.set(cat, bucket);
    }
    bucket.push(s);
  }

  for (const [, peers] of categoryMap) {
    if (peers.length < 2) continue;
    const primary = peers.sort((a, b) => b.weightedConcern - a.weightedConcern)[0];
    if (!primary || used.has(primary.key)) continue;
    used.add(primary.key);
    const peerNames = peers.map(p => getDisplayName(p.key));
    const systemName = peerNames.slice(0, 2).join(', ');
    const remainder = peerNames.length > 2 ? ` and ${peerNames.length - 2} other${peerNames.length - 2 !== 1 ? 's' : ''}` : '';
    questions.push({
      text: DOCTOR_QUESTIONS.relate(`${systemName}${remainder}`),
      relatedBiomarker: primary.key,
    });
    if (questions.length >= 5) break;
  }

  // 3a. Movement toward the band, still outside it (reachable only with favourable authority)
  const improvingAbnormal = deltas.filter(
    d =>
      d.significance !== 'minor' &&
      d.boundaryCrossing === null &&
      !used.has(d.key) &&
      (d.trajectoryStatus === 'improving_still_high' || d.trajectoryStatus === 'improving_still_low'),
  );
  for (const d of improvingAbnormal.slice(0, 1)) {
    used.add(d.key);
    questions.push({
      text: DOCTOR_QUESTIONS.change(d.displayName, d.previousValue, d.currentValue, d.unit),
      relatedBiomarker: d.key,
    });
  }

  // 3b. Strong worsening trends (no boundary crossing)
  const worseningTrends = deltas.filter(
    d =>
      d.significance === 'significant' &&
      d.boundaryCrossing === null &&
      !used.has(d.key) &&
      d.trajectoryStatus !== 'improving_still_high' &&
      d.trajectoryStatus !== 'improving_still_low',
  );
  for (const d of worseningTrends.slice(0, 1)) {
    used.add(d.key);
    const pct = d.percentDelta !== null ? ` (${d.percentDelta > 0 ? '+' : ''}${d.percentDelta}%)` : '';
    questions.push({
      text: DOCTOR_QUESTIONS.explainChange(d.displayName, d.previousValue, d.currentValue, d.unit, pct),
      relatedBiomarker: d.key,
    });
  }

  // 4. Isolated markers outside the band (lowest priority)
  const outOfRange = scored
    .filter(s => s.concern === 2)
    .sort((a, b) => b.weightedConcern - a.weightedConcern);

  for (const s of outOfRange) {
    if (used.has(s.key)) continue;
    used.add(s.key);
    questions.push({
      text: DOCTOR_QUESTIONS.placement(getDisplayName(s.key), s.value, s.unit, bandLanguage.get(s.key) ?? authorizedLanguage(null)),
      relatedBiomarker: s.key,
    });
    if (questions.length >= 5) break;
  }

  // 5. Phase 8C supplement — 2-3 questions when there is a primary finding.
  // "Does this result matter given the rest of my labs look stable?" is gone:
  // it asserted her labs were stable from Amani's bands and a lab margin.
  if (primaryFinding && questions.length < 3) {
    if (questions.length < 2) {
      questions.push({ text: DOCTOR_QUESTIONS.timing(primaryFinding.displayName), relatedBiomarker: primaryFinding.key });
    }
    if (questions.length < 3) {
      questions.push({ text: DOCTOR_QUESTIONS.context(), relatedBiomarker: primaryFinding.key });
    }
  }

  return questions.slice(0, 5);
}

function buildWatchSignals(
  scored: ScoredBiomarker[],
  deltas: BiomarkerDelta[],
): WatchSignal[] {
  const signals: WatchSignal[] = [];

  // System signal: 2+ markers in the same system outside optimal
  const categoryMap = new Map<string, ScoredBiomarker[]>();
  for (const s of scored.filter(s => s.concern === 2)) {
    const cat = getCategory(s.key);
    if (!cat) continue;
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(s);
  }

  for (const [cat, peers] of categoryMap) {
    if (peers.length < 2) continue;
    const systemLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
    const names = peers.map(p => getDisplayName(p.key));
    const listed = names.length <= 3 ? names : [...names.slice(0, 2), `${names.length - 2} others`];
    signals.push({
      type: 'system',
      title: WATCH_SIGNALS.systemTitle(systemLabel),
      description: WATCH_SIGNALS.systemDescription(listed),
      relatedBiomarkers: peers.map(p => p.key),
    });
  }

  // Boundary signal: markers that crossed out of the band
  const worsenedCrossings = deltas.filter(
    d => d.boundaryCrossing?.direction === 'worsened',
  );
  for (const d of worsenedCrossings.slice(0, 2)) {
    signals.push({
      type: 'boundary',
      title: WATCH_SIGNALS.crossingTitle(d.displayName),
      description: WATCH_SIGNALS.change(d.previousValue, d.currentValue, d.unit, ''),
      relatedBiomarkers: [d.key],
    });
  }

  // Movement toward the band, still outside it
  const improvingStillAbnormal = deltas.filter(
    d =>
      d.significance !== 'minor' &&
      d.boundaryCrossing === null &&
      (d.trajectoryStatus === 'improving_still_high' || d.trajectoryStatus === 'improving_still_low'),
  );
  for (const d of improvingStillAbnormal.slice(0, 2)) {
    const pct = d.percentDelta !== null ? ` (${Math.abs(d.percentDelta)}%)` : '';
    signals.push({
      type: 'trend',
      title: WATCH_SIGNALS.changeTitle(d.displayName),
      description: WATCH_SIGNALS.change(d.previousValue, d.currentValue, d.unit, pct),
      relatedBiomarkers: [d.key],
    });
  }

  // Worsening trend signal: worsening without a boundary crossing
  const worseningTrends = deltas.filter(
    d =>
      d.significance === 'significant' &&
      d.boundaryCrossing === null &&
      d.trajectoryStatus !== 'improving_still_high' &&
      d.trajectoryStatus !== 'improving_still_low',
  );
  for (const d of worseningTrends.slice(0, 2)) {
    const pct = d.percentDelta !== null ? ` (${Math.abs(d.percentDelta)}%)` : '';
    signals.push({
      type: 'trend',
      title: WATCH_SIGNALS.changeTitle(d.displayName),
      description: WATCH_SIGNALS.change(d.previousValue, d.currentValue, d.unit, pct),
      relatedBiomarkers: [d.key],
    });
  }

  // Pattern signal: related markers shifting together (moderate+ significance)
  const patternCategoryMap = new Map<string, BiomarkerDelta[]>();
  for (const d of deltas.filter(d => d.significance !== 'minor')) {
    const cat = getCategory(d.key);
    if (!cat) continue;
    if (!patternCategoryMap.has(cat)) patternCategoryMap.set(cat, []);
    patternCategoryMap.get(cat)!.push(d);
  }

  for (const [cat, group] of patternCategoryMap) {
    if (group.length < 2) continue;
    const systemNames = group.map(d => d.displayName).slice(0, 3).join(', ');
    const systemLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
    signals.push({
      type: 'pattern',
      title: WATCH_SIGNALS.patternTitle(systemLabel),
      description: WATCH_SIGNALS.patternDescription(systemNames),
      relatedBiomarkers: group.map(d => d.key),
    });
    break;
  }

  return signals.slice(0, 4);
}

function calculateConfidence(
  inputs: BiomarkerInput[],
  hasPreviousReport: boolean,
  dominantSourceFormat: 'text' | 'ocr' | 'manual' | 'unknown' | null,
): ReportConfidence {
  if (inputs.length === 0) {
    return {
      score: 0, label: 'low',
      reasons: ['No structured biomarker data available.'],
      coverageCount: 0, totalCount: 0,
      normalizationRate: 0, parserQuality: 'unknown', sourceFormat: dominantSourceFormat,
    };
  }

  const reasons: string[] = [];
  let score = 0;

  // Factor 1: normalization quality (40 points)
  // null means no telemetry available (old report) — counted as partial credit (0.5), not full mapped credit
  const normWeightedCount = inputs.reduce((sum, b) => {
    if (b.normalizationStatus === 'mapped') return sum + 1;
    if (b.normalizationStatus == null) return sum + 0.5;
    if (b.normalizationStatus === 'partial') return sum + 0.5;
    return sum;
  }, 0);
  const normRate = normWeightedCount / inputs.length;
  const normPoints = Math.round(normRate * 40);
  score += normPoints;

  const hasAnyTelemetry = inputs.some(b => b.normalizationStatus != null);
  if (!hasAnyTelemetry) {
    reasons.push('Some data-quality telemetry was not available for this report; normalization estimate based on coverage.');
  } else if (normRate >= 0.85) {
    const mappedCount = inputs.filter(b => b.normalizationStatus === 'mapped').length;
    reasons.push(`${mappedCount} of ${inputs.length} analytes successfully mapped.`);
  } else {
    reasons.push(`${Math.round(normRate * 100)}% of analytes mapped. Some names may not have matched the Amani catalog.`);
  }

  // Factor 2: parser confidence distribution (30 points)
  const withConfidence = inputs.filter(b => b.parserConfidence != null);
  let parserQuality: ReportConfidence['parserQuality'] = 'unknown';
  if (withConfidence.length > 0) {
    const confScore = withConfidence.reduce((sum, b) => {
      if (b.parserConfidence === 'high') return sum + 3;
      if (b.parserConfidence === 'medium') return sum + 2;
      return sum + 1;
    }, 0) / (withConfidence.length * 3);
    const confPoints = Math.round(confScore * 30);
    score += confPoints;
    parserQuality = confScore >= 0.75 ? 'high' : confScore >= 0.45 ? 'medium' : 'low';
    if (confScore >= 0.75) {
      reasons.push('Extraction confidence is high across most analytes.');
    } else if (confScore >= 0.45) {
      reasons.push('Extraction confidence is moderate. Some values may have lower reliability.');
    } else {
      reasons.push('Extraction confidence is low. This panel may benefit from re-upload or manual review.');
    }
  } else {
    score += 20;
    reasons.push('Parser confidence data unavailable; using structural quality as proxy.');
  }

  // Factor 3: coverage depth (20 points)
  const usableCount = inputs.filter(b => b.value !== null && b.value !== undefined).length;
  const coveragePoints = Math.min(20, Math.round((usableCount / 10) * 20));
  score += coveragePoints;
  if (usableCount >= 10) {
    reasons.push(`${usableCount} analytes with usable values provide good coverage for insights.`);
  } else {
    reasons.push(`${usableCount} analyte${usableCount !== 1 ? 's' : ''} with usable values. More markers improve insight depth.`);
  }

  // Factor 4: comparison context bonus (10 points)
  if (hasPreviousReport) {
    score += 10;
    reasons.push('Prior report available. Trend analysis and biggest changes are included.');
  }

  // Factor 5: source format signal (no direct score impact — informational reason only)
  if (dominantSourceFormat === 'ocr') {
    score = Math.max(0, score - 5);
    reasons.push('This report was OCR-processed, which can slightly reduce extraction certainty.');
  }

  const clampedScore = Math.min(100, Math.max(0, score));
  const label: ReportConfidence['label'] =
    clampedScore >= 75 ? 'high' : clampedScore >= 45 ? 'medium' : 'low';

  return {
    score: clampedScore, label, reasons,
    coverageCount: usableCount, totalCount: inputs.length,
    normalizationRate: normRate, parserQuality, sourceFormat: dominantSourceFormat,
  };
}

export function buildInsightSummary(
  current: BiomarkerInput[],
  previous: BiomarkerInput[] | null,
  cyclePhase?: CyclePhase | null,
  immediatePriorReportDate?: string | null,
): InsightSummary {
  const scored = current.map(b =>
    scoreBiomarker(b.key, b.value, b.unit, b.labRefMin, b.labRefMax, cyclePhase),
  );

  const systemSummaries = groupBySystem(scored);
  const bandLanguage = new Map<BiomarkerName, AuthorizedLanguage>();
  for (const b of current) {
    const assessment = assessAmaniContext(b.key, b.value, contextFromReport(cyclePhase));
    if (assessment.kind === 'scored') bandLanguage.set(b.key, authorizedLanguage(assessment.band));
  }
  let biggestChanges: BiggestChange[] = [];
  let deltas: BiomarkerDelta[] = [];
  let deltaMap = new Map<BiomarkerName, BiomarkerDelta>();

  if (previous && previous.length > 0) {
    deltas = compareReports(
      previous.map(b => ({ key: b.key, value: b.value, unit: b.unit, reportDate: b.reportDate })),
      current.map(b => ({ key: b.key, value: b.value, unit: b.unit })),
      cyclePhase,
    );
    deltaMap = new Map(deltas.map(d => [d.key, d]));
    biggestChanges = buildBiggestChanges(deltas, immediatePriorReportDate ?? null);
  }

  const topFindings = buildTopFindings(scored, deltaMap);

  const primaryKey = topFindings[0]?.status === 'out_of_range'
    ? topFindings[0].key
    : null;

  if (primaryKey) {
    const primaryDelta = deltaMap.get(primaryKey) ??
      [...deltaMap.values()].find(d => d.key.toLowerCase() === primaryKey.toLowerCase());
    const alreadyIncluded = biggestChanges.some(c => c.key === primaryKey);
    const rankScore = (c: BiggestChange): number => {
      const crossScore = c.boundaryCrossing ? 10 : 0;
      const trajScore =
        c.trajectoryStatus === 'improving_still_high' || c.trajectoryStatus === 'improving_still_low' ? 6 :
        c.trajectoryStatus === 'worsening_still_high' || c.trajectoryStatus === 'worsening_still_low' ? 5 : 0;
      const sigScore = c.significance === 'significant' ? 3 : c.significance === 'moderate' ? 2 : 1;
      const pctContrib = c.percentDelta !== null ? Math.min(5, Math.round(Math.abs(c.percentDelta) / 10)) : 0;
      const distContrib = c.distanceToNormalImprovement !== null ? Math.min(3, Math.round(Math.abs(c.distanceToNormalImprovement) / 20)) : 0;
      return crossScore + trajScore + sigScore + pctContrib + distContrib;
    };

    const guaranteeInsert = (entry: BiggestChange) => {
      let guaranteed = [...biggestChanges];
      if (guaranteed.length >= 5) {
        guaranteed.sort((a, b) => rankScore(a) - rankScore(b));
        guaranteed = guaranteed.slice(1);
      }
      guaranteed.push(entry);
      guaranteed.sort((a, b) => rankScore(b) - rankScore(a));
      biggestChanges = guaranteed;
    };

    if (!alreadyIncluded && primaryDelta) {
      guaranteeInsert(deltaToChange(primaryDelta, immediatePriorReportDate ?? null));
    } else if (!alreadyIncluded && !primaryDelta) {
      // Primary marker exists in current report but has no previous value — first recorded result.
      // Always surface it so users see their most critical out-of-range marker.
      const primaryScored = scored.find(s => s.key === primaryKey);
      if (primaryScored) {
        const currentInput = current.find(b => b.key === primaryKey);
        const unit = currentInput?.unit ?? '';
        const firstRecordedChange: BiggestChange = {
          key: primaryKey,
          displayName: getDisplayName(primaryKey),
          previousValue: 0,
          currentValue: primaryScored.value,
          unit,
          percentDelta: null,
          trendDirection: 'stable',
          significance: 'significant',
          boundaryCrossing: null,
          trajectoryStatus: null,
          distanceToNormalImprovement: null,
          fact: describeMeasuredMovement({ displayName: getDisplayName(primaryKey), previousValue: null, currentValue: primaryScored.value, unit, significance: 'significant' }).text,
          isFirstRecorded: true,
          priorReportDate: null,
          priorIsOlderThanImmediatePrior: false,
        };
        guaranteeInsert(firstRecordedChange);
      }
    }
  }

  const watchSignals = buildWatchSignals(scored, deltas);

  const sourceCounts: Record<string, number> = {};
  for (const b of current) {
    const fmt = b.sourceFormat ?? 'unknown';
    sourceCounts[fmt] = (sourceCounts[fmt] ?? 0) + 1;
  }
  const sortedSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);
  const topSource = sortedSources[0]?.[0];
  const dominantSourceFormat = (topSource && topSource !== 'unknown')
    ? (topSource as 'text' | 'ocr' | 'manual')
    : null;

  const confidence = calculateConfidence(current, (previous?.length ?? 0) > 0, dominantSourceFormat);

  // Cluster-first primary finding: bucket abnormal markers by category, pick the
  // bucket with the most out-of-range members (tiebreak: total weighted severity),
  // then surface that bucket's most severe out-of-range marker. Override with the
  // global single-marker pick only when one isolated marker is at least 2× more
  // deviated than the dominant cluster's top member — preserves true single-marker
  // extremes (e.g. very high TPO) without letting them eclipse multi-marker patterns.
  let primaryFinding: TopFinding | null = null;
  const abnormalScored = scored.filter(s => s.concern > 0);
  const outOfRangeScored = abnormalScored.filter(s => s.concern === 2);

  if (outOfRangeScored.length > 0) {
    const bucketMap = new Map<string, ScoredBiomarker[]>();
    for (const s of abnormalScored) {
      const cat = getCategory(s.key);
      if (!cat) continue;
      let bucket = bucketMap.get(cat);
      if (!bucket) {
        bucket = [];
        bucketMap.set(cat, bucket);
      }
      bucket.push(s);
    }

    interface BucketStats {
      outOfRangeCount: number;
      severity: number;
      topMember: ScoredBiomarker;
    }
    const bucketStats: BucketStats[] = [];
    for (const [, members] of bucketMap) {
      const oorMembers = members.filter(m => m.concern === 2);
      if (oorMembers.length === 0) continue;
      const topMember = oorMembers.reduce(
        (best, m) => (m.weightedConcern > best.weightedConcern ? m : best),
        oorMembers[0]!,
      );
      const severity = members.reduce((sum, m) => sum + m.weightedConcern, 0);
      bucketStats.push({ outOfRangeCount: oorMembers.length, severity, topMember });
    }

    bucketStats.sort((a, b) => {
      if (b.outOfRangeCount !== a.outOfRangeCount) return b.outOfRangeCount - a.outOfRangeCount;
      return b.severity - a.severity;
    });

    const dominantCluster = bucketStats[0] ?? null;

    const globalTopMarker = outOfRangeScored.reduce(
      (best, m) => (m.weightedConcern > best.weightedConcern ? m : best),
      outOfRangeScored[0]!,
    );

    let chosen: ScoredBiomarker | null = null;
    if (dominantCluster) {
      chosen = dominantCluster.topMember;
      if (
        globalTopMarker.key !== dominantCluster.topMember.key &&
        globalTopMarker.weightedConcern >= 2 * dominantCluster.topMember.weightedConcern
      ) {
        chosen = globalTopMarker;
      }
    }

    if (chosen) {
      const matched = topFindings.find(f => f.key === chosen!.key);
      primaryFinding = matched ?? toTopFinding(chosen, null, deltaMap.get(chosen.key));
    }
  }

  const secondaryFindings = primaryFinding
    ? topFindings.filter(f => f.key !== primaryFinding!.key)
    : topFindings;

  const questionsForDoctor = buildDoctorQuestions(scored, deltas, primaryFinding, bandLanguage);

  return {
    primaryFinding,
    topFindings: secondaryFindings,
    biggestChanges,
    deltaMap,
    bandLanguage,
    systemSummaries,
    questionsForDoctor,
    watchSignals,
    confidence,
  };
}
