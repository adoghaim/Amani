// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

/*
  Review F067. Back on /app with a sheet open called exitApp() and discarded
  her entry; on other routes it navigated away underneath the sheet. Back now
  closes the top sheet first, and only then navigates or exits.
*/

const native = vi.hoisted(() => ({
  isNative: true,
  handler: null as null | ((event: { canGoBack: boolean; exitApp: () => void }) => void),
  released: 0,
  locked: false,
}));
vi.mock('../lib/native', () => ({
  isNative: () => native.isNative,
  onBackButton: (handler: NonNullable<typeof native.handler>) => {
    native.handler = handler;
    return () => { native.released += 1; if (native.handler === handler) native.handler = null; };
  },
}));
vi.mock('../lib/deviceLock', () => ({ deviceLock: { getState: () => ({ locked: native.locked }) } }));
import { AndroidBackHandler } from './AndroidBackHandler';

function Sheets() {
  const [outer, setOuter] = useState(true);
  const [inner, setInner] = useState(true);
  return <>
    <Modal open={outer} onClose={() => setOuter(false)} title="Outer"><p>outer body</p></Modal>
    <Modal open={inner} onClose={() => setInner(false)} title="Inner"><p>inner body</p></Modal>
  </>;
}
function Path() { return <output id="path">{useLocation().pathname}</output>; }

let root: Root;
let app: HTMLDivElement;
const exitApp = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  native.isNative = true;
  native.handler = null;
  native.released = 0;
  native.locked = false;
  exitApp.mockClear();
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

async function mount(entries: string[], withSheets: boolean) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <AndroidBackHandler />
      <Path />
      {withSheets && <Sheets />}
    </MemoryRouter>,
  ));
}
const press = (canGoBack = true) => act(async () => native.handler!({ canGoBack, exitApp }));
const titles = () => Array.from(document.querySelectorAll('[role="dialog"]')).map(d => d.getAttribute('aria-label'));
const path = () => document.getElementById('path')!.textContent;

describe('Android back with sheets open', () => {
  it('on a root route, closes the top sheet and neither exits nor navigates', async () => {
    await mount(['/app'], true);
    expect(titles()).toEqual(['Outer', 'Inner']);
    await press();
    expect(titles()).toEqual(['Outer']);
    expect(exitApp).not.toHaveBeenCalled();
    await press();
    expect(titles()).toEqual([]);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('with the sheets gone, back on a root route exits', async () => {
    await mount(['/app'], true);
    await press();
    await press();
    await press();
    expect(exitApp).toHaveBeenCalledOnce();
  });

  it('on another route, closes the sheet before navigating back, then navigates', async () => {
    await mount(['/app', '/app/tracker'], true);
    await press();
    await press();
    expect(path()).toBe('/app/tracker');
    expect(titles()).toEqual([]);
    await press();
    expect(path()).toBe('/app');
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('exits when there is nothing to go back to', async () => {
    await mount(['/app/tracker'], false);
    await press(false);
    expect(exitApp).toHaveBeenCalledOnce();
    expect(path()).toBe('/app/tracker');
  });

  it('the biometric lock still wins: back closes the app, not a sheet', async () => {
    native.locked = true;
    await mount(['/app'], true);
    await press();
    expect(exitApp).toHaveBeenCalledOnce();
    expect(titles()).toEqual(['Outer', 'Inner']);
  });

  it('a sheet that unmounts while open leaves nothing for back to close', async () => {
    await mount(['/app'], true);
    await mount(['/app'], false);
    expect(titles()).toEqual([]);
    await press();
    expect(exitApp).toHaveBeenCalledOnce();
  });
});

describe('the handler\'s lifecycle', () => {
  it('registers through onBackButton on native and releases on unmount', async () => {
    await mount(['/app'], false);
    expect(native.handler).not.toBeNull();
    await act(async () => root.render(<MemoryRouter><p>gone</p></MemoryRouter>));
    expect(native.released).toBeGreaterThan(0);
    expect(native.handler).toBeNull();
  });

  it('never registers on the web', async () => {
    native.isNative = false;
    await mount(['/app'], false);
    expect(native.handler).toBeNull();
  });
});
