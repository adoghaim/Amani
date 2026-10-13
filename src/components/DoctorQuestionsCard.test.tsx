import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BiomarkerName } from '../types';
import { DoctorQuestionsCard } from './DoctorQuestionsCard';
import { getAllEntries } from '../lib/biomarkers/dictionary';
import { buildInsightSummary } from '../lib/insights/buildInsightSummary';
import { formatInterval } from '../lib/scoring/amaniContext';
import {
  DISCUSSION_PREP, DISCUSSION_PREP_HEADING, DISCUSSION_PREP_INTRO, isIssuedDiscussionPrompt, labIntervalObservation,
  LANGUAGE_AUTHORITY, nameInSentence, type DiscussionPremise, type DiscussionPrepPrompt,
} from '../lib/scoring/insightCopy';

/*
  V2-03b Stage 2, owner R2 — the logic half of the dual proof for discussion
  preparation. The page halves are src/pages/ReportView.language.test.tsx and
  e2e/reports/clinical-language-policy.spec.ts.
*/

const text = (html: string) => html.replace(/<[^>]+>/g, ' ');

// The owner's three examples, and the concepts behind them: presumed direction
// of health, treatment, danger, urgency, a need for care, and judgement.
const OWNER_EXAMPLES = ['Why is my thyroid getting worse?', 'Should I start treatment?', 'Why is this dangerous?'];
const PREP_FORBIDDEN = /worse|worsen|getting (?:better|worse)|treat|medication|start|stop|danger|urgent|emergency|seek|need(?:s)? (?:medical )?care|should|improv|better|optimal|normal|abnormal|concern|elevated|deficien|\blow\b|\bhigh\b|healthy|risk|monitor|recheck|retest/i;
const ADMISSIBLE_PREMISES = ['measured_value', 'measured_change', 'patient_lab_interval', 'reviewed_interpretation', 'patient_context'];

type Input = Parameters<typeof buildInsightSummary>[0][number];
const marker = (key: BiomarkerName, value: number, min: number | null, max: number | null, reportDate?: string): Input =>
  ({ key, value, unit: 'u', labRefMin: min, labRefMax: max, reportDate });

/** Every catalog analyte, below / within / above a synthetic lab interval, with and without a prior. */
function sweep(): { prompts: DiscussionPrepPrompt[]; reports: number } {
  const prompts: DiscussionPrepPrompt[] = [];
  let reports = 0;
  for (const e of getAllEntries()) {
    for (const value of [5, 15, 25]) {
      for (const prior of [null, 5, 15, 25, 60]) {
        const current = [marker(e.key, value, 10, 20)];
        const previous = prior === null ? null : [marker(e.key, prior, 10, 20, '2025-12-01')];
        prompts.push(...buildInsightSummary(current, previous, null, previous ? '2025-12-01' : null).questionsForDoctor);
        reports++;
      }
    }
  }
  // Several systems at once, so the cluster question is exercised too.
  const all = getAllEntries().map(e => marker(e.key, 25, 10, 20));
  prompts.push(...buildInsightSummary(all, null, null, null).questionsForDoctor);
  return { prompts, reports: reports + 1 };
}

