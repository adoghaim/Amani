import type { BiomarkerName, BiomarkerCategory } from '../../types';
import { getDisplayName, getCategory, getImportance } from '../biomarkers/dictionary';
import type { ScoredBiomarker } from '../scoring/scoreBiomarker';
import type { InsightSummary, WatchSignal } from './buildInsightSummary';

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
  nextAction: string;
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

const CATEGORY_KEYWORDS: Record<BiomarkerCategory, string[]> = {
  hormones: ['hormone', 'estrogen', 'estradiol', 'progesterone', 'testosterone', 'dheas', 'shbg', 'prolactin', 'cycle', 'amh', 'fsh', 'lh'],
  thyroid: ['thyroid', 'tsh', 't3', 't4', 'tpo', 'thyroglobulin'],
  metabolic: ['glucose', 'a1c', 'insulin', 'metabolic', 'blood sugar', 'c-peptide', 'c peptide'],
  lipids: ['cholesterol', 'ldl', 'hdl', 'triglyceride', 'apob', 'lipoprotein', 'lipid', 'cardiovascular'],
  liver: ['liver', 'ast', 'alt', 'ggt', 'bilirubin', 'alkaline phosphatase'],
  kidney: ['kidney', 'creatinine', 'bun', 'egfr', 'hydration'],
  inflammation: ['inflammation', 'crp', 'esr'],
  nutrients: ['vitamin', 'iron', 'ferritin', 'b12', 'folate', 'magnesium', 'nutrient', 'tibc'],
  blood: ['hemoglobin', 'hematocrit', 'platelet', 'wbc', 'rbc', 'mcv', 'neutrophil', 'lymphocyte'],
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

function formatValue(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs >= 10 ? 1 : 2;
  const rounded = Number(n.toFixed(decimals));
  return String(rounded);
}

function formatUnit(unit: string | null | undefined): string {
  if (!unit) return '';
  return ` ${unit}`;
}

function statusWord(s: ScoredBiomarker): string | null {
  switch (s.amaniStatus) {
    case 'borderline_high':
      return 'borderline-high';
    case 'borderline_low':
      return 'borderline-low';
    case 'out_of_range_high':
      return 'elevated';
    case 'out_of_range_low':
      return 'low';
    default:
      return null;
  }
}

const CATEGORY_CLOSER: Record<BiomarkerCategory, (primary: string) => string> = {
  lipids: (primary) => `This makes the full lipid pattern more useful than judging ${primary} alone.`,
  thyroid: (primary) => `This makes the full thyroid pattern more useful than judging ${primary} alone.`,
  kidney: () => 'This pattern is worth tracking together.',
  metabolic: () => 'Tracking these blood-sugar markers together gives the clearest picture.',
  liver: () => 'Tracking these liver markers together is more informative than judging one alone.',
  hormones: () => 'Reproductive-hormone context matters when interpreting these together.',
  inflammation: () => 'Tracking inflammation markers together is more useful than a single value.',
  nutrients: () => 'Nutrient status is best read across the full panel.',
  blood: () => 'Tracking these hematology markers together is more useful than a single value.',
};

function buildValueRichWhy(
  topMarkers: ScoredBiomarker[],
  category: BiomarkerCategory,
): string | null {
  const flagged = topMarkers.filter(m => m.concern > 0);
  const primary = flagged[0];
  if (!primary) return null;
  const primaryWord = statusWord(primary);
  if (!primaryWord) return null;

  const primaryName = getDisplayName(primary.key);
  const primaryClause = `${primaryName} is ${primaryWord} at ${formatValue(primary.value)}${formatUnit(primary.unit)}`;

  let leadSentence = `${primaryClause}.`;
  const secondary = flagged[1];
  if (secondary) {
    const secondaryWord = statusWord(secondary);
    if (secondaryWord) {
      const secondaryName = getDisplayName(secondary.key);
      leadSentence = `${primaryClause}, while ${secondaryName} is ${secondaryWord}.`;
    }
  }

  const closer = CATEGORY_CLOSER[category](primaryName);
  return `${leadSentence} ${closer}`;
}

function findMatchingNextAction(
  whatYouCanDoNow: string[] | undefined,
  category: BiomarkerCategory,
  markers: FocusAreaMarker[],
): string | null {
  if (!whatYouCanDoNow || whatYouCanDoNow.length === 0) return null;

  const markerNames = markers.map(m => m.displayName.toLowerCase());
  const markerSlugs = markers.map(m => m.slug.toLowerCase().replace(/_/g, ' '));
  const categoryKeywords = CATEGORY_KEYWORDS[category] ?? [];

  for (const tip of whatYouCanDoNow) {
    const lower = tip.toLowerCase();
    if (markerNames.some(n => lower.includes(n))) return tip;
    if (markerSlugs.some(s => lower.includes(s))) return tip;
    if (categoryKeywords.some(k => lower.includes(k))) return tip;
  }
  return null;
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
  whatYouCanDoNow: string[] | undefined,
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

  const matchedWatch = findMatchingWatchSignal(
    watchSignals,
    category,
    topMarkers.map(m => m.key),
  );
  const whyItMatters = matchedWatch?.description
    ?? matchedRule?.whyItMatters
    ?? buildValueRichWhy(topMarkers, category)
    ?? CATEGORY_DEFAULT_WHY[category];

  const matchedAction = findMatchingNextAction(whatYouCanDoNow, category, relatedMarkers);
  const fallbackAction = bucket.outOfRangeCount > 0
    ? 'Discuss these results with your provider at your next visit.'
    : 'Track these markers in your next report to see if the pattern holds.';
  const nextAction = matchedAction ?? fallbackAction;

  return { id, title, whyItMatters, relatedMarkers, nextAction };
}

export function buildFocusAreas(
  _insightSummary: InsightSummary,
  watchSignals: WatchSignal[],
  flaggedBiomarkers: ScoredBiomarker[],
  whatYouCanDoNow: string[] | undefined,
): FocusArea[] {
  const flagged = flaggedBiomarkers.filter(b => b.concern > 0);
  if (flagged.length === 0) return [];

  const buckets = bucketByCategory(flagged);
  if (buckets.length === 0) return [];

  const top = buckets.slice(0, 3);
  return top.map(b => buildOneArea(b, watchSignals, whatYouCanDoNow));
}
