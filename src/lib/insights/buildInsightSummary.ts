import type { BiomarkerName, CyclePhase } from '../../types';
import { getDisplayName, getCategory, getImportance } from '../biomarkers/dictionary';
import { scoreBiomarker, type ScoredBiomarker } from '../scoring/scoreBiomarker';
import { groupBySystem, type SystemGroup } from '../scoring/groupBySystem';
import { compareReports, getBiggestChanges, type BiomarkerDelta, type TrajectoryStatus } from '../scoring/compareReports';

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
}

function toTopFinding(
  s: ScoredBiomarker,
  rangeLabel: string | null = null,
  delta?: BiomarkerDelta | null,
): TopFinding {
  const displayName = getDisplayName(s.key);
  const statusLabel = s.concern === 2 ? 'out_of_range' : 'borderline';
  const direction: 'high' | 'low' | 'unknown' = s.amaniStatus.includes('high') ? 'high' : s.amaniStatus.includes('low') ? 'low' : 'unknown';
  const dirLabel = direction === 'high' ? 'above' : direction === 'low' ? 'below' : 'outside';

  let fact = `${displayName} is ${dirLabel} the optimal range at ${s.value} ${s.unit}`;

  if (delta && delta.significance !== 'minor') {
    if (
      delta.trajectoryStatus === 'improving_still_high' ||
      delta.trajectoryStatus === 'improving_still_low'
    ) {
      const pct = delta.percentDelta !== null
        ? ` (${Math.abs(delta.percentDelta)}% improvement)`
        : '';
      fact += `, though it has improved from ${delta.previousValue} ${s.unit} since the prior report${pct}.`;
    } else if (
      delta.trajectoryStatus === 'worsening_still_high' ||
      delta.trajectoryStatus === 'worsening_still_low'
    ) {
      fact += `, and it has worsened from ${delta.previousValue} ${s.unit} since the prior report.`;
    }
  }

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
        const isMinCritical = minS.concern === 2 && getImportance(minS.key) === 'critical';
        const isCurrCritical = s.concern === 2 && getImportance(s.key) === 'critical';
        if (isMinCritical && !isCurrCritical) return idx;
        if (!isMinCritical && isCurrCritical) return minIdx;
        return s.weightedConcern < minS.weightedConcern ? idx : minIdx;
      }, 0);

      const weakest = result[weakestIdx];
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

function deltaToChange(d: BiomarkerDelta): BiggestChange {
  const pct = d.percentDelta !== null
    ? ` (${d.percentDelta > 0 ? '+' : ''}${d.percentDelta}%)`
    : '';

  let fact: string;
  if (d.trajectoryStatus === 'improving_still_high') {
    fact = `${d.displayName} decreased from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct} — meaningful improvement, though it remains elevated above the optimal range.`;
  } else if (d.trajectoryStatus === 'improving_still_low') {
    fact = `${d.displayName} increased from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct} — meaningful improvement, though it remains below the optimal range.`;
  } else if (d.trajectoryStatus === 'worsening_still_high') {
    fact = `${d.displayName} increased from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct}, moving further above the optimal range.`;
  } else if (d.trajectoryStatus === 'worsening_still_low') {
    fact = `${d.displayName} decreased from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct}, moving further below the optimal range.`;
  } else if (d.boundaryCrossing) {
    const bcDir = d.boundaryCrossing.direction === 'improved' ? 'improved' : 'moved';
    fact = `${d.displayName} changed from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct}. ${bcDir.charAt(0).toUpperCase() + bcDir.slice(1)} from ${d.boundaryCrossing.from.replace(/_/g, ' ')} to ${d.boundaryCrossing.to.replace(/_/g, ' ')}.`;
  } else {
    fact = `${d.displayName} changed from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct}.`;
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
    trajectoryStatus: d.trajectoryStatus,
    distanceToNormalImprovement: d.distanceToNormalImprovement,
    fact,
  };
}

function buildBiggestChanges(deltas: BiomarkerDelta[]): BiggestChange[] {
  return getBiggestChanges(deltas, 5).map(deltaToChange);
}