describe('DISCUSSION_PREP_PROMPT is its own authority category', () => {
  it('maps to DISCUSSION_PREP_PROMPT, carries no recommendation or safety authority, and only a neutral cue', () => {
    expect(LANGUAGE_AUTHORITY.discussion_prep).toBe('DISCUSSION_PREP_PROMPT');
    const prompt = DISCUSSION_PREP.change('TSH', 6, 9, 'uIU/mL');
    expect(prompt).toMatchObject({ category: 'discussion_prep', cue: 'neutral',
      authority: { kind: 'discussion_prep', recommendationAuthority: 'none', safetyAuthority: 'none' } });
  });

  it('the builder: every prompt over the whole catalog rests only on admissible premises and presumes nothing', () => {
    const { prompts, reports } = sweep();
    expect(reports).toBeGreaterThan(1000);
    const kinds = new Set(prompts.flatMap(p => p.authority.premises.map(q => q.kind)));
    // Coverage: each producing premise kind and each template was actually reached.
    expect([...kinds].sort()).toEqual(['measured_change', 'patient_lab_interval']);
    for (const template of [/^My .+ changed from/, /reference interval of/, /relate to each other/, /^Is there anything about my routine/]) {
      expect(prompts.some(p => template.test(p.text)), String(template)).toBe(true);
    }
    for (const p of prompts) {
      expect(isIssuedDiscussionPrompt(p)).toBe(true);
      expect(p.cue).toBe('neutral');
      for (const premise of p.authority.premises) expect(ADMISSIBLE_PREMISES).toContain(premise.kind);
      expect(p.text, p.text).not.toMatch(PREP_FORBIDDEN);
      expect(p.text).not.toMatch(/Amani|band|comparison/i);
    }
  });

  it('negative control: the vocabulary sees each owner example and the old band premise', () => {
    for (const example of [...OWNER_EXAMPLES, 'Do I need medical care for this?',
      "My TSH is 9 uIU/mL, outside Amani's comparison band, which has not yet completed clinical review."]) {
      expect(example).toMatch(/Amani|band/i.test(example) ? /Amani|band/i : PREP_FORBIDDEN);
    }
  });

  it('a value within her lab interval, or with no interval, gives no interval premise', () => {
    expect(DISCUSSION_PREP.labInterval('TSH', 4.5, 'uIU/mL', 0.45, 4.5)).toBeNull();
    expect(DISCUSSION_PREP.labInterval('TSH', 9, 'uIU/mL', null, null)).toBeNull();
    expect(DISCUSSION_PREP.labInterval('TSH', 4.51, 'uIU/mL', 0.45, 4.5)?.text)
      .toBe("My TSH is 4.51 uIU/mL, above my lab's reference interval of 0.45–4.5 uIU/mL. What does this mean in the context of my overall labs?");
  });
});

describe('standing rule 5 — a question states its premise exactly as the rest of the product states the same fact', () => {
  it('lab-interval premises agree with the card\'s lab placement and printed interval; change premises restate the measured values', () => {
    const { prompts } = sweep();
    let intervals = 0;
    let changes = 0;
    for (const p of prompts) {
      for (const premise of p.authority.premises) {
        if (premise.kind === 'patient_lab_interval') {
          intervals++;
          // The biomarker card's own placement statement for the same value and interval.
          const card = labIntervalObservation(premise.subject, premise.value, premise.min, premise.max);
          expect(card?.text.toLowerCase()).toBe(`${premise.placement} your lab's range`);
          if (p.authority.premises.length === 1) {
            expect(p.text).toContain(`${premise.placement} my lab's reference interval of ${formatInterval(premise.min, premise.max)} ${premise.unit}`);
            expect(p.text).toContain(`is ${premise.value} ${premise.unit}`);
          }
        }
        if (premise.kind === 'measured_change') {
          changes++;
          expect(p.text).toContain(`from ${premise.previous} to ${premise.current} ${premise.unit}`);
        }
      }
    }
    expect(intervals).toBeGreaterThan(100);
    expect(changes).toBeGreaterThan(100);
  });

  it('negative control: a question whose placement disagrees with its premise is caught', () => {
    const prompt = DISCUSSION_PREP.labInterval('TSH', 9, 'uIU/mL', 0.45, 4.5)!;
    const premise = prompt.authority.premises[0]!;
    const contradicted = prompt.text.replace('above', 'below');
    expect(premise.kind === 'patient_lab_interval' && contradicted.includes(`${premise.placement} my lab's`)).toBe(false);
  });
});

