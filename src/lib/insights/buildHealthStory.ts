import type { FocusArea } from './buildFocusAreas';

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

export interface HealthStorySentence {
  text: string;
  kind: 'theme' | 'others' | 'pointer';
}

export interface HealthStory {
  sentences: HealthStorySentence[];
}

interface BuildHealthStoryArgs {
  primaryContext: PrimaryContext | null;
  focusAreas: FocusArea[];
}

function trajectoryVerb(trajectory: PrimaryContext['trajectory'] | null): string {
  switch (trajectory) {
    case 'improving':
      return 'is improving but not yet resolved';
    case 'worsening':
      return 'has shifted in the wrong direction since your prior report';
    case 'unchanged':
      return 'is unchanged from your prior report';
    case 'no_prior_data':
    default:
      return 'is the strongest signal in this panel';
  }
}

function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const last = items[items.length - 1] ?? '';
  return `${items.slice(0, -1).join(', ')}, and ${last}`;
}

function buildThemeSentence(
  focusAreas: FocusArea[],
  primaryContext: PrimaryContext | null,
): HealthStorySentence | null {
  const dominant = focusAreas[0];
  if (!dominant) return null;
  const dominantTitle = dominant.title.toLowerCase();
  const verb = trajectoryVerb(primaryContext?.trajectory ?? null);
  return {
    kind: 'theme',
    text: `This report is mainly about ${dominantTitle}, which ${verb}.`,
  };
}

function buildOthersSentence(focusAreas: FocusArea[]): HealthStorySentence | null {
  if (focusAreas.length <= 1) return null;
  const seen = new Set<string>();
  const others: string[] = [];
  for (const area of focusAreas.slice(1)) {
    const lowered = area.title.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    others.push(lowered);
  }
  if (others.length === 0) return null;
  return {
    kind: 'others',
    text: `Other areas to watch are ${formatList(others)}.`,
  };
}

function buildFocusPointer(focusAreas: FocusArea[]): HealthStorySentence | null {
  if (focusAreas.length === 0) return null;
  return {
    kind: 'pointer',
    text: 'See the focus areas below for where to direct your attention from this report.',
  };
}

export function buildHealthStory(args: BuildHealthStoryArgs): HealthStory {
  const { primaryContext, focusAreas } = args;

  if (focusAreas.length === 0) {
    return {
      sentences: [
        {
          kind: 'theme',
          text: 'Your overall panel is generally within reference ranges.',
        },
      ],
    };
  }

  const sentences: HealthStorySentence[] = [];

  const theme = buildThemeSentence(focusAreas, primaryContext);
  if (theme) sentences.push(theme);

  const others = buildOthersSentence(focusAreas);
  if (others) sentences.push(others);

  const pointer = buildFocusPointer(focusAreas);
  if (pointer) sentences.push(pointer);

  return { sentences };
}
