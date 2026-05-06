export type NextStepBucket = 'track' | 'discuss' | 'support' | 'retest';

export interface CategorizedStep {
  text: string;
  bucket: NextStepBucket;
}

const RETEST_KEYWORDS = [
  'retest',
  're-test',
  'recheck',
  'follow-up lab',
  'repeat in',
  'follow up in',
];

const DISCUSS_KEYWORDS = [
  'discuss',
  'ask your provider',
  'ask your doctor',
  'questions for',
  'talk to',
  'consult',
  'review with',
];

const SUPPORT_KEYWORDS = [
  'foods',
  'diet',
  'nutrition',
  'sleep',
  'stress',
  'movement',
  'exercise',
  'hydration',
  'magnesium',
  'vitamin d',
  'iron',
  'b12',
  'folate',
  'omega-3',
  'iodine',
  'topics to discuss',
  'fats',
  'fiber',
  'protein',
  'avocado',
  'nuts',
  'nut',
  'leafy green',
  'whole grain',
  'olive oil',
  'fish',
  'legume',
  'seed',
  'bean',
  'oat',
  'vegetable',
  'fruit',
  'lean meat',
  'salmon',
  'spinach',
  'kale',
  'broccoli',
  'incorporat',
  'eat more',
  'add to your diet',
  'include in your meals',
  'consume',
  'cook with',
  'snack on',
  'replace',
  'walking',
  'walk',
  'yoga',
  'meditation',
  'meditat',
  'workout',
  'physical activity',
  'mindful',
  'breath',
  'rest',
];

const LEADING_DISCUSS_VERBS = new Set([
  'discuss', 'ask', 'review', 'talk', 'consult', 'schedule',
]);

function startsWithDiscussVerb(text: string): boolean {
  const first = text
    .toLowerCase()
    .replace(/^[^a-z]*/, '')      // strip leading punctuation
    .split(/\s+/)[0]              // first word
    ?? '';
  return LEADING_DISCUSS_VERBS.has(first);
}

function classifyStep(step: string): NextStepBucket {
  const lower = step.toLowerCase();
  // classify order: Retest -> first-word Discuss -> Support -> fallback Discuss -> Track
  if (RETEST_KEYWORDS.some(k => lower.includes(k))) return 'retest';
  if (startsWithDiscussVerb(step)) return 'discuss';
  if (SUPPORT_KEYWORDS.some(k => lower.includes(k))) return 'support';
  // catch-all Discuss for backward-compat (e.g. "Have a discussion with...")
  if (DISCUSS_KEYWORDS.some(k => lower.includes(k))) return 'discuss';
  return 'track';
}

function dedupKey(step: string): string {
  return step.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function categorizeNextSteps(
  whatYouCanDoNow: string[] | undefined,
  whatToDoNext: string[] | undefined,
): Record<NextStepBucket, string[]> {
  const buckets: Record<NextStepBucket, string[]> = {
    track: [],
    discuss: [],
    support: [],
    retest: [],
  };

  const seen = new Set<string>();
  const union = [...(whatYouCanDoNow ?? []), ...(whatToDoNext ?? [])];

  for (const raw of union) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = dedupKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    buckets[classifyStep(trimmed)].push(trimmed);
  }

  return buckets;
}