describe('the card renders only policy-issued prompts, and its presence is preparation, not escalation', () => {
  const issued = DISCUSSION_PREP.change('TSH', 6, 9, 'uIU/mL');

  it('a hand-written, forged, copied-and-reworded or deserialized question is dropped whole', () => {
    const forged = OWNER_EXAMPLES.map(t => ({ ...issued, text: t }));
    const deserialized = JSON.parse(JSON.stringify(issued)) as DiscussionPrepPrompt;
    const handWritten = { category: 'discussion_prep', text: 'My ferritin is low at 10 ng/mL. What does this mean?', cue: 'neutral',
      authority: { kind: 'discussion_prep', premises: [], recommendationAuthority: 'none', safetyAuthority: 'none' } } as DiscussionPrepPrompt;
    const html = renderToStaticMarkup(<DoctorQuestionsCard questions={[...forged, deserialized, handWritten, issued]} />);
    expect(text(html)).toContain(issued.text);
    for (const t of [...OWNER_EXAMPLES, 'My ferritin is low']) expect(text(html)).not.toContain(t);
    expect(html.split('data-language-category="discussion_prep"').length - 1).toBe(1);
    expect(renderToStaticMarkup(<DoctorQuestionsCard questions={[...forged, deserialized, handWritten]} />)).toBe('');
  });

  it('states what it is, carries no alert, warning cue or danger colour, and each prompt carries its authority', () => {
    const html = renderToStaticMarkup(<DoctorQuestionsCard questions={[issued, DISCUSSION_PREP.context()]} />);
    expect(text(html)).toContain(DISCUSSION_PREP_HEADING);
    expect(text(html)).toContain(DISCUSSION_PREP_INTRO);
    expect(html).not.toMatch(/role="alert"|data-language-cue="(?:warning|critical)"|flag-(?:ok|watch|low)/);
    expect(html).toContain('data-premises="measured_change"');
    expect(html).toContain('data-language-source="discussion_prep"');
    expect(text(html)).not.toMatch(PREP_FORBIDDEN);
  });

  it('the card appears on a report with nothing outside any interval and no prior: presence is not a finding', () => {
    const summary = buildInsightSummary([marker('tsh', 2, 0.45, 4.5), marker('ferritin', 50, 15, 150)], null, null, null);
    expect(summary.questionsForDoctor.map(q => q.text)).toEqual([DISCUSSION_PREP.context().text]);
    expect(summary.questionsForDoctor[0]!.authority.premises).toEqual([]);
  });

  it('an Amani band crossing with no lab-interval change and a minor magnitude selects no question about it', () => {
    // TSH 2.7 -> 2.0: inside her lab interval both times. The old builder asked
    // about it because it crossed an unreviewed Amani band.
    const tsh = (value: number, reportDate?: string) => marker('tsh', value, 0.45, 4.5, reportDate);
    const summary = buildInsightSummary([tsh(2.0)], [tsh(2.7, '2025-12-01')], null, '2025-12-01');
    const delta = summary.deltaMap.get('tsh');
    expect(delta?.boundaryCrossing).not.toBeNull();
    for (const q of summary.questionsForDoctor) {
      const change = q.authority.premises.find(p => p.kind === 'measured_change');
      // Present only when the deterministic magnitude calls it more than minor.
      if (change) expect(delta?.significance).not.toBe('minor');
      expect(q.text).not.toMatch(/band|Amani/);
    }
  });
});

/*
  PK-FIX-02 (campaign 06-video d/e): the questions are read aloud to a
  clinician, so a catalog display name in title case ("Ferritin", "Fasting
  Insulin") reads in sentence case mid-sentence, and the intro uses the US
  spelling. Acronyms and mixed-case abbreviations keep their letters.
*/
// Capitalised ordinary words after the first word of each sentence.
const midSentenceCapitals = (text: string): string[] => text.split(/(?<=[.?])\s+/)
  .flatMap(sentence => sentence.split(/[\s(/),.?%-]+/).filter(Boolean).slice(1))
  .filter(word => /^[A-Z][a-z]{2,}$/.test(word));

