// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

import { axeViolations } from '../../../components/axe.testkit';
import { IDENTIFIER_WARNING, WORRIED_HELP_LINES, type InterpretationFeedbackInsert, type ProblemReportPort } from './problemReport';
import { ReportProblemFlow } from './ReportProblemFlow';

/*
  PK-HARM-01 (D20, D23): the "Report a problem" flow. The chooser in D20's
  order; "Something here worried me" shows where to get help before anything
  else; optional text capped at 1,000 characters with the identifier warning;
  every category writes its row; a failed send keeps her text behind a calm
  notice; axe finds nothing on any step.
*/

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no scrolling; the shared Modal's scroll lock restores the position on close.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  app =document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function port(replies: ({ error: string | null })[] = [{ error: null }]) {
  const rows: InterpretationFeedbackInsert[] = [];
  const fake: ProblemReportPort = {
    insert: async row => {
      rows.push(row);
      return replies[Math.min(rows.length - 1, replies.length - 1)]!;
    },
  };
  return { fake, rows };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const step = () => document.querySelector('[data-report-problem-step]')?.getAttribute('data-report-problem-step');
const buttons = () => Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('button'));
const button = (name: string) => buttons().find(b => b.textContent === name)!;
const choices = () => Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('ul button')).map(b => b.textContent);
const heading = () => dialog()!.querySelector('h3')!;
const textarea = () => dialog()!.querySelector('textarea')!;
const click = async (name: string) => { await act(async () => button(name).click()); };

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea(), value);
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function render(props: Partial<Parameters<typeof ReportProblemFlow>[0]> & { port: ProblemReportPort }) {
  const onClose = vi.fn();
  await act(async () => root.render(
    <ReportProblemFlow open onClose={onClose} reportId="report-1" interpretationId="version-1" {...props} />,
  ));
  return onClose;
}

