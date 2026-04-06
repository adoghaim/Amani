import type { BiomarkerName, CyclePhase } from '../../types';
import { getDisplayName, getCategory } from '../biomarkers/dictionary';
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
  topFindings: TopFinding[];
  biggestChanges: BiggestChange[];
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

  // 3. Strong worsening trends (no boundary crossing)
  const worseningTrends = deltas.filter(
    d => d.significance === 'significant' && d.boundaryCrossing === null && !used.has(d.key),
  );
  for (const d of worseningTrends.slice(0, 1)) {
    used.add(d.key);
    const name = d.displayName;
    const dir = d.trendDirection === 'up' ? 'increased' : 'decreased';
    const pct = d.percentDelta !== null ? ` (${d.percentDelta > 0 ? '+' : ''}${d.percentDelta}%)` : '';
    questions.push({
      text: `Is the ${name} change I'm seeing — it ${dir} from ${d.previousValue} to ${d.currentValue} ${d.unit}${pct} — something I should continue monitoring?`,
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
      title: `${systemLabel} — several markers shifted together`,
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
      title: `${d.displayName} — range shifted since last report`,
      description: `Moved from ${bc.from.replace(/_/g, ' ')} to ${bc.to.replace(/_/g, ' ')} since the last report. A single shift may not be meaningful — tracking it across future panels can help clarify the direction.`,
      relatedBiomarkers: [d.key],
    });
  }

  // Trend signal: worsening without a boundary crossing
  const worseningTrends = deltas.filter(
    d => d.significance === 'significant' && d.boundaryCrossing === null,
  );
  for (const d of worseningTrends.slice(0, 2)) {
    const dir = d.trendDirection === 'up' ? 'increasing' : 'decreasing';
    const pct = d.percentDelta !== null ? ` (${Math.abs(d.percentDelta)}%)` : '';
    signals.push({
      type: 'trend',
      title: `${d.displayName} — notable change from previous report`,
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
      title: `${systemLabel} — related markers shifted since last report`,
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
    reasons.push(`${Math.round(normRate * 100)}% of analytes mapped — some names may not have matched the Amani catalog.`);
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
      reasons.push('Extraction confidence is moderate — some values may have lower reliability.');
    } else {
      reasons.push('Extraction confidence is low — this panel may benefit from re-upload or manual review.');
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
    reasons.push(`${usableCount} analyte${usableCount !== 1 ? 's' : ''} with usable values — more markers improve insight depth.`);
  }

  // Factor 4: comparison context bonus (10 points)
  if (hasPreviousReport) {
    score += 10;
    reasons.push('Prior report available — trend analysis and biggest changes are included.');
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

  return {
    topFindings,
    biggestChanges,
    systemSummaries,
    questionsForDoctor,
    watchSignals,
    confidence,
  };
}
