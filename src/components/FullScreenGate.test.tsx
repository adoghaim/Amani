// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FullScreenGate, type FullScreenGateProps } from './FullScreenGate';
import { CalmNotice } from './CalmNotice';
import { axeViolations } from './axe.testkit';

/*
  PK-INT-01 additions (D24, D23): the one full-screen gate layout. The copy
  below is placeholder text for the layout only; the gates themselves, and
  their copy, belong to later packets.
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

const render = async (node: ReactNode) => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/gate']}>
    <Routes>
      <Route path="/gate" element={node} />
      <Route path="/privacy" element={<p>Privacy page</p>} />
    </Routes>
  </MemoryRouter>));
};
const base: FullScreenGateProps = {
  heading: 'Placeholder heading',
  sentence: 'One placeholder sentence.',
  primary: { label: 'Continue', onClick: () => {} },
};
const heading = () => app.querySelector('h1')!;
const buttons = () => Array.from(app.querySelectorAll('button'));
const button = (text: string) => buttons().find(b => b.textContent?.trim() === text);

describe('FullScreenGate (D24)', () => {
  it('lays out logo, heading, sentence and one primary button, left-aligned on the splash ground, in its own main', async () => {
    await render(<FullScreenGate {...base} />);
    const screen = app.firstElementChild as HTMLElement;
    expect(screen.className).toContain('bg-theme-background');
    expect(screen.className).toContain('min-h-[100dvh]');
    const main = app.querySelector('main')!;
    expect(app.querySelectorAll('main')).toHaveLength(1);
    // Left-aligned in the top third: a top-anchored column, never vertically centred.
    expect(main.className).toContain('pt-14');
    expect(`${screen.className} ${main.className}`).not.toMatch(/justify-center|items-center|text-center|my-auto/);
    expect(main.firstElementChild!.getAttribute('aria-label')).toBe('Amani');
    expect(app.querySelectorAll('h1')).toHaveLength(1);
    expect(heading().textContent).toBe('Placeholder heading');
    expect(main.querySelector('h1 + p')!.textContent).toBe('One placeholder sentence.');
    expect(buttons().map(b => b.textContent)).toEqual(['Continue']);
    // It adds no content of its own beyond the logo: nothing it was not given.
    expect(main.textContent).toBe('amaniPlaceholder headingOne placeholder sentence.Continue');
    expect(await axeViolations(app)).toEqual([]);
  });

  it('moves focus to the heading on open, and again when the next step replaces it', async () => {
    function Steps() {
      const [step, setStep] = useState(1);
      return <FullScreenGate {...base} heading={`Placeholder step ${step}`} progress={{ current: step, total: 3 }}
        primary={{ label: 'Continue', onClick: () => setStep(s => s + 1) }} />;
    }
    await render(<Steps />);
    expect(document.activeElement).toBe(heading());
    expect(heading().tabIndex).toBe(-1);
    button('Continue')!.focus();
    expect(document.activeElement).not.toBe(heading());
    await act(async () => button('Continue')!.click());
    expect(heading().textContent).toBe('Placeholder step 2');
    expect(document.activeElement).toBe(heading());
  });

  it('opens and closes "What this means", closed by default and on every new step', async () => {
    function Steps() {
      const [step, setStep] = useState(1);
      return <FullScreenGate {...base} heading={`Placeholder step ${step}`}
        whatThisMeans={['First placeholder paragraph.', 'Second placeholder paragraph.']}
        primary={{ label: 'Continue', onClick: () => setStep(s => s + 1) }} />;
    }
    await render(<Steps />);
    const toggle = button('What this means')!;
    const region = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(region.hidden).toBe(true);
    expect(await axeViolations(app)).toEqual([]);
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);
    expect(Array.from(region.querySelectorAll('p')).map(p => p.textContent)).toEqual(['First placeholder paragraph.', 'Second placeholder paragraph.']);
    expect(await axeViolations(app)).toEqual([]);
    await act(async () => button('Continue')!.click());
    expect(button('What this means')!.getAttribute('aria-expanded')).toBe('false');
    await act(async () => button('What this means')!.click());
    await act(async () => button('What this means')!.click());
    expect(button('What this means')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows progress dots where steps apply, described to assistive technology as the step', async () => {
    await render(<FullScreenGate {...base} progress={{ current: 2, total: 3 }} />);
    const dots = Array.from(app.querySelectorAll('[data-step]'));
    expect(dots).toHaveLength(3);
    expect(dots[0]!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(dots.map(d => d.className.includes('w-6'))).toEqual([false, true, false]);
    expect(dots.map(d => d.className.includes('bg-theme-primary'))).toEqual([true, true, false]);
    const step = document.getElementById(heading().getAttribute('aria-describedby')!)!;
    expect(step.textContent).toBe('Step 2 of 3');
    expect(step.className).toContain('sr-only');
    expect(await axeViolations(app)).toEqual([]);
  });

  it('the primary button runs, is disabled when its step says so, and shows it is busy', async () => {
    const onClick = vi.fn();
    await render(<FullScreenGate {...base} primary={{ label: 'Continue', onClick, disabled: true }} />);
    expect(button('Continue')!.disabled).toBe(true);
    await act(async () => button('Continue')!.click());
    expect(onClick).not.toHaveBeenCalled();
    await render(<FullScreenGate {...base} primary={{ label: 'Continue', onClick, busy: true }} />);
    expect(button('Continue')!.disabled).toBe(true);
    expect(button('Continue')!.querySelector('svg.animate-spin')).not.toBeNull();
    await render(<FullScreenGate {...base} primary={{ label: 'Continue', onClick }} />);
    await act(async () => button('Continue')!.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(button('Continue')!.className).toContain('min-h-[44px]');
  });

  it('has at most one quiet secondary link: an action, an app route or a web address', async () => {
    const onClick = vi.fn();
    await render(<FullScreenGate {...base} secondary={{ label: 'Placeholder link', onClick }} />);
    expect(buttons().map(b => b.textContent)).toEqual(['Continue', 'Placeholder link']);
    await act(async () => button('Placeholder link')!.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(button('Placeholder link')!.className).toContain('min-h-[44px]');
    expect(await axeViolations(app)).toEqual([]);

    await render(<FullScreenGate {...base} secondary={{ label: 'Store', href: 'https://example.invalid/store' }} />);
    expect(app.querySelector('main a')!.getAttribute('href')).toBe('https://example.invalid/store');
    expect(app.querySelectorAll('main a, main button')).toHaveLength(2);
    expect(await axeViolations(app)).toEqual([]);

    await render(<FullScreenGate {...base} secondary={{ label: 'Privacy', to: '/privacy' }} />);
    const route = app.querySelector<HTMLAnchorElement>('main a')!;
    expect(route.getAttribute('href')).toBe('/privacy');
    expect(await axeViolations(app)).toEqual([]);
    await act(async () => route.click());
    expect(app.textContent).toBe('Privacy page');
  });

  it("holds the step's own control and a calm notice above the primary button", async () => {
    await render(<FullScreenGate {...base} notice={<CalmNotice title="Placeholder notice" />}>
      <label className="flex items-center gap-2"><input type="checkbox" /> Placeholder agreement</label>
    </FullScreenGate>);
    const main = app.querySelector('main')!;
    const order = Array.from(main.querySelectorAll('input, [role="status"], button')).map(el => el.tagName === 'INPUT' ? 'control'
      : el.getAttribute('role') === 'status' ? 'notice' : el.textContent);
    expect(order).toEqual(['control', 'notice', 'Continue']);
    expect(await axeViolations(app)).toEqual([]);
  });
});
