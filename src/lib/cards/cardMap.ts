export interface CardContent {
  title: string;
  summary: string;
  examples: string[];
  discussionItems: string[];
  trackingItems: string[];
  note: string;
}

export type CardKey =
  | 'thyroid_autoimmunity'
  | 'cardiovascular'
  | 'cycle_hormones'
  | 'metabolic'
  | 'kidney_hydration'
  | 'nutrient_sufficiency';

const SAFETY_NOTE = 'Educational information only. Discuss changes with your provider, especially if you are pregnant, breastfeeding, taking medications, or managing kidney-related concerns.';

export const CARD_MAP: Record<CardKey, CardContent> = {
  thyroid_autoimmunity: {
    title: 'Thyroid Autoimmunity Support',
    summary: 'TPO antibodies are still above range, so this area is worth tracking alongside thyroid function markers and symptoms.',
    examples: [
      'Brazil nuts',
      'eggs',
      'sardines',
      'pumpkin seeds',
      'protein-rich meals',
    ],
    discussionItems: [
      'Selenium',
      'Vitamin D',
      'Zinc',
    ],
    trackingItems: [
      'TPO antibodies',
      'TSH',
      'Free T4',
      'Free T3',
      'thyroid-related symptoms',
    ],
    note: SAFETY_NOTE,
  },

  cardiovascular: {
    title: 'Cardiovascular Support',
    summary: 'HDL is low, so it may be helpful to look at the full lipid pattern over time rather than focusing on one marker alone.',
    examples: [
      'olive oil',
      'avocado',
      'nuts and seeds',
      'fatty fish',
      'oats or beans',
    ],
    discussionItems: [
      'Omega-3',
      'Vitamin D',
      'Magnesium',
    ],
    trackingItems: [
      'HDL',
      'LDL',
      'triglycerides',
      'total cholesterol',
      'ApoB',
    ],
    note: SAFETY_NOTE,
  },

  cycle_hormones: {
    title: 'Cycle Hormone Context',
    summary: 'Hormone values can shift based on cycle timing, so cycle day, symptoms, and repeat timing matter when interpreting this area.',
    examples: [
      'protein-rich meals',
      'fiber-rich foods',
    ],
    discussionItems: [
      'cycle timing',
      'symptom patterns',
    ],
    trackingItems: [
      'cycle day',
      'progesterone',
      'estradiol',
    ],
    note: 'Educational information only. Hormone values are timing-sensitive, so discuss cycle timing and symptoms with your provider.',
  },

  metabolic: {
    title: 'Metabolic Support',
    summary: 'Glucose-related markers are useful to track together because one marker alone may not show the full metabolic picture.',
    examples: [
      'protein-forward meals',
      'fiber-rich foods',
      'balanced carbohydrates',
      'regular meal timing',
    ],
    discussionItems: [
      'fasting insulin',
      'HbA1c',
      'C-peptide',
    ],
    trackingItems: [
      'fasting glucose',
      'HbA1c',
      'fasting insulin',
      'C-peptide',
    ],
    note: SAFETY_NOTE,
  },

  kidney_hydration: {
    title: 'Kidney and Hydration Context',
    summary: 'BUN, creatinine, and their ratio can be influenced by hydration, protein intake, and kidney-related context.',
    examples: [
      'consistent hydration',
      'balanced protein intake',
      'foods with naturally occurring electrolytes, if appropriate',
    ],
    discussionItems: [
      'hydration status',
      'protein intake',
      'repeat kidney markers',
    ],
    trackingItems: [
      'BUN',
      'creatinine',
      'eGFR',
      'BUN/Creatinine Ratio',
    ],
    note: 'Educational information only. Because kidney-related markers are involved, discuss major diet or supplement changes with your provider first.',
  },

  nutrient_sufficiency: {
    title: 'Nutrient Sufficiency Context',
    summary: 'Nutrient and iron-related markers move together over time. Tracking them as a panel gives a fuller picture than any single value.',
    examples: [
      'leafy greens',
      'nuts and seeds',
      'eggs',
      'fatty fish',
      'legumes and lentils',
    ],
    discussionItems: [
      'Vitamin D',
      'Magnesium',
      'Iron',
      'Vitamin B12',
      'Folate',
    ],
    trackingItems: [
      'Vitamin D',
      'Ferritin',
      'Magnesium',
      'Folate',
      'Vitamin B12',
    ],
    note: SAFETY_NOTE,
  },
};

export function isCardKey(value: string): value is CardKey {
  return value === 'thyroid_autoimmunity'
    || value === 'cardiovascular'
    || value === 'cycle_hormones'
    || value === 'metabolic'
    || value === 'kidney_hydration'
    || value === 'nutrient_sufficiency';
}