describe('ReportProblemFlow (D20)', () => {
  it('opens on the chooser: four choices in D20\'s order, each a 44px control; axe is clean', async () => {
    const { fake } = port();
    await render({ port: fake });
    expect(dialog()!.getAttribute('aria-label')).toBe('Report a problem');
    expect(step()).toBe('choose');
    expect(choices()).toEqual([
      'A value is wrong', 'The explanation is confusing or wrong', 'Something here worried me', 'Other',
    ]);
    for (const choice of dialog()!.querySelectorAll('ul button')) expect(choice.className).toContain('min-h-[44px]');
    expect(await axeViolations(dialog()!)).toEqual([]);
  });

  it('"Something here worried me" shows where to get help first, then optional feedback, then flags the report', async () => {
    const { fake, rows } = port();
    await render({ port: fake });
    await click('Something here worried me');
    expect(step()).toBe('help');
    expect(heading().textContent).toBe('Where to get help');
    expect(document.activeElement).toBe(heading());
    const text = dialog()!.textContent!;
    for (const line of WORRIED_HELP_LINES) expect(text).toContain(line);
    // Help comes before any field: nothing to type on this step.
    expect(dialog()!.querySelector('textarea')).toBeNull();
    expect(await axeViolations(dialog()!)).toEqual([]);

    await click('Tell us what happened');
    expect(step()).toBe('details');
    await type('The explanation scared me.');
    await click('Send');
    expect(rows).toEqual([{ report_id: 'report-1', interpretation_version_id: 'version-1', category: 'worried', text: 'The explanation scared me.' }]);
    expect(step()).toBe('sent');
    expect(dialog()!.querySelector('[role="status"]')!.getAttribute('aria-live')).toBe('polite');
    expect(dialog()!.textContent).toContain(WORRIED_HELP_LINES[1]);
  });

  it('the worried path can send without a note', async () => {
    const { fake, rows } = port();
    await render({ port: fake });
    await click('Something here worried me');
    await click('Send without a note');
    expect(rows).toEqual([{ report_id: 'report-1', interpretation_version_id: 'version-1', category: 'worried', text: null }]);
    expect(step()).toBe('sent');
  });

  it.each([
    ['A value is wrong', 'value_wrong'],
    ['The explanation is confusing or wrong', 'explanation'],
    ['Other', 'other'],
  ])('"%s" goes straight to the optional note and writes its row', async (label, category) => {
    const { fake, rows } = port();
    await render({ port: fake });
    await click(label);
    expect(step()).toBe('details');
    expect(heading().textContent).toBe(label);
    expect(document.activeElement).toBe(heading());
    expect(dialog()!.textContent).not.toContain(WORRIED_HELP_LINES[1]);
    await click('Send');
    expect(rows).toEqual([{ report_id: 'report-1', interpretation_version_id: 'version-1', category, text: null }]);
    expect(step()).toBe('sent');
  });

  it('the note has a visible label, the identifier warning and a count, all linked; capped at 1,000; axe is clean', async () => {
    const { fake } = port();
    await render({ port: fake });
    await click('Other');
    const field = textarea();
    const label = dialog()!.querySelector(`label[for="${field.id}"]`)!;
    expect(label.textContent).toBe('Tell us more (optional)');
    expect(field.maxLength).toBe(1000);
    const described = field.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)!.textContent);
    expect(described).toEqual([IDENTIFIER_WARNING, '0 of 1,000 characters']);
    await type('x'.repeat(1000));
    expect(document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[1]!)!.textContent).toBe('1,000 of 1,000 characters');
    expect(button('Send').disabled).toBe(false);
    expect(await axeViolations(dialog()!)).toEqual([]);
  });

  it('a failed send keeps her text and offers Try again in a calm notice', async () => {
    const { fake, rows } = port([{ error: 'offline' }, { error: null }]);
    await render({ port: fake });
    await click('The explanation is confusing or wrong');
    await type('This sentence did not make sense.');
    await click('Send');
    expect(step()).toBe('details');
    const notice = dialog()!.querySelector('[role="status"]')!;
    expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(notice.textContent).toContain("We couldn't send your report.");
    expect(notice.textContent).toContain('What you wrote is still here.');
    expect(textarea().value).toBe('This sentence did not make sense.');
    expect(await axeViolations(dialog()!)).toEqual([]);
    await click('Try again');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.text).toBe('This sentence did not make sense.');
    expect(step()).toBe('sent');
  });

  it('Back returns to where she came from', async () => {
    const { fake } = port();
    await render({ port: fake });
    await click('Other');
    await click('Back');
    expect(step()).toBe('choose');
    await click('Something here worried me');
    await click('Tell us what happened');
    await click('Back');
    expect(step()).toBe('help');
  });

  it('an unknown explanation is reported as null', async () => {
    const { fake, rows } = port();
    await render({ port: fake, interpretationId: null });
    await click('Other');
    await click('Send');
    expect(rows[0]!.interpretation_version_id).toBeNull();
  });

  it('"A value is wrong" continues into the correction screen when PK-CORRECT-01 supplies it, after recording the row', async () => {
    const { fake, rows } = port();
    const onContinueToCorrection = vi.fn();
    const onClose = await render({ port: fake, onContinueToCorrection });
    await click('A value is wrong');
    await click('Send');
    expect(rows).toEqual([expect.objectContaining({ category: 'value_wrong' })]);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onContinueToCorrection).toHaveBeenCalledOnce();
    // Other categories never continue there.
    await act(async () => root.render(<ReportProblemFlow open={false} onClose={onClose} reportId="report-1" interpretationId={null} port={fake} onContinueToCorrection={onContinueToCorrection} />));
    await act(async () => root.render(<ReportProblemFlow open onClose={onClose} reportId="report-1" interpretationId={null} port={fake} onContinueToCorrection={onContinueToCorrection} />));
    await click('Other');
    await click('Send');
    expect(onContinueToCorrection).toHaveBeenCalledOnce();
    expect(step()).toBe('sent');
  });

  it('Done closes; reopening starts again at the chooser', async () => {
    const { fake } = port();
    const onClose = await render({ port: fake });
    await click('Other');
    await click('Send');
    await click('Done');
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.render(<ReportProblemFlow open={false} onClose={onClose} reportId="report-1" interpretationId={null} port={fake} />));
    expect(dialog()).toBeNull();
    await act(async () => root.render(<ReportProblemFlow open onClose={onClose} reportId="report-1" interpretationId={null} port={fake} />));
    expect(step()).toBe('choose');
  });
});
