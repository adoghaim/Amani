import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UploadIntroStep } from './UploadIntroStep';
import { WelcomeStep } from './WelcomeStep';

/*
  PK-FIX-02 (campaign 03-emails c): onboarding promised "better questions" and
  to "show what may need attention". Both evaluate her results. The questions
  Amani builds are preparation for a conversation with a clinician, so the
  copy says that and nothing stronger.
*/
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
// Evaluative or escalating words the report page also refuses.
const EVALUATIVE = /better|worse|improv|attention|concern|worr|\bnormal\b|optimal|healthy|should|recommend|\brisk\b|urgent|talk to your doctor/i;

describe('onboarding copy is consultative (PK-FIX-02)', () => {
  it('the welcome step prepares questions for a clinician, not "better questions"', () => {
    const out = text(renderToStaticMarkup(<WelcomeStep onNext={() => {}} />));
    expect(out).toContain('Amani helps you understand your lab results in plain language, track changes over time, '
      + 'and prepare questions you could bring to your clinician.');
    expect(out).not.toMatch(EVALUATIVE);
  });

  it('the upload intro says what Amani does with the report, not what "may need attention"', () => {
    const out = text(renderToStaticMarkup(<UploadIntroStep onUpload={() => {}} onSkip={() => {}} isSubmitting={false} />));
    expect(out).toContain('Amani will extract the markers, explain what they mean, and prepare questions you could bring to your clinician.');
    expect(out).not.toMatch(EVALUATIVE);
  });

  it('negative control: the check sees the wording it replaced', () => {
    for (const old of ['and prepare better questions for your doctor.', 'and show what may need attention.']) {
      expect(old).toMatch(EVALUATIVE);
    }
  });
});
