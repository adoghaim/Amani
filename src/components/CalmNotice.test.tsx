// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalmNotice, CALM_NOTICE_SAFE_LINE } from './CalmNotice';
import { axeViolations } from './axe.testkit';

/*
  PK-INT-01 additions (D7): the calm notice. Three lines (what happened, what's
  safe, one optional action), announced politely, never in the rose or error
  colours that Alert keeps for genuine errors.
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

const render = async (node: ReactNode) => { await act(async () => root.render(node)); };
const notice = () => app.querySelector<HTMLElement>('[role="status"]')!;
const lines = () => Array.from(notice().querySelectorAll('p')).map(p => p.textContent);
// Rose, error and danger classes: Alert's, never the calm notice's.
const ALARM = /flag-low|flag-watch|danger|rose|red-|error/;

describe('CalmNotice (D7)', () => {
  it('says what happened and what is safe, announced politely, with no action by default', async () => {
    await render(<CalmNotice title="We couldn't prepare your file" />);
    expect(notice().getAttribute('aria-live')).toBe('polite');
    expect(lines()).toEqual(["We couldn't prepare your file", CALM_NOTICE_SAFE_LINE]);
    expect(CALM_NOTICE_SAFE_LINE).toBe('Your reports and results are saved.');
    expect(notice().querySelectorAll('button')).toHaveLength(0);
    expect(await axeViolations(app)).toEqual([]);
  });

  it('takes a more exact safe line and one action, which it runs', async () => {
    const onClick = vi.fn();
    await render(<CalmNotice title="A new analysis isn't ready" safe="Your current analysis is unchanged." action={{ label: 'Try again', onClick }} />);
    expect(lines()).toEqual(["A new analysis isn't ready", 'Your current analysis is unchanged.']);
    const buttons = notice().querySelectorAll('button');
    expect(Array.from(buttons).map(b => b.textContent)).toEqual(['Try again']);
    await act(async () => buttons[0]!.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(await axeViolations(app)).toEqual([]);
  });

  it('a busy action shows it is running and cannot be pressed again', async () => {
    const onClick = vi.fn();
    await render(<CalmNotice title="Preparing again" action={{ label: 'Try again', onClick, busy: true }} />);
    const button = notice().querySelector('button')!;
    expect(button.disabled).toBe(true);
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    await act(async () => button.click());
    expect(onClick).not.toHaveBeenCalled();
    expect(await axeViolations(app)).toEqual([]);
  });

  it('is calm: theme surface, hairline border, Info icon in mauve, never rose or error colours', async () => {
    await render(<CalmNotice title="Paused" action={{ label: 'Try again', onClick: () => {} }} />);
    const box = notice();
    expect(box.className).toContain('bg-theme-surface');
    expect(box.className).toContain('border-theme-border-subtle');
    const icon = box.querySelector('svg')!;
    expect(icon.getAttribute('class')).toContain('text-theme-primary');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(box.querySelector('p')!.className).toContain('text-theme-text');
    expect(box.querySelectorAll('p')[1]!.className).toContain('text-theme-text-body');
    const classes = [box, ...box.querySelectorAll('*')].map(el => el.getAttribute('class') ?? '').join(' ');
    expect(classes).not.toMatch(ALARM);
    expect(box.getAttribute('role')).toBe('status');
  });

  it('wraps long copy instead of overflowing', async () => {
    await render(<CalmNotice title={'A very long title '.repeat(20)} />);
    expect(notice().querySelector('div')!.className).toMatch(/min-w-0/);
    expect(notice().querySelector('div')!.className).toMatch(/break-words/);
  });
});
