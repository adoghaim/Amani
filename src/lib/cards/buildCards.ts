import { CARD_MAP, isCardKey, type CardContent, type CardKey } from './cardMap';

export interface FocusAreaInput {
  id: string;
}

export interface BuiltCard extends CardContent {
  id: CardKey;
}

// Map focus-area ids (from buildFocusAreas: "<category>" or "<category>_<rule>")
// onto Support Plan card keys.
const FOCUS_TO_CARD: Record<string, CardKey> = {
  thyroid_autoimmunity: 'thyroid_autoimmunity',
  lipids: 'cardiovascular',
  hormones_cycle_hormones: 'cycle_hormones',
  metabolic_blood_sugar: 'metabolic',
  metabolic: 'metabolic',
  kidney_hydration: 'kidney_hydration',
  nutrients: 'nutrient_sufficiency',
  nutrients_iron_status: 'nutrient_sufficiency',
};

function focusIdToCardKey(focusAreaId: string): CardKey | null {
  if (isCardKey(focusAreaId)) return focusAreaId;
  return FOCUS_TO_CARD[focusAreaId] ?? null;
}

const MAX_CARDS = 3;

export function buildCards(
  focusAreas: FocusAreaInput[],
  primaryFocusId?: string | null,
): BuiltCard[] {
  const ordered: string[] = [];

  if (primaryFocusId) {
    ordered.push(primaryFocusId);
  }
  for (const area of focusAreas) {
    ordered.push(area.id);
  }

  const seen = new Set<CardKey>();
  const cards: BuiltCard[] = [];

  for (const id of ordered) {
    if (cards.length >= MAX_CARDS) break;
    const key = focusIdToCardKey(id);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ id: key, ...CARD_MAP[key] });
  }

  return cards;
}