describe('PK-FIX-02 — question wording: sentence-case marker names, US spelling', () => {
  it('each template writes the name in sentence case; the premise keeps the display name', () => {
    const change = DISCUSSION_PREP.change('Ferritin', 41, 18, 'ng/mL');
    expect(change.text).toBe('My ferritin changed from 41 to 18 ng/mL. What could explain this change, and is it clinically meaningful?');
    expect(change.authority.premises).toEqual([{ kind: 'measured_change', subject: 'Ferritin', previous: 41, current: 18, unit: 'ng/mL' }]);
    const interval = DISCUSSION_PREP.labInterval('Free T4', 2.1, 'ng/dL', 0.8, 1.8)!;
    expect(interval.text).toBe(
      "My free T4 is 2.1 ng/dL, above my lab's reference interval of 0.8–1.8 ng/dL. What does this mean in the context of my overall labs?");
    expect(interval.authority.premises[0]).toMatchObject({ kind: 'patient_lab_interval', subject: 'Free T4' });
    const premises = ['Fasting Insulin', 'HbA1c'].map(subject => DISCUSSION_PREP.labInterval(subject, 30, 'u', 1, 20)!.authority.premises[0]!)
      .filter((p): p is Extract<DiscussionPremise, { kind: 'patient_lab_interval' }> => p.kind === 'patient_lab_interval');
    expect(DISCUSSION_PREP.relate(premises)?.text)
      .toBe('Could you help me understand how my fasting insulin and HbA1c results relate to each other?');
    // Acronyms are untouched, so the e2e-pinned TSH wording is unchanged.
    expect(DISCUSSION_PREP.change('TSH', 6, 9, 'uIU/mL').text)
      .toBe('My TSH changed from 6 to 9 uIU/mL. What could explain this change, and is it clinically meaningful?');
  });

  it('nameInSentence lowercases ordinary words only, at every boundary the catalog uses', () => {
    for (const [name, expected] of [
      ['Ferritin', 'ferritin'], ['Fasting Insulin', 'fasting insulin'], ['Free T4', 'free T4'],
      ['Estradiol (E2)', 'estradiol (E2)'], ['TPO Antibodies', 'TPO antibodies'], ['Free T4 Index (T7)', 'free T4 index (T7)'],
      ['C-Peptide', 'C-peptide'], ['Non-HDL Cholesterol', 'non-HDL cholesterol'], ['BUN/Creatinine Ratio', 'BUN/creatinine ratio'],
      ['Chol/HDL Ratio', 'chol/HDL ratio'], ['A/G Ratio', 'A/G ratio'], ['Neutrophils (Absolute)', 'neutrophils (absolute)'],
      ['Neutrophils %', 'neutrophils %'], ['ANA Screen, IFA', 'ANA screen, IFA'], ['Vitamin B12', 'vitamin B12'],
      // Kept exactly: acronyms, mixed-case and two-letter abbreviations.
      ['TSH', 'TSH'], ['HbA1c', 'HbA1c'], ['ApoB', 'ApoB'], ['TgAb', 'TgAb'], ['Lp(a)', 'Lp(a)'], ['eGFR', 'eGFR'],
      ['hs-CRP', 'hs-CRP'], ['DHEA-S', 'DHEA-S'], ['CO2', 'CO2'],
      // Not a catalog name: an eponym written with a non-ASCII letter keeps its capital.
      ['Anti-Müllerian Hormone', 'anti-Müllerian hormone'],
    ] as const) {
      expect(nameInSentence(name), name).toBe(expected);
    }
  });

  it('every catalog display name changes in case only, and only for ordinary capitalised words', () => {
    const entries = getAllEntries();
    expect(entries.length).toBeGreaterThan(80);
    for (const { displayName } of entries) {
      const sentence = nameInSentence(displayName);
      expect(sentence.toLowerCase(), displayName).toBe(displayName.toLowerCase());
      const before = displayName.split(/([\s(/),%-]+)/);
      const after = sentence.split(/([\s(/),%-]+)/);
      expect(after.length, displayName).toBe(before.length);
      before.forEach((token, i) => {
        expect(after[i], `${displayName}: ${token}`).toBe(/^[A-Z][a-z]{2,}$/.test(token) ? token.toLowerCase() : token);
      });
    }
  });

  it('the whole-catalog sweep: no question carries a capitalised ordinary word mid-sentence', () => {
    const { prompts } = sweep();
    expect(prompts.length).toBeGreaterThan(1000);
    for (const p of prompts) expect(midSentenceCapitals(p.text), p.text).toEqual([]);
    // Negative control: the check sees the defect the campaign found.
    expect(midSentenceCapitals('My Ferritin changed from 41 to 18 ng/mL. What could explain this change, and is it clinically meaningful?'))
      .toEqual(['Ferritin']);
    expect(midSentenceCapitals('Could you help me understand how my Fasting Insulin and HbA1c results relate to each other?'))
      .toEqual(['Fasting', 'Insulin']);
  });

  it('the intro uses the US spelling "judgment", on the rendered card too', () => {
    expect(DISCUSSION_PREP_INTRO).toContain('They are preparation only, not a judgment about your results.');
    expect(DISCUSSION_PREP_INTRO).not.toMatch(/judgement/i);
    const html = renderToStaticMarkup(<DoctorQuestionsCard questions={[DISCUSSION_PREP.context()]} />);
    expect(text(html)).toContain('not a judgment about your results.');
    expect(text(html)).not.toMatch(/judgement/i);
  });
});
