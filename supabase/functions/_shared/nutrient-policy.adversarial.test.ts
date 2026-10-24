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

// ─── RV-R2 round 1: the dosing verb after the substance ──────────────────────

describe('a time of day with the dosing verb after the substance is dosing language (RV-R2)', () => {
  it.each([
    ['Iron supplements are usually best taken at night.', 'at night'],
    ['Magnesium is usually best taken at night.', 'at night'],
    ['Vitamin D is typically best taken in the morning.', 'in the morning'],
    ['Iron should ideally be taken at night.', 'at night'],
    ['Magnesium glycinate is usually taken at night.', 'at night'],
    ["Magnesium's best taken at night.", 'at night'],
    ['Iron tablets are generally best used in the morning.', 'in the morning'],
    ['Iron is usually best when taken in the morning.', 'in the morning'],
    ['Vitamin D is easiest to take in the morning.', 'in the morning'],
    ['Iron is best to take in the morning.', 'in the morning'],
    ['Magnesium is something to take at night.', 'at night'],
    ['Iron is low and best taken at night.', 'at night'],
    ['Magnesium may also be used at night.', 'at night'],
  ])('flags %s', (text, phrase) => {
    expect(findTextViolations(text)).toContain(`dosing_frequency:${phrase}`);
  });

  it.each([
    'Your iron was low and you had trouble sleeping at night.',
    'Iron was low and had dropped further in the evening.',
    'Iron is used to make hemoglobin, so low iron can leave you tired in the afternoon.',
    'Your vitamin D sample was taken in the morning.',
  ])('passes %s, where the verb is not a dose of it', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });
});

// ─── RV-R2 round 1: a nutrient named as a result, or by her own clinician ───

describe('a nutrient named as a lab result or recommended by her clinician still passes (RV-R2)', () => {
  it.each([
    // the time of day names the draw, or a level or value follows the nutrient
    'Your vitamin D was 25 ng/mL in the morning draw.',
    'Your zinc and selenium in the evening sample were in range.',
    'Your iron was low in the morning sample.',
    'Your iron in the morning draw was 45 µg/dL.',
    'Iron is highest in the morning, so the time of your draw matters.',
    'Iron naturally peaks in the morning, so a later draw can read lower.',
    'Zinc is usually lower in the evening.',
    // a lab verb before the nutrient
    'Retest iron in the morning after an overnight fast for a cleaner comparison.',
    'Recheck vitamin D in the morning at your next visit.',
    // the body making it, or a result the timing affects
    'Your body makes vitamin D from sunlight in the morning.',
    'Thyroid medication in the morning can affect your TSH result.',
    // her own clinician: an adverb, a relative clause, "to", or "they"
    'Ask your doctor to advise on iron.',
    'Discuss with your doctor, who may recommend iron.',
    'Your doctor will likely recommend iron.',
    'Your doctor, who knows your history, may recommend iron.',
    'If your doctor agrees, they may recommend iron.',
    // a recheck recommended for a nutrient
    'We recommend that your iron be rechecked in three months.',
  ])('passes %s', (text) => {
    expect(findTextViolations(text)).toEqual([]);
  });

  it.each([
    ['A low dose at night may help you sleep.', 'dosing_frequency:at night'],
    ['Your dose is lower in the morning.', 'dosing_frequency:in the morning'],
    ['Check your dose in the morning.', 'dosing_frequency:in the morning'],
    ['We will likely recommend iron.', 'prescriptive_verb:recommend iron'],
    ['Your doctor is away, so we recommend iron for now.', 'prescriptive_verb:recommend iron'],
    ['Experts, who know the research, recommend magnesium for sleep.', 'prescriptive_verb:recommend magnesium'],
  ])('still flags %s: a dosage form is no lab result, and only her clinician is exempt', (text, violation) => {
    expect(findTextViolations(text)).toContain(violation);
  });
});

// ─── RV-R2 round 1: realistic interpretation sentences ───────────────────────
// Synthetic sentences shaped like the fields generate-interpretation and
// lab-insights return, each naming a nutrient next to a time of day or after a
// recommending verb. In a scalar field (key_findings[].explanation,
// overall_interpretation, a lab-insights summary) one false positive sends the
// report to the deterministic fallback, or lab-insights to its 502.

