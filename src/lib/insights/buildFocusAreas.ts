import type { BiomarkerName, BiomarkerCategory } from '../../types';
import { getDisplayName, getCategory, getImportance } from '../biomarkers/dictionary';
import {
  authorizedLanguage, combineLanguage, describeComparisonBand, describeMeasuredMovement, focusAreaObservation,
  type AuthorizedLanguage,
} from '../scoring/insightCopy';
import type { ScoredBiomarker } from '../scoring/scoreBiomarker';
import type { InsightSummary, WatchSignal, BiggestChange } from './buildInsightSummary';

/*
  V2-03b Stage 2. A focus area groups markers outside Amani's bands. Its
  sentence is the policy's: the markers' placement with their bands' review
  state, plus measured movement where there is a prior report. The rule and
  category sentences that used to stand here ("Thyroid antibodies are
  elevated, suggesting an autoimmune component", "helps frame cardiovascular
  risk", "outside their reference range" for an Amani band) are gone, as is
  the per-marker "is borderline-high". A chip marks a marker outside its band.
*/
export interface FocusAreaMarker {
  slug: string;
  displayName: string;
  status: 'outside';
}

export interface FocusArea {
  id: string;
  title: string;
  whyItMatters: string;
  relatedMarkers: FocusAreaMarker[];
  isPrimaryAligned: boolean;
}

const IMPORTANCE_RANK: Record<'critical' | 'important' | 'supporting', number> = {
  critical: 3,
  important: 2,
  supporting: 1,
};

const CATEGORY_DEFAULT_TITLE: Record<BiomarkerCategory, string> = {
  hormones: 'Cycle hormones',
  thyroid: 'Thyroid function',
  metabolic: 'Metabolic markers',
  lipids: 'Lipids',
  liver: 'Liver function',
  kidney: 'Kidney function',
  inflammation: 'Inflammation markers',
  nutrients: 'Nutrients',
  blood: 'Blood and hematology',
};

// Grouping only: the id selects a Support plan card (buildCards.ts). A title
// names the markers, never a condition ("Thyroid autoimmunity").
interface PatternRule {
  id: string;
  title: string;
  matches: (markers: ScoredBiomarker[]) => boolean;
}

const PATTERN_RULES: Partial<Record<BiomarkerCategory, PatternRule[]>> = {
  thyroid: [
    {
      id: 'autoimmunity',
      title: 'Thyroid antibodies',
      matches: (m) => m.some(s => (s.key === 'tpo_antibodies' || s.key === 'tg_antibodies') && s.concern > 0),
    },
  ],
  kidney: [
    {
      id: 'hydration',
      title: 'Kidney and hydration markers',
      matches: (m) => m.some(s => s.key === 'bun_creatinine_ratio' && s.concern > 0)
        || m.some(s => s.key === 'bun' && s.concern > 0),
    },
  ],
  metabolic: [
    {
      id: 'blood_sugar',
      title: 'Blood sugar markers',
      matches: (m) => m.some(s =>
        (s.key === 'fasting_glucose' || s.key === 'hemoglobin_a1c' || s.key === 'fasting_insulin' || s.key === 'c_peptide')
        && s.concern > 0,
      ),
    },
  ],
  hormones: [
    {
      id: 'androgens',
      title: 'Androgens',
      matches: (m) => m.some(s =>
        (s.key === 'total_testosterone' || s.key === 'free_testosterone' || s.key === 'dheas' || s.key === 'shbg')
        && s.concern > 0,
      ),
    },
    {
      id: 'cycle_hormones',
      title: 'Cycle hormones',
      matches: (m) => m.some(s =>
        (s.key === 'estradiol' || s.key === 'progesterone' || s.key === 'fsh' || s.key === 'lh' || s.key === 'amh' || s.key === 'prolactin')
        && s.concern > 0,
      ),
    },
  ],
  nutrients: [
    {
      id: 'iron_status',
      title: 'Iron markers',
      matches: (m) => m.some(s =>
        (s.key === 'ferritin' || s.key === 'serum_iron' || s.key === 'iron_saturation' || s.key === 'tibc' || s.key === 'uibc')
        && s.concern > 0,
      ),
    },
  ],
  inflammation: [
    {
      id: 'systemic',
      title: 'Inflammation markers',
      matches: (m) => m.some(s => (s.key === 'hs_crp' || s.key === 'esr') && s.concern > 0),
    },
  ],
};

