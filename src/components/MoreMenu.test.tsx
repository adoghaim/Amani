// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RefreshCw, Trash2 } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoreMenu, type MoreMenuItem } from './MoreMenu';
import { axeViolations } from './axe.testkit';

/*
  PK-INT-01 additions (D19, D23): the labelled More menu. A disclosure of
  ordinary buttons: the trigger says whether it is expanded, opening moves
  focus into the list, Escape and choosing an action bring focus back.
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

const selected: string[] = [];
const item = (id: string, extra: Partial<MoreMenuItem> = {}): MoreMenuItem => ({
  id, label: `Placeholder ${id}`, onSelect: () => { selected.push(id); }, ...extra,
});
async function render(items: MoreMenuItem[]) {
  selected.length = 0;
  await act(async () => root.render(<>
    <MoreMenu items={items} listLabel="Placeholder actions" />
    <button type="button" id="outside">Outside</button>
  </>));
}
const trigger = () => app.querySelector<HTMLButtonElement>('[data-more-trigger]')!;
const list = () => document.getElementById(trigger().getAttribute('aria-controls')!)!;
const actions = () => Array.from(list().querySelectorAll('button'));
const press = async (key: string, target: Element = document.activeElement!) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
};
const open = async () => { await act(async () => trigger().click()); };
const standard = () => [
  item('first', { icon: RefreshCw }),
  item('second'),
  item('off', { disabled: true }),
  item('remove', { icon: Trash2, tone: 'danger' }),
];

describe('MoreMenu (D19)', () => {
  it('is a labelled button that controls a hidden, named list of actions', async () => {
    await render(standard());
    expect(trigger().textContent).toBe('More');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(list().hidden).toBe(true);
    expect(list().getAttribute('aria-label')).toBe('Placeholder actions');
    // The closed list keeps its actions in the document, in order, out of reach.
    expect(actions().map(b => b.textContent)).toEqual(['Placeholder first', 'Placeholder second', 'Placeholder off', 'Placeholder remove']);
    expect(await axeViolations(app)).toEqual([]);
  });

  it('opening shows the list and moves focus to the first available action', async () => {
    await render(standard());
    trigger().focus();
    await open();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(list().hidden).toBe(false);
    expect(document.activeElement).toBe(actions()[0]);
    expect(await axeViolations(app)).toEqual([]);
    await open();
    expect(list().hidden).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('arrow keys, Home and End move between available actions, skipping disabled ones', async () => {
    await render(standard());
    trigger().focus();
    await press('ArrowDown');
    expect(list().hidden).toBe(false);
    expect(document.activeElement).toBe(actions()[0]);
    await press('ArrowDown');
    expect(document.activeElement).toBe(actions()[1]);
    await press('ArrowDown');
    expect(document.activeElement).toBe(actions()[3]);
    await press('ArrowDown');
    expect(document.activeElement).toBe(actions()[0]);
    await press('ArrowUp');
    expect(document.activeElement).toBe(actions()[3]);
    await press('Home');
    expect(document.activeElement).toBe(actions()[0]);
    await press('End');
    expect(document.activeElement).toBe(actions()[3]);
    await press('Escape');
    trigger().focus();
    await press('ArrowUp');
    expect(document.activeElement).toBe(actions()[3]);
  });

  it('Escape closes and returns focus to More', async () => {
    await render(standard());
    trigger().focus();
    await open();
    await press('ArrowDown');
    await press('Escape');
    expect(list().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('choosing an action closes the list and returns focus to More before the action runs', async () => {
    await render(standard());
    let atSelect: { hidden: boolean; focused: Element | null } | null = null;
    await render([item('first', { onSelect: () => { atSelect = { hidden: list().hidden, focused: document.activeElement }; } })]);
    trigger().focus();
    await open();
    await act(async () => actions()[0]!.click());
    expect(atSelect).toEqual({ hidden: true, focused: trigger() });
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('runs each action once, and never a disabled one', async () => {
    await render(standard());
    await open();
    await act(async () => actions()[1]!.click());
    await open();
    await act(async () => actions()[2]!.click());
    await open();
    await act(async () => actions()[3]!.click());
    expect(selected).toEqual(['second', 'remove']);
    expect(actions()[2]!.disabled).toBe(true);
  });

  it('closes when focus leaves it or a press lands outside', async () => {
    await render(standard());
    await open();
    await act(async () => document.getElementById('outside')!.focus());
    expect(list().hidden).toBe(true);
    await open();
    await act(async () => { document.getElementById('outside')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(list().hidden).toBe(true);
    await open();
    await act(async () => { actions()[1]!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(list().hidden).toBe(false);
  });

  it('a press inside never moves focus (Safari would blur the list shut), and More closes it again', async () => {
    await render(standard());
    await open();
    const press = (target: Element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press(actions()[1]!)).toBe(true);
    expect(press(trigger())).toBe(true);
    expect(press(document.getElementById('outside')!)).toBe(false);
    await act(async () => trigger().click());
    expect(list().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('every action is at least 44px tall; a destructive one reads in danger ink after a divider', async () => {
    await render(standard());
    for (const action of actions()) expect(action.className).toContain('min-h-[44px]');
    const remove = actions()[3]!;
    expect(remove.className).toContain('text-theme-danger-dark');
    expect(remove.closest('li')!.className).toContain('border-t');
    expect(actions()[0]!.className).toContain('text-theme-text');
    expect(actions()[0]!.closest('li')!.className).not.toContain('border-t');
    // The trigger is a small button with the 44px tap area (Button sm).
    expect(trigger().className).toContain('before:h-[max(100%,44px)]');
  });

  it('a busy action turns its icon, as the report header always has', async () => {
    await render([item('first', { icon: RefreshCw, busy: true, disabled: true })]);
    expect(actions()[0]!.querySelector('svg')!.getAttribute('class')).toContain('animate-spin');
    expect(actions()[0]!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});
