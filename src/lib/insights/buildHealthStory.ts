import type { BiggestChange } from './buildInsightSummary';

export interface PrimaryContext {
  primary_biomarker: string;
  canonical_slug: string | null;
  current_value: number;
  previous_value: number | null;
  unit: string | null;
  current_status: 'elevated' | 'low' | 'in_range' | 'borderline' | 'out_of_range';
  trajectory: 'improving' | 'worsening' | 'unchanged' | 'no_prior_data';
  percent_change: number | null;
  prior_report_date: string | null;
  supporting_biomarker: { name: string; value: string; direction: string } | null;
}

export interface TopOutOfRange {
  slug: string;
  displayName: string;
  value: string;
  unit: string | null;
}

export interface HealthStorySentence {
  text: string;
  kind: 'primary' | 'secondary' | 'pointer';
}

export interface HealthStory {
  sentences: HealthStorySentence[];
}

interface BuildHealthStoryArgs {
  primaryContext: PrimaryContext | null;
  biggestChanges: BiggestChange[];
  topOutOfRange: TopOutOfRange[];
  hasFocusAreas: boolean;
}

function statusWord(status: PrimaryContext['current_status']): string {
  switch (status) {
    case 'elevated': return 'elevated';
    case 'low': return 'low';
    case 'borderline': return 'borderline';
    case 'out_of_range': return 'outside range';
    case 'in_range': return 'within range';
  }
}

function secondaryStatusWord(displayName: string, slug: string, biggestChanges: BiggestChange[]): string {
  const change = biggestChanges.find(c => c.displayName === displayName || c.key === slug);
  if (change?.boundaryCrossing?.to === 'out_of_range') return 'flagged';
  if (change?.boundaryCrossing?.to === 'borderline') return 'borderline';
  return 'flagged';
}

function formatUnit(unit: string | null): string {
  if (!unit) return '';
  return ` ${unit}`;
}

function buildPrimarySentence(ctx: PrimaryContext | null): HealthStorySentence | null {
  if (!ctx) {
    return {
      kind: 'primary',
      text: 'Your overall panel is generally within reference ranges.',
    };
  }

  const name = ctx.primary_biomarker;
  const status = statusWord(ctx.current_status);
  const unit = formatUnit(ctx.unit);
  const cur = ctx.current_value;
  const prev = ctx.previous_value;

  if (ctx.trajectory === 'improving' && prev !== null) {
    return {
      kind: 'primary',
      text: `${name} remains ${status} at ${cur}${unit}, but has improved from ${prev}${unit} since your last report.`,
    };
  }

  if (ctx.trajectory === 'worsening' && prev !== null) {
    return {
      kind: 'primary',
      text: `${name} remains ${status} at ${cur}${unit} and has increased from ${prev}${unit} since your last report.`,
    };
  }

  if (ctx.trajectory === 'unchanged' && prev !== null) {
    return {
      kind: 'primary',
      text: `${name} remains ${status} at ${cur}${unit} and has not changed significantly from your previous result.`,
    };
  }

  return {
    kind: 'primary',
    text: `${name} is ${status} at ${cur}${unit} — this is the first tracked ${name} result in Amani, so future reports will show whether it is improving or worsening.`,
  };
}

function buildSecondarySentence(
  ctx: PrimaryContext | null,
  topOutOfRange: TopOutOfRange[],
  biggestChanges: BiggestChange[],
): HealthStorySentence | null {
  const primaryName = ctx?.primary_biomarker ?? null;
  const primarySlug = ctx?.canonical_slug ?? null;

  const secondaries = topOutOfRange.filter(item => {
    if (primaryName && item.displayName === primaryName) return false;
    if (primarySlug && item.slug === primarySlug) return false;
    return true;
  });

  if (secondaries.length === 0) return null;

  const [a, b] = secondaries;
  if (!a) return null;

  if (!b) {
    const word = secondaryStatusWord(a.displayName, a.slug, biggestChanges);
    const unit = formatUnit(a.unit);
    return {
      kind: 'secondary',
      text: `${a.displayName} is also ${word} at ${a.value}${unit}, which is worth tracking alongside.`,
    };
  }

  return {
    kind: 'secondary',
    text: `${a.displayName} and ${b.displayName} are also flagged, both worth tracking alongside.`,
  };
}

function buildPointerSentence(hasFocusAreas: boolean): HealthStorySentence | null {
  if (!hasFocusAreas) return null;
  return {
    kind: 'pointer',
    text: 'See the focus areas below for where to direct your attention from this report.',
  };
}

export function buildHealthStory(args: BuildHealthStoryArgs): HealthStory {
  const { primaryContext, biggestChanges, topOutOfRange, hasFocusAreas } = args;

  const sentences: HealthStorySentence[] = [];

  const primary = buildPrimarySentence(primaryContext);
  if (primary) sentences.push(primary);

  const secondary = buildSecondarySentence(primaryContext, topOutOfRange, biggestChanges);
  if (secondary) sentences.push(secondary);

  const pointer = buildPointerSentence(hasFocusAreas);
  if (pointer) sentences.push(pointer);

  return { sentences };
}
