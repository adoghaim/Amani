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

function rangeWord(status: PrimaryContext['current_status'], direction?: 'high' | 'low'): string {
  switch (status) {
    case 'elevated': return 'above range';
    case 'low': return 'below range';
    case 'borderline': return 'near the boundary';
    case 'in_range': return 'within range';
    case 'out_of_range':
      if (direction === 'high') return 'above range';
      if (direction === 'low') return 'below range';
      return 'outside range';
  }
}

function isPluralSubject(displayName: string): boolean {
  const n = displayName.toLowerCase();
  return /(antibodies|cells|ratios|levels|counts|enzymes|lipids|electrolytes|hormones|platelets|lymphocytes|monocytes|eosinophils|basophils|neutrophils|reticulocytes|triglycerides|globulins|markers)\b/.test(n);
}

function conjugate(displayName: string): { has: 'has' | 'have'; remain: 'remains' | 'remain' } {
  const plural = isPluralSubject(displayName);
  return {
    has: plural ? 'have' : 'has',
    remain: plural ? 'remain' : 'remains',
  };
}

function formatValue(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs >= 10 ? 1 : 2;
  const rounded = Number(n.toFixed(decimals));
  return String(rounded);
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
  const range = rangeWord(ctx.current_status);
  const unit = formatUnit(ctx.unit);
  const prev = ctx.previous_value;
  const { has: conjHas, remain: conjRemain } = conjugate(name);

  if (ctx.trajectory === 'improving' && prev !== null) {
    return {
      kind: 'primary',
      text: `${name} ${conjHas} improved from ${formatValue(prev)}${unit} to ${formatValue(ctx.current_value)}${unit} since your prior report, while still remaining ${range}.`,
    };
  }

  if (ctx.trajectory === 'worsening' && prev !== null) {
    return {
      kind: 'primary',
      text: `${name} ${conjHas} increased since your prior report and ${conjRemain} ${range}.`,
    };
  }

  if (ctx.trajectory === 'unchanged' && prev !== null) {
    return {
      kind: 'primary',
      text: `${name} ${conjRemain} ${range} and ${conjHas} not changed significantly since your prior report.`,
    };
  }

  return {
    kind: 'primary',
    text: `This is the first tracked ${name} result in Amani, so future reports will show whether this marker is improving, worsening, or staying stable.`,
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
