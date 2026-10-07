import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InsightsModal } from './InsightsModal';

/*
  V2-03b Stage 2. The Tracker's insights modal renders lab-insights model
  output. Its model-written doctor questions (owner R2) and general next steps
  (owner R4) no longer render. The rest of the modal is model prose deferred to
  R1; this test pins only the two suppressions.
*/
const insights = {
  summary: 'Synthetic summary.',
  notable_changes: [],
  questions_to_ask: ['Why is my thyroid getting worse?', 'Should I start treatment?', 'Why is this dangerous?'],
  next_steps_general: ['Take 2000 IU of vitamin D daily.', 'Eat more iron-rich foods.', 'Walk 30 minutes a day.'],
};

describe('InsightsModal does not render model questions or model next steps', () => {
  it('neither list, nor its heading, reaches the page', () => {
    const html = renderToStaticMarkup(<InsightsModal isOpen onClose={() => {}} insights={insights} />);
    expect(html).toContain('Synthetic summary.');
    for (const text of [...insights.questions_to_ask, ...insights.next_steps_general, 'Questions for your provider', 'General next steps']) {
      expect(html).not.toContain(text);
    }
  });
});
