import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_NUTRIENTS,
  ALLOWED_NUTRIENT_ALIASES,
  BANNED_SUPPLEMENTS,
  BANNED_SUPPLEMENT_ABBREVIATIONS,
  findTextViolations,
  validateInterpretationOutput,
} from './nutrient-policy';

// Adversarial corpus for the medical-boundary validator (review F015, F096).
// Every expected value below is a literal, never derived from the module under
// test, so deleting a list entry or loosening a pattern turns this suite red.

const codes = (text: string) => findTextViolations(text).map((v) => v.split(':')[0]);

// ─── Pinned lists ─────────────────────────────────────────────────────────────

const PINNED_BANNED_SUPPLEMENTS = [
  'ashwagandha',
  'maca',
  'vitex',
  'chasteberry',
  'chaste tree',
  'diindolylmethane',
  'evening primrose',
  'black cohosh',
  'rhodiola',
  'ginseng',
  'saw palmetto',
  'berberine',
  'inositol',
  'n-acetylcysteine',
  'n-acetyl cysteine',
  'red clover',
  'dong quai',
  'licorice root',
  'milk thistle',
  "st john's wort",
  "st. john's wort",
  "saint john's wort",
  'tribulus',
  'fenugreek',
  'melatonin',
  'adaptogen',
  '5-htp',
  'valerian',
  'kava',
  'shatavari',
];

describe('pinned lists (a deleted entry must fail a test)', () => {
  it('pins BANNED_SUPPLEMENTS literally', () => {
    expect([...BANNED_SUPPLEMENTS]).toEqual(PINNED_BANNED_SUPPLEMENTS);
  });

  it('pins BANNED_SUPPLEMENT_ABBREVIATIONS literally', () => {
    expect([...BANNED_SUPPLEMENT_ABBREVIATIONS]).toEqual(['DIM', 'NAC']);
  });

  it('pins the allow-list and its aliases literally (a widened list is a weakening)', () => {
    expect([...ALLOWED_NUTRIENTS]).toEqual([
      'vitamin D', 'vitamin B12', 'folate', 'iron', 'magnesium', 'omega-3', 'iodine', 'selenium', 'zinc',
    ]);
    expect([...ALLOWED_NUTRIENT_ALIASES]).toEqual([
      'b12', 'cobalamin', 'vitamin d3', 'cholecalciferol', 'folic acid',
    ]);
  });

  it.each(PINNED_BANNED_SUPPLEMENTS)('catches the pinned term %s on bare mention', (term) => {
    expect(findTextViolations(`Some clinicians discuss ${term} in this context.`)).toContain(
      `banned_supplement:${term}`,
    );
  });
});

// ─── NUTRIENT_GUIDELINES.md examples ──────────────────────────────────────────

const GUIDELINE_CORRECT = [
  'Some clinicians may discuss vitamin D in the context of...',
  'You may want to ask your provider about...',
  'This could be a topic to explore with your healthcare team...',
  'For your vitamin D: dietary sources and a few minutes of midday sun a few times a week can help. Worth asking your provider whether supplementation is appropriate for you.',
];

const GUIDELINE_INCORRECT = [
  'Consider taking vitamin D',
  'You should supplement with...',
  'Take 2000 IU daily',
  'Start a magnesium supplement',
  'Take 2000 IU of vitamin D daily',
  'You should start taking a vitamin D supplement',
  'Consider an ashwagandha or rhodiola stack for stress',
  'Magnesium is important for overall health, ask your provider about a supplement',
  'Some clinicians discuss berberine supplementation',
  'Ask your provider about calcium supplementation',
];

