import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FocusAreas } from './FocusAreas';

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

// The discussion-preparation card (owner R2) is proven in DoctorQuestionsCard.test.tsx.
