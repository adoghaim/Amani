// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalmNotice } from '../../../components/CalmNotice';
import { axeViolations } from '../../../components/axe.testkit';
import type { LabReport } from '../../../types';
import { REPORT_NOTICES, shownExplanationOf, UNIDENTIFIED_EXPLANATION, type ReportNotice, type ReportNoticeProps, type ReportVersions } from './index';
import { ReportNotices } from './ReportNotices';

/*
  PK-INT-01 additions (R22): the notices slot above the explanation. An ordered
  list of components, each given the report and its versions, each rendering a
  CalmNotice or nothing. With nothing to say, the slot adds nothing to the page.
*/

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

const report = { id: 'report-1' } as unknown as LabReport;
const versions: ReportVersions = { shown: { id: 'version-1', generatedAt: '2026-10-01T00:00:00.000Z' } };
const seen: Array<{ id: string; props: ReportNoticeProps }> = [];
const notice = (id: string, show: (props: ReportNoticeProps) => boolean): ReportNotice => ({
  id,
  Component: props => {
    seen.push({ id, props });
    return show(props) ? <CalmNotice title={`Placeholder ${id}`} /> : null;
  },
});
async function render(notices?: readonly ReportNotice[], v: ReportVersions = versions) {
  seen.length = 0;
  await act(async () => root.render(<ReportNotices report={report} versions={v} notices={notices} />));
}
const titles = () => Array.from(app.querySelectorAll('[role="status"]')).map(n => n.querySelector('p')!.textContent);

describe('report notices slot (R22)', () => {
  it('ships only the DT9 pause notice, and with nothing to say the page is exactly as it was', async () => {
    expect(REPORT_NOTICES.map(n => n.id)).toEqual(['ai-paused']);
    await render();
    expect(app.innerHTML).toBe('');
    await render(undefined, { shown: null });
    expect(app.innerHTML).toBe('');
  });

  it('renders each notice in list order, each given the report and its versions', async () => {
    await render([notice('first', () => true), notice('second', () => true)]);
    expect(titles()).toEqual(['Placeholder first', 'Placeholder second']);
    expect(seen.map(s => s.id)).toEqual(['first', 'second']);
    for (const { props } of seen) {
      expect(props.report).toBe(report);
      expect(props.versions).toBe(versions);
    }
    for (const status of app.querySelectorAll('[role="status"]')) expect(status.getAttribute('aria-live')).toBe('polite');
    expect(await axeViolations(app)).toEqual([]);
  });

  it('a notice that does not apply renders nothing, and the slot adds no element of its own', async () => {
    await render([notice('quiet', () => false), notice('shown', () => true), notice('quiet-too', () => false)]);
    expect(titles()).toEqual(['Placeholder shown']);
    expect(app.children).toHaveLength(1);
    await render([notice('quiet', () => false)]);
    expect(app.innerHTML).toBe('');
  });

  it('a notice can decide from the versions it is given', async () => {
    const stale = notice('needs-identity', ({ versions: v }) => v.shown !== null && v.shown.id === null);
    await render([stale], { shown: UNIDENTIFIED_EXPLANATION });
    expect(titles()).toEqual(['Placeholder needs-identity']);
    await render([stale], { shown: null });
    expect(titles()).toEqual([]);
  });

  it('reads an explanation identity only from string fields', () => {
    expect(shownExplanationOf({ id: 'row-1', generated_at: '2026-10-01T00:00:00.000Z' }))
      .toEqual({ id: 'row-1', generatedAt: '2026-10-01T00:00:00.000Z' });
    expect(shownExplanationOf({ id: 7, generated_at: null })).toEqual({ id: null, generatedAt: null });
    expect(shownExplanationOf({})).toEqual(UNIDENTIFIED_EXPLANATION);
    expect(Object.isFrozen(UNIDENTIFIED_EXPLANATION)).toBe(true);
  });
});