describe('NUTRIENT_GUIDELINES.md examples are enforced as written', () => {
  const guide = readFileSync(new URL('../../../NUTRIENT_GUIDELINES.md', import.meta.url), 'utf8');

  it.each(GUIDELINE_CORRECT)('passes the CORRECT example %s', (text) => {
    expect(guide).toContain(text);
    expect(findTextViolations(text)).toEqual([]);
  });

  it.each(GUIDELINE_INCORRECT)('rejects the INCORRECT example %s', (text) => {
    expect(guide).toContain(text);
    expect(findTextViolations(text).length).toBeGreaterThan(0);
  });

  it('covers every row of the INCORRECT list and the NON-COMPLIANT table', () => {
    const incorrectList = guide.split('❌ **INCORRECT:**')[1].split('##')[0];
    const table = guide.split('### ❌ NON-COMPLIANT phrasing')[1].split('##')[0];
    const listed = [
      ...[...incorrectList.matchAll(/^- "(.+)"$/gm)].map((m) => m[1]),
      ...[...table.matchAll(/^\| "(.+?)" \|/gm)].map((m) => m[1]),
    ];
    expect(listed.length).toBeGreaterThanOrEqual(10);
    for (const row of listed) expect(GUIDELINE_INCORRECT).toContain(row);
  });

  it.each([
    ['You should supplement with iron.', 'prescriptive_verb'],
    ['You should supplement with magnesium.', 'prescriptive_verb'],
    ['Magnesium is important for overall health, ask your provider about a supplement', 'general_wellness'],
  ])('rejects %s with %s', (text, code) => {
    expect(codes(text)).toContain(code);
  });
});

// ─── F015: recommending verbs in substance context ───────────────────────────

describe('imperative and recommending verbs aimed at a substance (F015)', () => {
  it.each([
    'Consider taking vitamin D',
    'Take vitamin D with your largest meal.',
    'Start iron supplements and recheck ferritin.',
    'Use an iron supplement nightly.',
    'Try taking iron every other day.',
    'Take iron before bed.',
    'Begin vitamin B12 now.',
    'Add magnesium to your evening routine.',
    'Increase your zinc for a few weeks.',
    'Continue your iron supplement until the next draw.',
    'Stop taking selenium before the retest.',
    'You should take omega-3 with breakfast.',
    'You may want to try magnesium glycinate.',
    'I recommend you take iron.',
    'Clinicians often suggest taking vitamin D in winter.',
    'Taking iron with vitamin C improves absorption.',
    'Make sure to take your vitamins.',
    '- Start a multivitamin.',
    'Your ferritin is low; consider iron.',
    'Try two capsules of magnesium.',
  ])('flags %s as prescriptive', (text) => {
    expect(codes(text)).toContain('prescriptive_verb');
  });

  it.each([
    ['Use an iron supplement nightly.', 'nightly'],
    ['Try taking iron every other day.', 'every other day'],
    ['Iron capsules each morning were mentioned.', 'each morning'],
    ['A magnesium capsule before bed was mentioned.', 'before bed'],
    ['Magnesium glycinate at bedtime can help sleep.', 'at bedtime'],
    ['The vitamin D softgel goes with your largest meal.', 'with your largest meal'],
    ['Vitamin D three times a week came up.', 'three times a week'],
  ])('flags the schedule in %s', (text, phrase) => {
    expect(findTextViolations(text)).toContain(`dosing_frequency:${phrase}`);
  });
});

// ─── F096: obfuscation and evasion ────────────────────────────────────────────

