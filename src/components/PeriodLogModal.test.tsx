// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PeriodLogModal } from './PeriodLogModal';
import { SymptomLogModal } from './SymptomLogModal';

let root: Root;
let app: HTMLDivElement;
const save = vi.fn(async () => {});
function Harness({ symptom }: { symptom: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button id="open" onClick={() => setOpen(true)}>Open sheet</button>
    {symptom
      ? <SymptomLogModal isOpen={open} onClose={() => setOpen(false)} onSave={save} existingLog={null} defaultDate="2026-09-01" />
      : <PeriodLogModal isOpen={open} mode="start" onClose={() => setOpen(false)} onSave={save} defaultDate="2026-09-01" />}
  </>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  app = document.createElement('div');
  app.id = 'root';
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  save.mockClear();
});
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === text)!;

it.each([false, true])('opens, cancels, reopens and submits the sheet (symptom=%s)', async symptom => {
  await act(async () => root.render(<Harness symptom={symptom} />));
  const opener = document.getElementById('open')!;
  opener.focus();
  await act(async () => opener.click());
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(symptom ? 'Log symptoms' : 'Log period start');
  expect(app.hasAttribute('inert')).toBe(true);
  await act(async () => button('Cancel').click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(save).not.toHaveBeenCalled();
  await act(async () => opener.click());
  if (symptom) {
    expect(button('Save').disabled).toBe(true);
    await act(async () => button('Cramps').click());
  } else {
    await act(async () => document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')[3]!.click());
  }
  await act(async () => button('Save').click());
  if (symptom) expect(save).toHaveBeenCalledWith('2026-09-01', ['cramps'], '');
  else expect(save).toHaveBeenCalledWith({ start_date: '2026-09-01', end_date: null, flow_intensity: 'medium', notes: '' });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(app.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(opener);
});
