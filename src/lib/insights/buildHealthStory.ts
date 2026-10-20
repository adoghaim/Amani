import type { BiomarkerCategory } from '../../types';
import { HEALTH_STORY_EMPTY } from '../scoring/insightCopy';
import type { FocusArea } from './buildFocusAreas';

export interface PrimaryContext {
  primary_biomarker: string;
  canonical_slug: string | null;
  current_value: number;
  previous_value: number | null;
  unit: string | null;
  current_status: 'elevated' | 'low' | 'in_range' | 'borderline' | 'out_of_range';
  trajectory: 'improving' | 'worsening' | 'changed' | 'unchanged' | 'no_prior_data';
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
  primaryCategory?: BiomarkerCategory | null;
}

function trajectoryVerb(trajectory: PrimaryContext['trajectory'] | null): string {
  switch (trajectory) {
    // V2-03b Stage 2: "right direction but still needs follow-up" and "wrong
    // direction" judged movement and gave advice. Neither direction has
    // authority to do that, so every movement reads as a movement (owner R1, R2).
    case 'improving':
    case 'worsening':
    case 'changed':
      // V2-03 amendment 5: a movement the band does not authorize judging.
      return 'has changed since your prior report';
    case 'unchanged':
      return 'is unchanged from your prior report';
    case 'no_prior_data':
    default:
      return 'is the strongest signal in this panel';
  }
}

function pickDominant(
  focusAreas: FocusArea[],
  primaryCategory?: BiomarkerCategory | null,
): FocusArea | null {
  const aligned = focusAreas.find(fa => fa.isPrimaryAligned);
  if (aligned) return aligned;
  // 1. Prefer focus area whose category-id slice matches primaryCategory.
  // FocusArea ids are formed as either "<category>" or "<category>_<rule>" (see buildFocusAreas line 317).
  if (primaryCategory) {
    const matched = focusAreas.find(
      (fa) => fa.id === primaryCategory || fa.id.startsWith(`${primaryCategory}_`),
    );
    if (matched) return matched;
  }
  // 2. Fall back to existing behavior.
  return focusAreas[0] ?? null;
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
  primaryCategory?: BiomarkerCategory | null,
): HealthStorySentence | null {
  if (primaryContext) return {
    kind: 'theme',
    text: `${primaryContext.primary_biomarker} is the primary finding shown above${primaryContext.trajectory === 'no_prior_data' ? '.' : ` and ${trajectoryVerb(primaryContext.trajectory)}.`}`,
  };
  const dominant = pickDominant(focusAreas, primaryCategory);
  if (!dominant) return null;
  const dominantTitle = dominant.title.toLowerCase();
  const verb = trajectoryVerb(null);
  return {
    kind: 'theme',
    text: `This report is mainly about ${dominantTitle}, which ${verb}.`,
  };
}

function buildOthersSentence(
  focusAreas: FocusArea[],
  primaryCategory?: BiomarkerCategory | null,
): HealthStorySentence | null {
  if (focusAreas.length < 2) return null;
  const dominant = pickDominant(focusAreas, primaryCategory);
  if (!dominant) return null;
  const seen = new Set<string>();
  const others: string[] = [];
  for (const area of focusAreas) {
    if (area === dominant) continue;
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
  const { primaryContext, focusAreas, primaryCategory } = args;

  // "Your overall panel is generally within reference ranges" was reassurance
  // about her lab's ranges, inferred from Amani's bands. The policy states the
  // fact that produced it.
  if (focusAreas.length === 0 && !primaryContext) {
    return { sentences: [{ kind: 'theme', text: HEALTH_STORY_EMPTY }] };
  }

  const sentences: HealthStorySentence[] = [];

  const theme = buildThemeSentence(focusAreas, primaryContext, primaryCategory);
  if (theme) sentences.push(theme);

  const others = buildOthersSentence(focusAreas, primaryCategory);
  if (others) sentences.push(others);

  const pointer = buildFocusPointer(focusAreas);
  if (pointer) sentences.push(pointer);

  return { sentences };
}