function buildDoctorQuestions(
  scored: ScoredBiomarker[],
  deltas: BiomarkerDelta[],
): DoctorQuestion[] {
  const questions: DoctorQuestion[] = [];
  const used = new Set<BiomarkerName>();

  // 1. Boundary crossings (highest priority)
  const boundaryCrossings = deltas.filter(d => d.boundaryCrossing !== null);
  for (const d of boundaryCrossings.slice(0, 2)) {
    if (used.has(d.key)) continue;
    used.add(d.key);
    const name = d.displayName;
    const bc = d.boundaryCrossing!;

    const systemPeers = scored
      .filter(s => s.key !== d.key && getCategory(s.key) === getCategory(d.key) && s.concern > 0)
      .slice(0, 2)
      .map(s => getDisplayName(s.key));

    if (bc.direction === 'worsened' && systemPeers.length > 0) {
      questions.push({
        text: `My ${name} moved from ${bc.from.replace(/_/g, ' ')} to ${bc.to.replace(/_/g, ' ')}. How should I interpret this alongside ${systemPeers.join(' and ')}?`,
        relatedBiomarker: d.key,
      });
    } else if (bc.direction === 'worsened') {
      questions.push({
        text: `Could you help me understand this ${name} change? It moved from ${bc.from.replace(/_/g, ' ')} to ${bc.to.replace(/_/g, ' ')}.`,
        relatedBiomarker: d.key,
      });
    } else {
      questions.push({
        text: `My ${name} improved from ${bc.from.replace(/_/g, ' ')} to ${bc.to.replace(/_/g, ' ')}. Is this change clinically meaningful?`,
        relatedBiomarker: d.key,
      });
    }
  }

  // 2. System clusters: 2+ flagged markers in the same system
  const categoryMap = new Map<string, ScoredBiomarker[]>();
  for (const s of scored.filter(s => s.concern > 0)) {
    const cat = getCategory(s.key);
    if (!cat) continue;
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(s);
  }

  for (const [, peers] of categoryMap) {
    if (peers.length < 2) continue;
    const primary = peers.sort((a, b) => b.weightedConcern - a.weightedConcern)[0];
    if (used.has(primary.key)) continue;
    used.add(primary.key);
    const peerNames = peers.map(p => getDisplayName(p.key));
    const systemName = peerNames.slice(0, 2).join(', ');
    const remainder = peerNames.length > 2 ? ` and ${peerNames.length - 2} other${peerNames.length - 2 !== 1 ? 's' : ''}` : '';
    questions.push({
      text: `Could you help me understand how my ${systemName}${remainder} results relate to each other?`,
      relatedBiomarker: primary.key,
    });
    if (questions.length >= 5) break;
  }

  // 3a. Improving but still abnormal — personalized encouraging question
  const improvingAbnormal = deltas.filter(
    d =>
      d.significance !== 'minor' &&
      d.boundaryCrossing === null &&
      !used.has(d.key) &&
      (d.trajectoryStatus === 'improving_still_high' || d.trajectoryStatus === 'improving_still_low'),
  );
  for (const d of improvingAbnormal.slice(0, 1)) {
    used.add(d.key);
    const name = d.displayName;
    const pct = d.percentDelta !== null ? ` (${Math.abs(d.percentDelta)}%)` : '';
    questions.push({
      text: `My ${name} dropped from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct} and remains elevated. Is this rate of improvement clinically meaningful, and what should I aim for?`,
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
    const name = d.displayName;
    const dir = d.trendDirection === 'up' ? 'increased' : 'decreased';
    const pct = d.percentDelta !== null ? ` (${d.percentDelta > 0 ? '+' : ''}${d.percentDelta}%)` : '';
    questions.push({
      text: `My ${name} ${dir} from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct}. Is this something I should continue monitoring?`,
      relatedBiomarker: d.key,
    });
  }

  // 4. Isolated out-of-range markers (lowest priority)
  const outOfRange = scored
    .filter(s => s.concern === 2)
    .sort((a, b) => b.weightedConcern - a.weightedConcern);

  for (const s of outOfRange) {
    if (used.has(s.key)) continue;
    used.add(s.key);
    const name = getDisplayName(s.key);
    const direction = s.amaniStatus.includes('high') ? 'elevated' : s.amaniStatus.includes('low') ? 'low' : 'outside the optimal range';
    questions.push({
      text: `My ${name} is ${direction} at ${s.value} ${s.unit}. What does this mean in the context of my overall labs?`,
      relatedBiomarker: s.key,
    });
    if (questions.length >= 5) break;
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
    const listed = names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
    signals.push({
      type: 'system',
      title: `${systemLabel}: several markers shifted together`,
      description: `${listed} ${names.length === 1 ? 'is' : 'are'} each outside their optimal range. Tracking them as a group over time can help reveal whether this is a consistent pattern.`,
      relatedBiomarkers: peers.map(p => p.key),
    });
  }

  // Boundary signal: markers that crossed a boundary (worsened)
  const worsenedCrossings = deltas.filter(
    d => d.boundaryCrossing?.direction === 'worsened',
  );
  for (const d of worsenedCrossings.slice(0, 2)) {
    const bc = d.boundaryCrossing!;
    signals.push({
      type: 'boundary',
      title: `${d.displayName}: range shifted since last report`,
      description: `Moved from ${bc.from.replace(/_/g, ' ')} to ${bc.to.replace(/_/g, ' ')} since the last report. A single shift may not be meaningful. Tracking it across future panels can help clarify the direction.`,
      relatedBiomarkers: [d.key],
    });
  }

  // Improvement signal: markers improving but still outside optimal
  const improvingStillAbnormal = deltas.filter(
    d =>
      d.significance !== 'minor' &&
      d.boundaryCrossing === null &&
      (d.trajectoryStatus === 'improving_still_high' || d.trajectoryStatus === 'improving_still_low'),
  );
  for (const d of improvingStillAbnormal.slice(0, 2)) {
    const pct = d.percentDelta !== null ? ` (${Math.abs(d.percentDelta)}%)` : '';
    const dir = d.trajectoryStatus === 'improving_still_high' ? 'elevated' : 'low';
    signals.push({
      type: 'trend',
      title: `${d.displayName}: improving from the prior report`,
      description: `Moved from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct} — a meaningful step toward the optimal range. It remains ${dir}, so continued monitoring is worthwhile.`,
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
    const dir = d.trendDirection === 'up' ? 'increasing' : 'decreasing';
    const pct = d.percentDelta !== null ? ` (${Math.abs(d.percentDelta)}%)` : '';
    signals.push({
      type: 'trend',
      title: `${d.displayName}: notable change from previous report`,
      description: `Has been ${dir}${pct} since the last panel, while staying within the same range category. Worth tracking to see if this holds across future reports.`,
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
      title: `${systemLabel}: related markers shifted since last report`,
      description: `${systemNames} each shifted since the last panel. When related markers move together, it may be useful context to carry into future results.`,
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
): InsightSummary {
  const scored = current.map(b =>
    scoreBiomarker(b.key, b.value, b.unit, b.labRefMin, b.labRefMax, cyclePhase),
  );

  const systemSummaries = groupBySystem(scored);
  let biggestChanges: BiggestChange[] = [];
  let deltas: BiomarkerDelta[] = [];
  let deltaMap = new Map<BiomarkerName, BiomarkerDelta>();

  if (previous && previous.length > 0) {
    deltas = compareReports(
      previous.map(b => ({ key: b.key, value: b.value, unit: b.unit })),
      current.map(b => ({ key: b.key, value: b.value, unit: b.unit })),
      cyclePhase,
    );
    deltaMap = new Map(deltas.map(d => [d.key, d]));
    biggestChanges = buildBiggestChanges(deltas);
  }

  const topFindings = buildTopFindings(scored, deltaMap);

  const primaryKey = topFindings.length > 0 && topFindings[0].status === 'out_of_range'
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
      guaranteeInsert(deltaToChange(primaryDelta));
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
          fact: `${getDisplayName(primaryKey)} is ${primaryScored.value} ${unit} — first result on record, currently out of range.`,
          isFirstRecorded: true,
        };
        guaranteeInsert(firstRecordedChange);
      }
    }
  }

  const questionsForDoctor = buildDoctorQuestions(scored, deltas);
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

  const primaryFinding = topFindings.length > 0 && topFindings[0].status === 'out_of_range'
    ? topFindings[0]
    : null;

  const secondaryFindings = primaryFinding
    ? topFindings.slice(1)
    : topFindings;

  return {
    primaryFinding,
    topFindings: secondaryFindings,
    biggestChanges,
    deltaMap,
    systemSummaries,
    questionsForDoctor,
    watchSignals,
    confidence,
  };
}
