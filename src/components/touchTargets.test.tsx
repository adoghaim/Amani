// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Modal } from './Modal';

/*
  PK-INT-01 additions (D23, DESIGN.md `touch-target`): every control has a
  44px tap area. jsdom does no layout, so this pins the classes that give it.
*/

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no scrolling; the Modal's scroll lock calls it.
  vi.stubGlobal('scrollTo', () => {});
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('44px touch targets (D23)', () => {
  it('Button md is at least 44px tall', async () => {
    await act(async () => root.render(<Button>Placeholder</Button>));
    expect(app.querySelector('button')!.className).toContain('min-h-[44px]');
  });

  it('Button sm keeps its look and a 44px tap area around it', async () => {
    await act(async () => root.render(<Button size="sm">Placeholder</Button>));
    const classes = app.querySelector('button')!.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining([
      'py-1.5', 'text-sm', 'relative', 'before:absolute',
      'before:h-[max(100%,44px)]', 'before:w-[max(100%,44px)]',
      'before:left-1/2', 'before:top-1/2', 'before:-translate-x-1/2', 'before:-translate-y-1/2',
    ]));
    expect(classes).not.toContain('min-h-[44px]');
  });

  it('the Modal close button is 44px square', async () => {
    await act(async () => root.render(<Modal open onClose={() => {}} title="Placeholder">Body</Modal>));
    const close = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    expect(close.className.split(/\s+/)).toEqual(expect.arrayContaining(['w-11', 'h-11']));
  });
});
