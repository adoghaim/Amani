// @vitest-environment jsdom
import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './axe.testkit';
import { InsightsModal } from './InsightsModal';
import { Modal } from './Modal';
import { NoteModal } from './NoteModal';
import { closeTopOverlay } from '../lib/overlayStack';

/*
  Review F066. The Dashboard and Tracker "Add note" sheets, the Reports delete
  dialog and the insights comparison were hand-rolled fixed z-50 divs: no dialog
  role, no focus trap or Escape, unnamed icon-only close buttons, labels tied to
  nothing, and the bottom nav (also z-50, later in the DOM) painted over their
  buttons. They sit on the shared Modal now. (The delete dialog is covered in
  pages/Reports.delete.test.tsx, the Dashboard wiring in pages/Dashboard.test.tsx.)
*/

let root: Root;
let app: HTMLDivElement;
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
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const escape = () => act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });

function NoteHarness({ onSave = () => {} }: { onSave?: () => void }) {
  const [open, setOpen] = useState(true);
  const [date, setDate] = useState('2026-10-20');
  const [text, setText] = useState('');
  return <NoteModal open={open} onClose={() => setOpen(false)} date={date} onDateChange={setDate}
    maxDate="2026-10-23" text={text} onTextChange={setText} saving={false} onSave={onSave} />;
}

describe('NoteModal (the Add note sheet)', () => {
  it('is a named, modal dialog above the bottom nav, with an inert background', async () => {
    await act(async () => root.render(<NoteHarness />));
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-label')).toBe('Add note');
    expect(d.parentElement!.classList.contains('z-[60]')).toBe(true);
    expect(app.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(d);
  });

  it('has a 44px close button named Close, and Date and Note labelled to their fields', async () => {
    await act(async () => root.render(<NoteHarness />));
    const close = dialog()!.querySelector<HTMLElement>('button[aria-label="Close"]')!;
    expect(close.className).toContain('w-11');
    expect(close.className).toContain('h-11');
    for (const [label, tag] of [['Date', 'INPUT'], ['Note', 'TEXTAREA']] as const) {
      const el = Array.from(dialog()!.querySelectorAll('label')).find(l => l.textContent === label)!;
      expect(el.htmlFor, label).not.toBe('');
      const field = document.getElementById(el.htmlFor)!;
      expect(field.tagName, label).toBe(tag);
    }
    expect(await axeViolations(dialog()!)).toEqual([]);
  });

  it('Escape closes it and gives focus back; Save stays disabled until there is text', async () => {
    await act(async () => root.render(<NoteHarness />));
    const save = Array.from(dialog()!.querySelectorAll('button')).find(b => b.textContent === 'Save')!;
    expect(save.disabled).toBe(true);
    await escape();
    expect(dialog()).toBeNull();
    expect(app.hasAttribute('inert')).toBe(false);
  });
});

describe('InsightsModal (the comparison sheet)', () => {
  const render = (props: Partial<Parameters<typeof InsightsModal>[0]> = {}) => act(async () => root.render(
    <InsightsModal isOpen onClose={() => {}} insights={null} reportDates={{ previous: '2026-08-01', current: '2026-10-01', days_between: 61 }} {...props} />,
  ));

  it('is a named dialog above the nav with a named 44px close button, and passes axe', async () => {
    await render();
    const d = dialog()!;
    expect(d.getAttribute('aria-label')).toBe('Your health story');
    expect(d.parentElement!.classList.contains('z-[60]')).toBe(true);
    const close = d.querySelector<HTMLElement>('button[aria-label="Close"]')!;
    expect(close.className).toContain('h-11');
    expect(await axeViolations(d)).toEqual([]);
  });

  it('no longer draws muted text over the navy gradient that measured 3.38:1 and 2.18:1', async () => {
    await render();
    const d = dialog()!;
    expect(d.querySelector('[class*="bg-gradient"]')).toBeNull();
    expect(d.innerHTML).not.toContain('text-theme-muted-text-3');
    expect(d.textContent).toContain('Comparing');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    await render({ onClose });
    await escape();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders nothing when closed', async () => {
    await render({ isOpen: false });
    expect(dialog()).toBeNull();
  });
});

describe('the Android back button stack (F067)', () => {
  function Two() {
    const [a, setA] = useState(true);
    return <Modal open={a} onClose={() => setA(false)} title="A">x</Modal>;
  }

  it('an open Modal is the top overlay; closing it, or unmounting it, leaves none', async () => {
    await act(async () => root.render(<StrictMode><Two /></StrictMode>));
    expect(dialog()).not.toBeNull();
    await act(async () => { expect(closeTopOverlay()).toBe(true); });
    expect(dialog()).toBeNull();
    expect(closeTopOverlay()).toBe(false);
  });

  it('a Modal with an inline onClose registers once and calls the latest callback', async () => {
    const calls: number[] = [];
    function Inline() {
      const [n, setN] = useState(0);
      return <><button id="bump" onClick={() => setN(v => v + 1)}>{n}</button>
        <Modal open onClose={() => calls.push(n)} title="A">x</Modal></>;
    }
    await act(async () => root.render(<Inline />));
    await act(async () => document.getElementById('bump')!.click());
    await act(async () => document.getElementById('bump')!.click());
    expect(closeTopOverlay()).toBe(true);
    expect(calls).toEqual([2]);
    expect(closeTopOverlay()).toBe(true); // the parent never closed it, so it is still the top sheet
    expect(calls).toEqual([2, 2]);
    await act(async () => root.unmount());
    expect(closeTopOverlay()).toBe(false);
    root = createRoot(app);
  });
});

describe('no hand-rolled full-screen overlays', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
    });
  }

  it('only the shared Modal (and the dev-only parser debugger) draws a fixed inset-0 sheet', () => {
    // DeviceLockGate's cover (PK-DEVICE-01, review F001/F002) is not a sheet and
    // must not be one: nothing may dismiss it (Escape, backdrop or back), it sits
    // above every sheet (z-[70] over the Modal's z-[60]), and it is drawn outside
    // #root so an open Modal's inert cannot disable the lock screen.
    const offenders = files('src')
      .filter(f => /fixed\s+inset-0/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
      .filter(f => !/[\\/]components[\\/]Modal\.tsx$/.test(f) && !/[\\/]pages[\\/]ParserDebugger\.tsx$/.test(f)
        && !/[\\/]features[\\/]deviceLock[\\/]DeviceLockGate\.tsx$/.test(f));
    expect(offenders).toEqual([]);
  });
});
