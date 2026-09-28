// @vitest-environment jsdom
import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

let root: Root;
let app: HTMLDivElement;
const navigate = vi.fn();

function Harness() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  return <>
    <button id="opener" onClick={() => setOpen(true)}>Open</button>
    <Modal open={open} onClose={() => setOpen(false)} title="Analysis">
      <button id="inside" onClick={() => setCount(n => n + 1)}>Inside {count}</button>
      <button disabled>Disabled</button>
      <button hidden>Hidden</button>
    </Modal>
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-50">
      <button id="tracker" onClick={navigate}>Tracker</button>
    </nav>
  </>;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // jsdom has no layout; give visible elements a rectangle for focusability.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.hidden ? [] : [{ width: 10, height: 10 }]) as unknown as DOMRectList;
  });
  app = document.createElement('div');
  app.id = 'root';
  document.body.append(app);
  root = createRoot(app);
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate.mockClear();
});

async function open() {
  const opener = document.getElementById('opener')!;
  opener.focus();
  await act(async () => opener.click());
  return opener;
}
function tab(shiftKey = false) {
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
}

describe('Modal isolation', () => {
  it('makes the mobile nav inert while the dialog is outside the app and above the nav', async () => {
    const opener = await open();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(document.getElementById('tracker')!.closest('[inert]')).toBe(app);
    expect(app.contains(dialog)).toBe(false);
    expect(dialog.parentElement!.classList.contains('z-[60]')).toBe(true);
    // jsdom does not implement pointer hit testing or native inert behavior.
    // Assert the inert ancestor instead of pretending .click() simulates it.
    await act(async () => dialog.parentElement!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(app.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    await act(async () => document.getElementById('tracker')!.click());
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('focuses the panel, contains forward/backward Tab, and keeps focus across inline callback updates', async () => {
    await open();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = dialog.querySelector<HTMLElement>('[aria-label="Close"]')!;
    const inside = document.getElementById('inside')!;
    expect(document.activeElement).toBe(dialog);
    tab();
    expect(document.activeElement).toBe(close);
    tab(true);
    expect(document.activeElement).toBe(inside);
    tab();
    expect(document.activeElement).toBe(close);
    dialog.focus();
    tab(true);
    expect(document.activeElement).toBe(inside);
    await act(async () => inside.click());
    expect(document.activeElement).toBe(inside);
    expect(inside.textContent).toBe('Inside 1');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it.each(['Escape', 'Close'])('%s closes and restores the opener', async method => {
    const opener = await open();
    await act(async () => {
      if (method === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else document.querySelector<HTMLElement>('[aria-label="Close"]')!.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(app.hasAttribute('inert')).toBe(false);
  });

  it('preserves a pre-existing inert attribute on cleanup', async () => {
    app.setAttribute('inert', '');
    await open();
    await act(async () => document.querySelector<HTMLElement>('[aria-label="Close"]')!.click());
    expect(app.hasAttribute('inert')).toBe(true);
  });
});
