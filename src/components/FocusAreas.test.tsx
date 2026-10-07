import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FocusAreas } from './FocusAreas';
import { DoctorQuestionsCard } from './DoctorQuestionsCard';
import { type AuthorizedLanguage } from '../lib/scoring/insightCopy';
import { buildInsightSummary } from '../lib/insights/buildInsightSummary';
import { bandLanguageByKey } from '../lib/scoring/compareReports';

// V2-03 amendment 3. Every whyItMatters string the out-of-scope builder can
// produce, read from its source so a new rule is covered without editing this.
function builderStrings(): string[] {
  const file = 'src/lib/insights/buildFocusAreas.ts';
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.includes(' ')) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ');

/*
  V2-03b Stage 2 replaces "the builder source still carries the claim the card
  must qualify". The builder no longer authors a sentence: it composes policy
  output. So the stronger statement holds and is checked here, together with
  a negative control showing the check sees the old rule copy.
*/
const CLAIM_WORDS = /optimal|borderline|elevated|reference range|autoimmun|risk|insulin sensitivity|reassur|worth|should|is low|is high/i;

describe('FocusAreas renders only policy language from the builder', () => {
  const strings = builderStrings();

  it('the builder source authors no clinical sentence', () => {
    expect(strings.filter(s => CLAIM_WORDS.test(s))).toEqual([]);
  });

  it('negative control: the check sees the rule copy it replaced', () => {
    for (const old of [
      'Thyroid antibodies are elevated, suggesting an autoimmune component worth tracking alongside thyroid function markers.',
      'One or more lipid markers are outside their reference range. Tracking these together helps frame cardiovascular risk over time.',
      'is borderline-high',
    ]) expect(old).toMatch(CLAIM_WORDS);
  });

  it.each(strings)('%s', whyItMatters => {
    const html = renderToStaticMarkup(
      <FocusAreas focusAreas={[{ id: 'x', title: 'Area', whyItMatters, relatedMarkers: [], isPrimaryAligned: false }]} />,
    );
    expect(html).toContain(whyItMatters.replace(/'/g, '&#x27;'));
  });

  it('a chip is the neutral attention cue, never red, amber or green', () => {
    const html = renderToStaticMarkup(<FocusAreas focusAreas={[{ id: 'x', title: 'Area', whyItMatters: 'w',
      relatedMarkers: [{ slug: 'tsh', displayName: 'TSH', status: 'outside' }], isPrimaryAligned: false }]} />);
    expect(html).toContain('data-language-cue="attention"');
    expect(html).not.toMatch(/flag-(?:ok|watch|low)/);
  });
});

describe('DoctorQuestionsCard drops a question that asserts optimality', () => {
  it('renders the other questions and not the optimality one', () => {
    const html = renderToStaticMarkup(<DoctorQuestionsCard questions={[
      { text: 'My TSH is outside the optimal range at 2 uIU/mL. What does this mean?', relatedBiomarker: 'tsh' },
      { text: 'My ferritin is low at 10 ng/mL. What does this mean?', relatedBiomarker: 'ferritin' },
    ]} />);
    expect(text(html)).not.toMatch(/optimal/i);
    expect(html).toContain('My ferritin is low at 10 ng/mL.');
  });

  it('renders nothing when every question asserted optimality', () => {
    expect(renderToStaticMarkup(<DoctorQuestionsCard questions={[
      { text: 'Is my TSH Optimal?', relatedBiomarker: 'tsh' },
    ]} />)).toBe('');
  });
});

// V2-03 amendment 4 (R1). Found by spec 9's page-wide /improv/i: the
// out-of-scope builder's crossing question said "My TSH improved from
// borderline to within band" about an UNKNOWN band.
describe('DoctorQuestionsCard drops a question that calls an unauthorized movement "improved"', () => {
  const tsh = (value: number, reportDate?: string) => ({ key: 'tsh' as const, value, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5, reportDate });
  const summary = buildInsightSummary([tsh(2.0)], [tsh(2.7, '2025-12-01')], null, '2025-12-01');
  const improvedQuestion = { text: 'My TSH improved from borderline to within band. Is this change clinically meaningful?', relatedBiomarker: 'tsh' as const };

  /*
    V2-03b Stage 2 replaces "the builder still emits the claim, so the card is
    load-bearing". The builder now words every question through the policy,
    so the crossing question states values; the card filter is still proven
    on the old question text below.
  */
  it('the builder words the crossing question by value, with no judgement', () => {
    expect(summary.questionsForDoctor[0]?.text).toBe('My TSH changed from 2.7 to 2 uIU/mL. Is this change clinically meaningful?');
    for (const q of summary.questionsForDoctor) {
      expect(q.text).not.toMatch(/improv|better|worse|elevated|stable|monitor|should|optimal/i);
    }
  });

  it('with the real band language, and with none, a favourable question is not rendered', () => {
    for (const bandLanguage of [bandLanguageByKey(summary.deltaMap.values()), undefined]) {
      const html = renderToStaticMarkup(<DoctorQuestionsCard questions={[...summary.questionsForDoctor, improvedQuestion]} bandLanguage={bandLanguage} />);
      expect(text(html)).not.toMatch(/improv/i);
      expect(text(html)).toContain('My TSH changed from 2.7 to 2 uIU/mL.');
    }
  });

  it('only a band authorizing a favourable direction would let it through', () => {
    const authorized: AuthorizedLanguage = { reviewStatus: 'SAFE', reviewedWording: true, optimal: false, favourableDirection: true };
    const html = renderToStaticMarkup(<DoctorQuestionsCard questions={[improvedQuestion]} bandLanguage={new Map([['tsh', authorized]])} />);
    expect(text(html)).toContain('My TSH improved from borderline to within band.');
  });
});
