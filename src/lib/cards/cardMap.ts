import { EDUCATION, PRODUCT_DISCLAIMERS, type EducationalContent, type ProductDisclaimer } from '../scoring/insightCopy';

export interface CardContent {
  title: string;
  /** Policy-authored general education: fixed per topic, never written from her values. */
  summary: EducationalContent;
  /** Only a policy product disclaimer: its authority travels to the DOM. */
  note: ProductDisclaimer;
}

export type CardKey =
  | 'thyroid_autoimmunity'
  | 'cardiovascular'
  | 'cycle_hormones'
  | 'metabolic'
  | 'kidney_hydration'
  | 'nutrient_sufficiency';

/*
  V2-03b Stage 2, owner R4. A focus area outside an unreviewed Amani band
  selected these cards, and each card then listed "Foods to focus on",
  nutrients and supplements under "Topics to discuss", and tests under "Track
  next": the chain low-looking biomarker -> associated nutrient -> recommend
  food or supplement, with no Clinical Truth rule behind any link. Those lists
  are suppressed, not relabelled. What remains is the policy's general
  education about how a system's markers are read, which names no result, and
  the policy's product disclaimer.
*/
const SAFETY_NOTE = PRODUCT_DISCLAIMERS.guidance;

export const CARD_MAP: Record<CardKey, CardContent> = {
  thyroid_autoimmunity: { title: 'Thyroid Antibody Context', summary: EDUCATION.thyroid_antibodies, note: SAFETY_NOTE },
  cardiovascular: { title: 'Lipid Context', summary: EDUCATION.lipids, note: SAFETY_NOTE },
  cycle_hormones: { title: 'Cycle Hormone Context', summary: EDUCATION.cycle_hormones, note: PRODUCT_DISCLAIMERS.guidanceCycle },
  metabolic: { title: 'Metabolic Context', summary: EDUCATION.glucose, note: SAFETY_NOTE },
  kidney_hydration: { title: 'Kidney and Hydration Context', summary: EDUCATION.kidney, note: PRODUCT_DISCLAIMERS.guidanceKidney },
  nutrient_sufficiency: { title: 'Nutrient Context', summary: EDUCATION.nutrients, note: SAFETY_NOTE },
};

export function isCardKey(value: string): value is CardKey {
  return value === 'thyroid_autoimmunity'
    || value === 'cardiovascular'
    || value === 'cycle_hormones'
    || value === 'metabolic'
    || value === 'kidney_hydration'
    || value === 'nutrient_sufficiency';
}