describe('adversarial spellings are normalized before matching (F096)', () => {
  it.each([
    ['typographic apostrophe', 'Some clinicians discuss St John’s wort here.', "banned_supplement:st john's wort"],
    ['typographic apostrophe, title case with dot', 'St. John’s Wort is sometimes raised for mood.', "banned_supplement:st. john's wort"],
    ['modifier-letter apostrophe', 'Some clinicians discuss St Johnʼs wort here.', "banned_supplement:st john's wort"],
    ['no apostrophe at all', 'Some clinicians discuss St Johns wort here.', "banned_supplement:st john's wort"],
    ['zero-width space', 'Some clinicians discuss ashwa​gandha here.', 'banned_supplement:ashwagandha'],
    ['zero-width joiner', 'Some clinicians discuss rho‍diola here.', 'banned_supplement:rhodiola'],
    ['soft hyphen', 'Some clinicians discuss ber­berine here.', 'banned_supplement:berberine'],
    ['word joiner', 'Some clinicians discuss mela⁠tonin here.', 'banned_supplement:melatonin'],
    ['Cyrillic a homoglyph', 'Some clinicians discuss аshwagandha here.', 'banned_supplement:ashwagandha'],
    ['Cyrillic e and o homoglyphs', 'Some clinicians discuss bеrbеrinе or ginsеng with mеlatоnin.', 'banned_supplement:berberine'],
    ['Greek omicron homoglyph', 'Some clinicians discuss black cοhοsh here.', 'banned_supplement:black cohosh'],
    ['fullwidth letters', 'Some clinicians discuss ｍａｃａ here.', 'banned_supplement:maca'],
    ['combining accent', 'Some clinicians discuss ashwagándha here.', 'banned_supplement:ashwagandha'],
    ['non-breaking space inside a term', 'Some clinicians discuss saw palmetto here.', 'banned_supplement:saw palmetto'],
    ['non-breaking hyphen', 'Some clinicians discuss 5‑HTP here.', 'banned_supplement:5-htp'],
    ['sentence-case Dim', 'Dim is sometimes discussed for estrogen metabolism.', 'banned_supplement:DIM'],
    ['lower-case dim supplement', 'A dim supplement came up.', 'banned_supplement:DIM'],
    ['lower-case nac', 'Some people take nac for this.', 'banned_supplement:NAC'],
    ['sentence-case Nac', 'Nac is sometimes raised here.', 'banned_supplement:NAC'],
    ['herb without "supplement": valerian / kava', 'Valerian root or kava before bed may ease sleep.', 'banned_supplement:valerian'],
    ['herb without "supplement": shatavari', 'Shatavari is traditionally used to balance hormones.', 'banned_supplement:shatavari'],
  ])('%s', (_label, text, expected) => {
    expect(findTextViolations(text)).toContain(expected);
  });

  it.each([
    'A 500-milligram magnesium capsule at night is a common choice.',
    'Take two capsules of magnesium each night.',
    'Two thousand IU of vitamin D is a typical amount.',
    'Around 2,000 international units of vitamin D is typical.',
    'Most women do well on 200 μg of selenium.',
    'Most women do well on 200 µg of selenium.',
    'Fifty mcg of selenium was mentioned.',
    'Vitamin D at 5000 IUs is common.',
    'Iron at 65 mgs came up.',
    'A 2000 IU softgel came up.',
    'A ２０００ IU softgel came up.',
    '2000 I.U. of vitamin D was mentioned.',
    'A dose of one thousand micrograms came up.',
    'Three tablets of zinc came up.',
  ])('flags the dose in %s', (text) => {
    const found = codes(text);
    expect(found.some((c) => c === 'dosage_unit' || c === 'dosage_amount')).toBe(true);
  });

  it.each([
    ['Spearmint tea twice a day is popular for PCOS.', 'dosing_frequency'],
    ['Nature Made® vitamin D is one option.', 'brand_name'],
    ['A Thorne™ magnesium product came up.', 'brand_name'],
    ['Look for a reputable brand of vitamin D.', 'brand_name'],
    ['Choose a third-party tested iron supplement.', 'brand_name'],
    ['A USP verified magnesium capsule came up.', 'brand_name'],
  ])('flags %s with %s', (text, code) => {
    expect(codes(text)).toContain(code);
  });

  it.each(['red raspberry leaf', 'moringa', 'sea moss', 'myo-inositol blend', 'chlorella'])(
    'fails closed on %s supplementation through the allow-list rule itself',
    (term) => {
      expect(codes(`Some clinicians discuss ${term} supplementation in this context.`)).toContain(
        'unlisted_nutrient',
      );
    },
  );

  it('flags an obfuscated term wherever it hides in the object', () => {
    const doc = { key_findings: [{ explanation: 'Some clinicians discuss ashwa­gandha here.' }] };
    expect(validateInterpretationOutput(doc).violations).toContain('banned_supplement:ashwagandha');
  });
});

// ─── False-positive guard: consultative and lifestyle text still passes ──────

