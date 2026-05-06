import type { BiomarkerName, BiomarkerCategory } from '../../types';
import { getDisplayName, getCategory, getImportance } from '../biomarkers/dictionary';
import type { ScoredBiomarker } from '../scoring/scoreBiomarker';
import type { InsightSummary, WatchSignal, BiggestChange } from './buildInsightSummary';

export interface FocusAreaMarker {
  slug: string;
  displayName: string;
  status: 'monitor' | 'attention' | 'reassuring';
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
  metabolic: 'Metabolic balance',
  lipids: 'Cardiovascular support',
  liver: 'Liver function',
  kidney: 'Kidney function',
  inflammation: 'Systemic inflammation',
  nutrients: 'Nutrient sufficiency',
  blood: 'Blood and hematology',
};

const CATEGORY_DEFAULT_WHY: Record<BiomarkerCategory, string> = {
  hormones: 'Multiple reproductive-hormone markers are outside their reference range. Tracking them together gives the clearest picture over time.',
  thyroid: 'Multiple thyroid markers are outside their reference range. Tracking these together gives the clearest picture over time.',
  metabolic: 'Multiple metabolic markers are outside their reference range. Tracking these together can highlight blood-sugar trends.',
  lipids: 'One or more lipid markers are outside their reference range. Tracking these together helps frame cardiovascular risk over time.',
  liver: 'One or more liver markers are outside their reference range. Tracking these together gives the clearest picture over time.',
  kidney: 'One or more kidney markers are outside their reference range. Tracking these together helps clarify whether the pattern is consistent.',
  inflammation: 'Inflammation markers are outside their reference range. Tracking these together helps reveal whether the pattern persists.',
  nutrients: 'One or more nutrient markers are outside their reference range. Tracking these together helps clarify nutrient status over time.',
  blood: 'One or more hematology markers are outside their reference range. Tracking these together gives the clearest picture over time.',
};

interface PatternRule {
  id: string;
  title: string;
  whyItMatters: string;
  matches: (markers: ScoredBiomarker[]) => boolean;
}

const PATTERN_RULES: Partial<Record<BiomarkerCategory, PatternRule[]>> = {
  thyroid: [
    {
      id: 'autoimmunity',
      title: 'Thyroid autoimmunity',
      whyItMatters: 'Thyroid antibodies are elevated, suggesting an autoimmune component worth tracking alongside thyroid function markers.',
      matches: (m) => m.some(s => (s.key === 'tpo_antibodies' || s.key === 'tg_antibodies') && s.concern > 0),
    },
  ],
  kidney: [
    {
      id: 'hydration',
      title: 'Kidney / hydration context',
      whyItMatters: 'Markers tied to hydration and kidney filtration are outside the optimal range. A single reading may reflect hydration status rather than kidney function on its own.',
      matches: (m) => m.some(s => s.key === 'bun_creatinine_ratio' && s.concern > 0)
        || m.some(s => s.key === 'bun' && s.concern > 0),
    },
  ],
  metabolic: [
    {
      id: 'blood_sugar',
      title: 'Blood sugar regulation',
      whyItMatters: 'Glucose-related markers are outside the optimal range. Tracking these together gives a fuller picture of insulin sensitivity over time.',
      matches: (m) => m.some(s =>
        (s.key === 'fasting_glucose' || s.key === 'hemoglobin_a1c' || s.key === 'fasting_insulin' || s.key === 'c_peptide')
        && s.concern > 0,
      ),
    },
  ],
  hormones: [
    {
      id: 'androgens',
      title: 'Androgen balance',
      whyItMatters: 'Androgen-related markers are outside the optimal range. Tracking them together gives a clearer picture than any single value.',
      matches: (m) => m.some(s =>
        (s.key === 'total_testosterone' || s.key === 'free_testosterone' || s.key === 'dheas' || s.key === 'shbg')
        && s.concern > 0,
      ),
    },
    {
      id: 'cycle_hormones',
      title: 'Cycle hormones',
      whyItMatters: 'Reproductive-hormone markers are outside the optimal range. Cycle phase context matters when interpreting these values.',
      matches: (m) => m.some(s =>
        (s.key === 'estradiol' || s.key === 'progesterone' || s.key === 'fsh' || s.key === 'lh' || s.key === 'amh' || s.key === 'prolactin')
        && s.concern > 0,
      ),
    },
  ],
  nutrients: [
    {
      id: 'iron_status',
      title: 'Iron status',
      whyItMatters: 'Iron-related markers are outside the optimal range. These move together and are best interpreted as a panel.',
      matches: (m) => m.some(s =>
        (s.key === 'ferritin' || s.key === 'serum_iron' || s.key === 'iron_saturation' || s.key === 'tibc' || s.key === 'uibc')
        && s.concern > 0,
      ),
    },
  ],
  inflammation: [
    {
      id: 'systemic',
      title: 'Systemic inflammation',
      whyItMatters: 'Inflammation markers are elevated. A single reading can reflect short-term factors; tracking over time helps reveal the pattern.',
      matches: (m) => m.some(s => (s.key === 'hs_crp' || s.key === 'esr') && s.concern > 0),
    },
  ],
};

function statusFor(s: ScoredBiomarker): FocusAreaMarker['status'] {
  if (s.concern === 2) return 'attention';
  if (s.concern === 1) return 'monitor';
  return 'reassuring';
}

function statusPhrase(s: ScoredBiomarker): string | null {
  switch (s.amaniStatus) {
    case 'borderline_high':
      return 'is borderline-high';
    case 'borderline_low':
      return 'is borderline-low';
    case 'out_of_range_high':
      return 'is elevated';
    case 'out_of_range_low':
      return 'is low';
    default:
      return null;
  }
}

