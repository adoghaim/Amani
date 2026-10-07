import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FocusAreas } from './FocusAreas';
import { DoctorQuestionsCard } from './DoctorQuestionsCard';
import { FOCUS_AREA_BAND_SENTENCE } from '../lib/scoring/insightCopy';

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