const IRON_MARKERS = new Set<BiomarkerName>(['ferritin', 'serum_iron', 'iron_saturation', 'tibc', 'uibc']);

function trajectoryPhrase(change: BiggestChange | null | undefined): string {
  // A first-recorded entry has no prior value (its previousValue is a 0
  // placeholder): stating any movement for it would be false.
  if (!change || change.isFirstRecorded) return '';
  // Raw band statuses and crossings carry no clinical direction authority.
  // Magnitude comes from the existing deterministic change calculation (R4).
  return describeMeasuredMovement(change, 'magnitude').text;
}

function findChangeFor(
  marker: ScoredBiomarker,
  biggestChanges: BiggestChange[] | undefined,
): BiggestChange | null {
  if (!biggestChanges || biggestChanges.length === 0) return null;
  return biggestChanges.find(c => c.key === marker.key) ?? null;
}

function languageFor(summary: Pick<InsightSummary, 'deltaMap' | 'bandLanguage'>, key: BiomarkerName): AuthorizedLanguage {
  return summary.bandLanguage?.get(key) ?? summary.deltaMap.get(key)?.bandLanguage ?? authorizedLanguage(null);
}

function buildWhy(
  topMarkers: ScoredBiomarker[],
  category: BiomarkerCategory,
  summary: Pick<InsightSummary, 'biggestChanges' | 'deltaMap' | 'bandLanguage'>,
): string {
  const flagged = topMarkers.filter(m => m.concern > 0);
  const primary = flagged[0]!;
  const trajectory = trajectoryPhrase(findChangeFor(primary, summary.biggestChanges));

  // Movement and band placement have separate policy authorities. In particular,
  // DISPUTED must withhold placement and no trajectory establishes persistence.
  if (category === 'thyroid' && trajectory) {
    const band = describeComparisonBand(languageFor(summary, primary.key), 'outside');
    return `${trajectory} ${band.text}`;
  }
  const placement = focusAreaObservation(
    flagged.map(m => getDisplayName(m.key)),
    combineLanguage(flagged.map(m => languageFor(summary, m.key))),
  );
  return trajectory ? `${trajectory} ${placement}` : placement;
}

function findMatchingWatchSignal(
  watchSignals: WatchSignal[],
  category: BiomarkerCategory,
  markerKeys: BiomarkerName[],
): WatchSignal | null {
  const keySet = new Set<string>(markerKeys);
  for (const w of watchSignals) {
    if (w.relatedBiomarkers.some(k => {
      if (keySet.has(k)) return true;
      const cat = getCategory(k as BiomarkerName);
      return cat === category;
    })) {
      return w;
    }
  }
  return null;
}

interface SystemBucket {
  category: BiomarkerCategory;
  markers: ScoredBiomarker[];
  severity: number;
  outOfRangeCount: number;
}

function bucketByCategory(flagged: ScoredBiomarker[]): SystemBucket[] {
  const map = new Map<BiomarkerCategory, ScoredBiomarker[]>();
  for (const s of flagged) {
    const cat = getCategory(s.key);
    if (!cat) continue;
    let bucket = map.get(cat);
    if (!bucket) {
      bucket = [];
      map.set(cat, bucket);
    }
    bucket.push(s);
  }

  const buckets: SystemBucket[] = [];
  for (const [category, markers] of map) {
    const outOfRangeCount = markers.filter(m => m.concern === 2).length;
    const borderlineCount = markers.filter(m => m.concern === 1).length;
    const importanceWeight = markers.reduce(
      (sum, m) => sum + IMPORTANCE_RANK[getImportance(m.key)] * (m.concern === 2 ? 2 : 1),
      0,
    );
    const severity = outOfRangeCount * 10 + borderlineCount * 3 + importanceWeight;
    buckets.push({ category, markers, severity, outOfRangeCount });
  }

  buckets.sort((a, b) => {
    if (b.outOfRangeCount !== a.outOfRangeCount) return b.outOfRangeCount - a.outOfRangeCount;
    return b.severity - a.severity;
  });

  return buckets;
}