describe('legitimately consultative and lifestyle text still passes', () => {
  it.each([
    'Dim the lights an hour before bed.',
    'Dim lighting in the evening may help you wind down.',
    'Keep the room dim and cool at night.',
    'The signal here is dim and hard to read.',
    'Ask your provider whether you should take iron.',
    'Ask your provider if starting vitamin D makes sense for you.',
    'You may want to ask your provider about iron supplementation.',
    'If you take iron already, mention it at your next visit.',
    'Since you started iron supplements, ferritin has climbed.',
    'Consider a vitamin D level check at your next visit.',
    'Consider asking your clinician whether a vitamin D recheck makes sense.',
    'Try adding iron-rich foods your provider suggests.',
    'Your vitamin D rose 8 units since March.',
    'Vitamin D matters for bone and overall health.',
    'Low magnesium is linked to restless sleep.',
    'Take note of how your energy tracks with your iron results.',
    'Use this as a starting point for a conversation about iron.',
    'Aim for 15–20 minutes of midday sun a few times a week, especially if you’re indoors most of the day.',
    'Track how your energy and sleep align with these results over the next few weeks.',
    'Your fasting glucose was 105 mg/dL, drawn on an empty stomach.',
    'Hemoglobin came in at 13.2 g/dL.',
    'Serum iron was 45 µg/dL this draw.',
    'Free cortisol was 45 μg/24h across the overnight collection.',
    'The root cause of low ferritin is worth exploring; energy can take a hit.',
    'Your provider may suggest iron studies to see what is driving this.',
  ])('passes %s', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });
});

// ─── #159 verifier note 2: a substance recommended with no action verb ───────

describe('a substance recommended with no action verb is prescriptive (#159 note 2)', () => {
  it.each([
    ['We recommend iron for your low ferritin.', 'recommend iron'],
    ['Your ferritin was low; we suggest iron.', 'suggest iron'],
    ["I'd advise magnesium.", 'advise magnesium'],
    ["We'd encourage vitamin D.", 'encourage vitamin D'],
    ['I recommend iron.', 'recommend iron'],
    ['Recommend iron.', 'Recommend iron'],
    ['We recommended iron last time.', 'recommended iron'],
    ["We're recommending magnesium for now.", 'recommending magnesium'],
    ['We advised iron.', 'advised iron'],
    ['Recommend a magnesium supplement.', 'Recommend a magnesium'],
    ['- Suggest iron.', 'Suggest iron'],
    ['If your ferritin is low, we recommend iron.', 'recommend iron'],
    ['Experts recommend magnesium for sleep.', 'recommend magnesium'],
  ])('flags %s', (text, match) => {
    expect(findTextViolations(text)).toContain(`prescriptive_verb:${match}`);
  });

  it.each([
    'Discuss iron with your doctor.',
    'Your doctor may suggest checking your iron levels.',
    'Ask your provider whether they would recommend iron.',
    'If your doctor recommends iron, ask how long to take it.',
    'Your doctor may recommend iron.',
    'Your primary care doctor may recommend iron.',
    'Would you recommend iron for me?',
    'These results suggest your vitamin D is low.',
    'This pattern suggests iron may be a factor.',
    'We recommend a vitamin D recheck.',
    'Guidelines recommend vitamin D screening.',
  ])('passes the consultative or descriptive %s', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });
});

// ─── #159 verifier note 2: a time of day tied to a substance ─────────────────

describe('a time of day tied to a substance is dosing language (#159 note 2)', () => {
  it.each([
    ['Iron supplements are best taken at night.', 'at night'],
    ['Have your vitamin D supplement at night.', 'at night'],
    ['Magnesium at night may help you sleep.', 'at night'],
    ['Vitamin D in the morning is easiest to remember.', 'in the morning'],
    ['Magnesium, ideally at night.', 'at night'],
    ['Vitamin D works best in the afternoon.', 'in the afternoon'],
    ['Take your vitamin D with a glass of water in the morning.', 'in the morning'],
    ['In the evening, take your magnesium.', 'In the evening'],
  ])('flags %s', (text, phrase) => {
    expect(findTextViolations(text)).toContain(`dosing_frequency:${phrase}`);
  });

  it.each([
    'Do you wake up at night? Ask about your ferritin.',
    'Low iron can cause restless legs at night.',
    'Track how you sleep at night and bring it to your visit.',
    'Iron can leave your legs restless at night.',
    'Low magnesium can cause cramps at night.',
    'Serum iron peaks in the morning.',
    'Have your iron checked in the morning.',
    'Iron studies are usually drawn in the morning.',
    'Get some sun in the morning for your vitamin D.',
    'Cortisol drops in the evening, and your vitamin D is fine.',
  ])('passes the ordinary lab or symptom sentence %s', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });
});
