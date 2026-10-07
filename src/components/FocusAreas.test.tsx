import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FocusAreas } from './FocusAreas';
import { DoctorQuestionsCard } from './DoctorQuestionsCard';
import { FOCUS_AREA_BAND_SENTENCE, type AuthorizedLanguage } from '../lib/scoring/insightCopy';
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

describe('FocusAreas renders no "optimal" claim from src/lib/insights copy', () => {
  const strings = builderStrings();

  it('the builder source still carries the claim the card must qualify', () => {
    expect(strings.filter(s => /optimal/i.test(s)).length).toBeGreaterThan(0);
  });

  it.each(strings)('%s', whyItMatters => {
    const html = renderToStaticMarkup(
      <FocusAreas focusAreas={[{ id: 'x', title: 'Area', whyItMatters, relatedMarkers: [], isPrimaryAligned: false }]} />,
    );
    expect(text(html)).not.toMatch(/optimal/i);
    if (/optimal/i.test(whyItMatters)) expect(html).toContain(FOCUS_AREA_BAND_SENTENCE.replace("'", '&#x27;'));
    else expect(html).toContain(whyItMatters.replace(/'/g, '&#x27;'));
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
  const improvedQuestion = summary.questionsForDoctor.find(q => /improv/i.test(q.text));

  it('the builder still emits the claim, so the card is load-bearing', () => {
    expect(improvedQuestion?.text).toBe('My TSH improved from borderline to within band. Is this change clinically meaningful?');
  });

  it('with the real band language, and with none, the question is not rendered', () => {
    for (const bandLanguage of [bandLanguageByKey(summary.deltaMap.values()), undefined]) {
      const html = renderToStaticMarkup(<DoctorQuestionsCard questions={summary.questionsForDoctor} bandLanguage={bandLanguage} />);
      expect(text(html)).not.toMatch(/improv/i);
    }
  });

  it('only a band authorizing a favourable direction would let it through', () => {
    const authorized: AuthorizedLanguage = { reviewStatus: 'SAFE', reviewedWording: true, optimal: false, favourableDirection: true };
    const html = renderToStaticMarkup(<DoctorQuestionsCard questions={[improvedQuestion!]} bandLanguage={new Map([['tsh', authorized]])} />);
    expect(text(html)).toContain('My TSH improved from borderline to within band.');
  });
});
