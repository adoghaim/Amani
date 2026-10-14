// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../components/axe.testkit';
import type { LabReport } from '../../../types';
import { ReportNotices } from './ReportNotices';
import type { ReportNoticeActions, ReportVersions } from './types';

/*
  R19 (PK-CORRECT-01) in the notices slot: "This explanation was written
  before you corrected a value" with Refresh explanation, exactly when the
  newest correction is later than the explanation on screen.
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
const WRITTEN = '2026-10-01T10:00:00.000Z';
async function render(versions: ReportVersions, actions?: ReportNoticeActions) {
  await act(async () => root.render(<ReportNotices report={report} versions={versions} actions={actions} />));
}
const notice = () => app.querySelector('[data-stale-explanation] [role="status"]');

describe('R19: the stale-explanation mark', () => {
  it('appears when a correction is newer than the explanation on screen, with one Refresh explanation action', async () => {
    const onClick = vi.fn();
    await render({ shown: { id: 'v1', generatedAt: WRITTEN }, newestCorrectionAt: '2026-10-01T10:00:01.000Z' },
      { refreshExplanation: { label: 'Refresh explanation', onClick } });
    expect(notice()?.getAttribute('aria-live')).toBe('polite');
    expect(notice()?.querySelector('p')?.textContent).toBe('This explanation was written before you corrected a value');
    expect(notice()?.textContent).toContain('Your corrected value is saved.');
    const buttons = Array.from(app.querySelectorAll('button'));
    expect(buttons.map(b => b.textContent)).toEqual(['Refresh explanation']);
    await act(async () => buttons[0]!.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(await axeViolations(app)).toEqual([]);
  });

  it('is absent with no correction, a correction older than the explanation, or no explanation on screen', async () => {
    await render({ shown: { id: 'v1', generatedAt: WRITTEN } });
    expect(app.innerHTML).toBe('');
    await render({ shown: { id: 'v1', generatedAt: WRITTEN }, newestCorrectionAt: null });
    expect(app.innerHTML).toBe('');
    await render({ shown: { id: 'v1', generatedAt: WRITTEN }, newestCorrectionAt: '2026-10-01T09:00:00.000Z' });
    expect(app.innerHTML).toBe('');
    await render({ shown: null, newestCorrectionAt: '2026-10-02T00:00:00.000Z' });
    expect(app.innerHTML).toBe('');
  });

  it('clears once a refresh writes a newer version', async () => {
    const correction = '2026-10-02T00:00:00.000Z';
    await render({ shown: { id: 'v1', generatedAt: WRITTEN }, newestCorrectionAt: correction });
    expect(notice()).not.toBeNull();
    await render({ shown: { id: 'v2', generatedAt: '2026-10-02T00:00:05.000Z' }, newestCorrectionAt: correction });
    expect(notice()).toBeNull();
  });

  it('marks an explanation whose writing time is unknown, rather than assume it came after', async () => {
    await render({ shown: { id: null, generatedAt: null }, newestCorrectionAt: '2026-10-02T00:00:00.000Z' });
    expect(notice()).not.toBeNull();
  });

  it('says when the last refresh failed, keeps the explanation marked and offers the refresh again', async () => {
    await render({ shown: { id: 'v1', generatedAt: WRITTEN }, newestCorrectionAt: '2026-10-02T00:00:00.000Z' },
      { refreshExplanation: { label: 'Refresh explanation', onClick: () => {}, failed: true } });
    expect(notice()?.textContent).toContain("We couldn't refresh it just now. Your corrected value is saved.");
    expect(app.querySelector('button')?.textContent).toBe('Refresh explanation');
  });
});