const REALISTIC_SENTENCES: Record<string, string[]> = {
  'findings and summaries (scalar)': [
    "Your vitamin D was 25 ng/mL in the morning draw, below the lab's reference range of 30-100 ng/mL.",
    'Serum iron came back at 48 µg/dL; iron is usually higher in the morning, so draw time can shift this value.',
    'Your ferritin was 14 ng/mL, and your iron was low in the morning sample as well.',
    'Iron naturally peaks in the morning, so a later draw can read lower than your usual level.',
    "Your zinc and selenium in the evening sample were within the lab's range.",
    'Your B12 was in range in the morning draw at 480 pg/mL.',
    "Folate was 12 ng/mL in the morning sample, within the lab's reference range.",
    'Your magnesium came back at 1.9 mg/dL in the afternoon draw.',
    'Iron is highest in the morning, so the time of your draw matters when comparing reports.',
    "Your iron was 38 µg/dL in the morning, below the lab's range.",
    'Zinc tends to run lower in the afternoon, so an afternoon draw can look lower than a morning one.',
    'Your iron in the morning draw was 45 µg/dL, up from 31 µg/dL last time.',
    'Your body makes vitamin D from sunlight in the morning and at midday, which is one reason levels dip in winter.',
    'Thyroid medication in the morning can affect your TSH result, so note when you took it relative to the draw.',
    'Your doctor will likely recommend iron studies before deciding on any next step.',
    'Your doctor may recommend iron if your ferritin stays low on the next panel.',
    'Discuss these results with your doctor, who may recommend iron or further testing.',
    'Your doctor, who knows your history, may recommend iron or a recheck.',
    'If your doctor agrees, they may recommend iron after a repeat ferritin.',
    'Restless legs at night can be a sign of low iron, which fits your ferritin result.',
    'Low magnesium is linked to cramps at night, and your magnesium is within range.',
    'Your vitamin D sample was taken in the morning, so it compares cleanly with March.',
  ],
  'next steps (list)': [
    'Retest iron in the morning after an overnight fast for a cleaner comparison.',
    'Recheck vitamin D in the morning at your next visit so the draws match.',
    'Ask whether your next iron panel can be drawn in the morning.',
    'Discuss whether retesting iron in the morning makes sense.',
    'Consider retesting iron in the morning, fasting, to compare like with like.',
    'Ask your provider whether your iron should be rechecked in the morning.',
    'We recommend that your vitamin D be rechecked in about three months.',
    'We suggest your iron be retested in the morning to compare like with like.',
    'Ask your doctor to advise on iron before making any changes.',
    'Talk with your provider, who can recommend iron if it fits your history.',
  ],
  'questions for her doctor (list)': [
    'Should my iron be rechecked in the morning, when it tends to run higher?',
    'Could my thyroid medication in the morning be affecting my TSH result?',
    'Would you recommend iron for me, given my ferritin?',
    'Is my vitamin D low enough that you would recommend a supplement?',
    'Would a morning draw give a truer picture of my iron?',
  ],
  'lab-insights summary (scalar)': [
    'Your ferritin rose from 12 to 28 ng/mL between reports, and both draws were in the morning.',
    'Serum iron fell from 95 to 60 µg/dL; iron is usually higher in the morning, and this draw was in the afternoon.',
    'Iron is usually higher in the morning, so a different draw time could explain part of this change.',
    'Your zinc was lower in the afternoon draw than in the morning draw last time.',
    'Your vitamin D came back higher in the morning sample than in your last afternoon draw.',
  ],
  'lab-insights factors and next steps (list)': [
    'Draw time: iron is usually higher in the morning.',
    'Iron peaks in the morning, so an afternoon draw can read lower.',
    'Thyroid medication in the morning can affect your TSH result.',
    'Fasting status and draw time, since iron is highest in the morning.',
    'Ask your provider whether your next iron draw should be in the morning.',
    'Your provider may also want to recommend iron after reviewing your symptoms.',
  ],
};

describe('realistic interpretation sentences with a time of day or a recommending verb pass (RV-R2)', () => {
  it.each(
    Object.entries(REALISTIC_SENTENCES).flatMap(([field, texts]) => texts.map((text) => [field, text])),
  )('%s: %s', (_field, text) => {
    expect(findTextViolations(text)).toEqual([]);
  });
});