function buildOneArea(
  bucket: SystemBucket,
  watchSignals: WatchSignal[],
  summary: Pick<InsightSummary, 'biggestChanges' | 'deltaMap' | 'bandLanguage'>,
): FocusArea {
  const { category, markers } = bucket;

  const ranked = [...markers].sort((a, b) => {
    if (b.concern !== a.concern) return b.concern - a.concern;
    const ai = IMPORTANCE_RANK[getImportance(a.key)];
    const bi = IMPORTANCE_RANK[getImportance(b.key)];
    if (bi !== ai) return bi - ai;
    return b.weightedConcern - a.weightedConcern;
  });

  const topMarkers = ranked.slice(0, 4);
  // Every bucketed marker is flagged, so every chip is a marker outside its band.
  const relatedMarkers: FocusAreaMarker[] = topMarkers.map(s => ({
    slug: s.key,
    displayName: getDisplayName(s.key),
    status: 'outside',
  }));

  const rules = PATTERN_RULES[category] ?? [];
  const mixedNutrients = category === 'nutrients' && markers.some(m => !IRON_MARKERS.has(m.key));
  const matchedRule = mixedNutrients ? undefined : rules.find(r => r.matches(markers));

  const id = matchedRule ? `${category}_${matchedRule.id}` : category;
  const title = matchedRule?.title ?? CATEGORY_DEFAULT_TITLE[category];

  // Keep findMatchingWatchSignal call alive for potential future use cases,
  // but no longer source whyItMatters from watch description (it carries values).
  void findMatchingWatchSignal(
    watchSignals,
    category,
    topMarkers.map(m => m.key),
  );

  const whyItMatters = buildWhy(topMarkers, category, summary);

  return { id, title, whyItMatters, relatedMarkers, isPrimaryAligned: false };
}

export function buildFocusAreas(
  insightSummary: InsightSummary,
  watchSignals: WatchSignal[],
  flaggedBiomarkers: ScoredBiomarker[],
  // Accepted for backwards compatibility with existing callers, but no longer
  // used. Actions belong only in Next Best Steps; Focus Areas are context-only.
  _unusedWhatYouCanDoNow?: string[] | null,
  primaryCategory?: BiomarkerCategory | null,
): FocusArea[] {
  const flagged = flaggedBiomarkers.filter(b => b.concern > 0);
  const buckets = bucketByCategory(flagged);
  const labFindings = insightSummary.labFindings ?? [];
  const labCategories = new Set(labFindings.map(f => getCategory(f.key)));
  const primaryKey = insightSummary.primaryFinding?.key;
  buckets.sort((a, b) => Number(labCategories.has(b.category)) - Number(labCategories.has(a.category)));
  // Keep every lab-flagged category plus the usual three focus areas.
  const top = buckets.filter((b, i) => i < 3 || labCategories.has(b.category) || b.category === primaryCategory);
  const focusAreas = top.map(b => buildOneArea(b, watchSignals, insightSummary));
  for (const finding of labFindings) {
    const area = focusAreas.find(a => a.relatedMarkers.some(m => m.slug === finding.key));
    if (area) area.whyItMatters = `${finding.fact} ${area.whyItMatters}`;
    else focusAreas.push({
      id: `${getCategory(finding.key)}_lab_${finding.key}`,
      title: finding.displayName,
      whyItMatters: finding.fact,
      relatedMarkers: [{ slug: finding.key, displayName: finding.displayName, status: 'outside' }],
      isPrimaryAligned: false,
    });
  }
  const labKeys = new Set(labFindings.map(f => f.key));
  const rank = (area: FocusArea) => area.relatedMarkers.some(m => m.slug === primaryKey) ? 2
    : area.relatedMarkers.some(m => labKeys.has(m.slug as BiomarkerName)) ? 1 : 0;
  focusAreas.sort((a, b) => rank(b) - rank(a));

  const annotated = focusAreas.map(fa => ({
    ...fa,
    isPrimaryAligned:
      primaryKey ? fa.relatedMarkers.some(m => m.slug === primaryKey)
        : primaryCategory != null && (fa.id === primaryCategory || fa.id.startsWith(`${primaryCategory}_`)),
  }));

  const primaryIdx = annotated.findIndex(fa => fa.isPrimaryAligned);
  if (primaryIdx > 0) {
    const [aligned] = annotated.splice(primaryIdx, 1);
    if (aligned) annotated.unshift(aligned);
  }

  return annotated;
}