function trajectoryPhrase(change: BiggestChange | null | undefined): string {
  if (!change) return '';
  const dir = change.boundaryCrossing?.direction;
  if (dir === 'improved') return 'is moving in the right direction';
  if (dir === 'worsened') return 'has shifted in the wrong direction';

  switch (change.trajectoryStatus) {
    case 'improving_still_high':
    case 'improving_still_low':
    case 'normalized':
      return 'is moving in the right direction';
    case 'worsening_still_high':
    case 'worsening_still_low':
    case 'newly_abnormal':
      return 'has shifted in the wrong direction';
    case 'stable_abnormal':
    case 'stable_normal':
      return 'has not changed significantly';
    default:
      return '';
  }
}

const CATEGORY_CLOSER: Record<BiomarkerCategory, (primary: string) => string> = {
  lipids: () => 'so the full lipid pattern is more useful than judging it alone.',
  thyroid: () => 'but this marker is still outside range.',
  kidney: () => 'so hydration and protein context matter when reading this pattern.',
  metabolic: () => 'so the full glucose pattern is worth tracking over time.',
  liver: () => 'so tracking these liver markers together is more informative than judging one alone.',
  hormones: () => 'Timing, symptoms, and cycle phase matter when interpreting this result.',
  inflammation: () => 'so tracking inflammation markers together is more useful than a single value.',
  nutrients: () => 'so nutrient status is best read across the full panel.',
  blood: () => 'so tracking these hematology markers together is more useful than a single value.',
};

function findChangeFor(
  marker: ScoredBiomarker,
  biggestChanges: BiggestChange[] | undefined,
): BiggestChange | null {
  if (!biggestChanges || biggestChanges.length === 0) return null;
  return biggestChanges.find(c => c.key === marker.key) ?? null;
}

function buildValueFreeWhy(
  topMarkers: ScoredBiomarker[],
  category: BiomarkerCategory,
  biggestChanges: BiggestChange[] | undefined,
): string | null {
  const flagged = topMarkers.filter(m => m.concern > 0);
  const primary = flagged[0];
  if (!primary) return null;

  const phrase = statusPhrase(primary);
  if (!phrase) return null;

  const primaryName = getDisplayName(primary.key);
  const change = findChangeFor(primary, biggestChanges);
  const trajectory = trajectoryPhrase(change);
  const closer = CATEGORY_CLOSER[category](primaryName);

  // Special composition for thyroid: lead with the primary signal, follow with
  // an explicit trend sentence that pairs with an out-of-range qualifier closer.
  if (category === 'thyroid') {
    if (trajectory) {
      const trendClause = trajectory.startsWith('is ')
        ? trajectory.slice(3) // "is moving in the right direction" -> "moving in the right direction"
        : trajectory.startsWith('has ')
          ? trajectory // "has shifted in the wrong direction" / "has not changed significantly"
          : trajectory;
      return `${primaryName} remains the main thyroid signal. The trend ${trendClause === trajectory ? trajectory : `is ${trendClause}`}, ${closer}`;
    }
    return `${primaryName} ${phrase} and remains the main thyroid signal, ${closer}`;
  }

  // Hormones: closer is its own sentence (cycle context).
  if (category === 'hormones') {
    const hormoneContext = primary.key === 'progesterone' || primary.key === 'estradiol' || primary.key === 'lh' || primary.key === 'fsh'
      ? `${primaryName} ${phrase} for the recorded cycle context.`
      : `${primaryName} ${phrase}.`;
    return `${hormoneContext} ${closer}`;
  }

  // Default lead: "<Marker> is <state>, <closer>"
  return `${primaryName} ${phrase}, ${closer}`;
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
  biggestChanges: BiggestChange[] | undefined,
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
  const relatedMarkers: FocusAreaMarker[] = topMarkers.map(s => ({
    slug: s.key,
    displayName: getDisplayName(s.key),
    status: statusFor(s),
  }));

  const rules = PATTERN_RULES[category] ?? [];
  const matchedRule = rules.find(r => r.matches(markers));

  const id = matchedRule ? `${category}_${matchedRule.id}` : category;
  const title = matchedRule?.title ?? CATEGORY_DEFAULT_TITLE[category];

  // Keep findMatchingWatchSignal call alive for potential future use cases,
  // but no longer source whyItMatters from watch description (it carries values).
  void findMatchingWatchSignal(
    watchSignals,
    category,
    topMarkers.map(m => m.key),
  );

  const whyItMatters = matchedRule?.whyItMatters
    ?? buildValueFreeWhy(topMarkers, category, biggestChanges)
    ?? CATEGORY_DEFAULT_WHY[category];

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
  if (flagged.length === 0) return [];

  const buckets = bucketByCategory(flagged);
  if (buckets.length === 0) return [];

  const top = buckets.slice(0, 3);
  const focusAreas = top.map(b => buildOneArea(b, watchSignals, insightSummary.biggestChanges));

  const annotated = focusAreas.map(fa => ({
    ...fa,
    isPrimaryAligned:
      primaryCategory != null
      && (fa.id === primaryCategory || fa.id.startsWith(`${primaryCategory}_`)),
  }));

  const primaryIdx = annotated.findIndex(fa => fa.isPrimaryAligned);
  if (primaryIdx > 0) {
    const [aligned] = annotated.splice(primaryIdx, 1);
    if (aligned) annotated.unshift(aligned);
  }

  return annotated;
}
